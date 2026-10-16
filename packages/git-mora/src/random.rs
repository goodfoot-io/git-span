use crate::error::{Error, Result};

#[cfg(unix)]
pub fn bytes<const N: usize>() -> Result<[u8; N]> {
    use std::io::Read;
    let mut buf = [0u8; N];
    std::fs::File::open("/dev/urandom")
        .and_then(|mut f| f.read_exact(&mut buf))
        .map_err(|err| Error(format!("cannot read OS randomness: {err}")))?;
    Ok(buf)
}

#[cfg(windows)]
pub fn bytes<const N: usize>() -> Result<[u8; N]> {
    #[link(name = "advapi32")]
    unsafe extern "system" {
        #[link_name = "SystemFunction036"]
        fn rtl_gen_random(buffer: *mut u8, length: u32) -> u8;
    }
    let mut buf = [0u8; N];
    let len = u32::try_from(N).map_err(|_| Error("random request too large".into()))?;
    // SAFETY: `buf` is a valid writable allocation of exactly `len` bytes.
    let ok = unsafe { rtl_gen_random(buf.as_mut_ptr(), len) };
    if ok == 0 {
        return Err(Error("cannot read OS randomness".into()));
    }
    Ok(buf)
}

/// 128 random bits as 32 lowercase hex characters.
pub fn attempt_id() -> Result<String> {
    Ok(bytes::<16>()?.iter().map(|b| format!("{b:02x}")).collect())
}
