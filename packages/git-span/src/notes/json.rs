//! Decode arbitrary user keys without serde_json Value's private-map protocol.
use anyhow::ensure;
use serde::de::{Deserialize, Deserializer, MapAccess, Visitor};
use serde_json::{Map, Number, Value, value::RawValue};
use std::fmt;

pub(super) fn decode(text: &str) -> anyhow::Result<Value> {
    let raw: &RawValue = serde_json::from_str(text)?;
    decode_value(raw, 128)
}

fn decode_value(raw: &RawValue, remaining_depth: u8) -> anyhow::Result<Value> {
    let text = raw.get();
    match text.as_bytes()[0] {
        b'{' => {
            // RawValue's syntax scanner does not enforce Value's recursion limit.
            ensure!(remaining_depth > 1, "recursion limit exceeded");
            let Members(entries) = serde_json::from_str(text)?;
            let mut object = Map::new();
            for (key, value) in entries {
                object.insert(key, decode_value(value, remaining_depth - 1)?);
            }
            Ok(Value::Object(object))
        }
        b'[' => {
            ensure!(remaining_depth > 1, "recursion limit exceeded");
            let entries: Vec<&RawValue> = serde_json::from_str(text)?;
            entries
                .into_iter()
                .map(|value| decode_value(value, remaining_depth - 1))
                .collect::<anyhow::Result<Vec<_>>>()
                .map(Value::Array)
        }
        b'"' => Ok(Value::String(serde_json::from_str(text)?)),
        b't' | b'f' => Ok(Value::Bool(serde_json::from_str(text)?)),
        b'n' => Ok(Value::Null),
        // Only validated numeric tokens reach Number's arbitrary-precision decoder;
        // user objects never enter its internal tagged-map representation.
        _ => Ok(Value::Number(serde_json::from_str::<Number>(text)?)),
    }
}

// Retain duplicate members until each value has passed the recursion check. A
// map decoder that discarded overwritten values could hide excessive nesting.
struct Members<'a>(Vec<(String, &'a RawValue)>);
impl<'de> Deserialize<'de> for Members<'de> {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct MembersVisitor;
        impl<'de> Visitor<'de> for MembersVisitor {
            type Value = Members<'de>;
            fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str("a JSON object")
            }
            fn visit_map<M: MapAccess<'de>>(self, mut map: M) -> Result<Self::Value, M::Error> {
                let mut entries = Vec::new();
                while let Some(entry) = map.next_entry::<String, &RawValue>()? {
                    entries.push(entry);
                }
                Ok(Members(entries))
            }
        }
        deserializer.deserialize_map(MembersVisitor)
    }
}
