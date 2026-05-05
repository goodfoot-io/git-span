// Fixture for symbol_extent integration tests.
// `foo` spans lines 10..=25; an inner range like 15..=18 should resolve
// to (10, 25, "foo").

pub struct Bar {
    pub x: u32,
}

// Line 10 begins here.
pub fn foo(input: u32) -> u32 {
    let mut acc = 0u32;
    for i in 0..input {
        acc = acc.wrapping_add(i);
    }
    if acc > 100 {
        acc -= 1;
    } else {
        acc += 1;
    }
    acc = acc.wrapping_mul(2);
    acc = acc.wrapping_add(7);
    acc = acc.wrapping_sub(3);
    acc = acc.wrapping_add(11);
    acc
}
