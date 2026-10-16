use std::time::Duration;

/// Parses a positive integer with an `ms`, `s`, `m`, or `h` suffix.
pub fn parse(input: &str) -> Result<Duration, String> {
    let (digits, unit_ms) = if let Some(n) = input.strip_suffix("ms") {
        (n, 1u64)
    } else if let Some(n) = input.strip_suffix('s') {
        (n, 1_000)
    } else if let Some(n) = input.strip_suffix('m') {
        (n, 60_000)
    } else if let Some(n) = input.strip_suffix('h') {
        (n, 3_600_000)
    } else {
        return Err(format!("'{input}' needs an ms, s, m, or h suffix"));
    };
    let value: u64 = digits
        .parse()
        .map_err(|_| format!("'{input}' is not a positive whole number with a unit"))?;
    if value == 0 {
        return Err("duration must be positive".into());
    }
    let millis = value
        .checked_mul(unit_ms)
        .ok_or_else(|| format!("'{input}' is too large"))?;
    Ok(Duration::from_millis(millis))
}

#[cfg(test)]
mod tests {
    use super::parse;
    use std::time::Duration;

    #[test]
    fn parses_units() {
        assert_eq!(parse("250ms"), Ok(Duration::from_millis(250)));
        assert_eq!(parse("30s"), Ok(Duration::from_secs(30)));
        assert_eq!(parse("5m"), Ok(Duration::from_secs(300)));
        assert_eq!(parse("2h"), Ok(Duration::from_secs(7200)));
    }

    #[test]
    fn rejects_bad_input() {
        for bad in ["", "0s", "10", "-1s", "1.5s", "s", "99999999999999999999h"] {
            assert!(parse(bad).is_err(), "{bad}");
        }
    }
}
