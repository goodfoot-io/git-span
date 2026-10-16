use std::fmt;

/// A user-facing failure; the process reports it on stderr and exits 1.
#[derive(Debug)]
pub struct Error(pub String);

pub type Result<T> = std::result::Result<T, Error>;

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl From<std::io::Error> for Error {
    fn from(err: std::io::Error) -> Self {
        Error(err.to_string())
    }
}

macro_rules! bail {
    ($($arg:tt)*) => {
        return Err($crate::error::Error(format!($($arg)*)))
    };
}
