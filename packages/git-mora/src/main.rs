use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "git-mora", version, about)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Print a greeting.
    HelloWorld,
}

fn main() {
    match Cli::parse().command {
        Command::HelloWorld => println!("Hello world"),
    }
}
