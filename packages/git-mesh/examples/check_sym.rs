fn main() {
    let p = std::path::PathBuf::from(std::env::args().nth(1).unwrap());
    let s: u32 = std::env::args().nth(2).unwrap().parse().unwrap();
    let e: u32 = std::env::args().nth(3).unwrap().parse().unwrap();
    let r = git_mesh::advice::suggest::symbol_extent::enclosing_symbol_range(&p, (s, e));
    println!("{:?}", r);
}
