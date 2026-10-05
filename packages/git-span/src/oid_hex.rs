//! Serde adapters that persist a `gix::ObjectId` as its hex string.
//!
//! Used with `#[serde(with = "crate::oid_hex")]` (or `crate::oid_hex::option`)
//! by every persisted shape that carries an object id: the public
//! [`DriftLocus`](crate::types::DriftLocus) and
//! [`AnchorLocation`](crate::types::AnchorLocation), which the store's
//! generation summary and resolution-core rows embed. The bincode
//! bytes are exactly those of the hex `String` itself. Parsing happens once,
//! at decode: a malformed stored OID fails the enclosing row's
//! deserialization (which every store reader treats as a miss, fail-closed)
//! instead of surviving until projection.

use serde::{Deserialize, Deserializer, Serializer};
use std::str::FromStr;

fn parse<E: serde::de::Error>(hex: &str) -> Result<gix::ObjectId, E> {
    gix::ObjectId::from_str(hex).map_err(|e| E::custom(format!("invalid oid `{hex}`: {e}")))
}

pub(crate) fn serialize<S: Serializer>(oid: &gix::ObjectId, s: S) -> Result<S::Ok, S::Error> {
    s.serialize_str(&oid.to_string())
}

pub(crate) fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<gix::ObjectId, D::Error> {
    parse(&String::deserialize(d)?)
}

/// `Option<gix::ObjectId>` counterpart, encoded as `Option<String>`.
pub(crate) mod option {
    use serde::{Deserialize, Deserializer, Serialize, Serializer};

    pub(crate) fn serialize<S: Serializer>(
        oid: &Option<gix::ObjectId>,
        s: S,
    ) -> Result<S::Ok, S::Error> {
        oid.map(|o| o.to_string()).serialize(s)
    }

    pub(crate) fn deserialize<'de, D: Deserializer<'de>>(
        d: D,
    ) -> Result<Option<gix::ObjectId>, D::Error> {
        Option::<String>::deserialize(d)?
            .map(|hex| super::parse(&hex))
            .transpose()
    }
}

#[cfg(test)]
mod tests {
    use crate::types::{DriftLocus, LocusCause};

    /// `DriftLocus` persists as its commit's hex string followed by the
    /// cause. Pinning the shape here means a layout change cannot slip past
    /// `exact::SUMMARY_VERSION` unnoticed.
    #[test]
    fn drift_locus_encodes_commit_as_hex_then_cause() {
        // bincode encodes the variant by index, so only the variant order has
        // to match `LocusCause`.
        #[derive(serde::Serialize)]
        enum ExpectedCause<'a> {
            _Changed,
            _Orphaned,
            Renamed(&'a str),
        }
        let oid = gix::ObjectId::from_hex(b"0123456789abcdef0123456789abcdef01234567")
            .expect("valid hex");
        let hex = oid.to_string();
        let renamed = DriftLocus {
            commit: oid,
            cause: LocusCause::Renamed { to: "b.rs".into() },
        };
        let bytes = bincode::serialize(&renamed).expect("serialize DriftLocus");
        assert_eq!(
            bytes,
            bincode::serialize(&(hex.as_str(), ExpectedCause::Renamed("b.rs")))
                .expect("serialize expected shape"),
        );
        assert_eq!(
            bincode::deserialize::<DriftLocus>(&bytes).expect("round-trip"),
            renamed
        );
    }

    #[test]
    fn malformed_stored_locus_oid_fails_decode() {
        #[derive(serde::Serialize)]
        enum ExpectedCause {
            Changed,
        }
        let bytes = bincode::serialize(&("not-hex", ExpectedCause::Changed))
            .expect("serialize expected shape");
        assert!(bincode::deserialize::<DriftLocus>(&bytes).is_err());
    }
}
