//! APU Server Binary
//!
//! Run with: cargo run -- [game_port] [client_port] [options]
//!
//! Options:
//!   --game-bind <addr>  Bind game port to address (default: 127.0.0.1)
//!                       Use 0.0.0.0 for network access (requires auth)
//!
//! Default ports:
//! - Game port: 6122 (games connect here to send commands)
//! - Client port: 6123 (players connect here via telnet)

use std::env;
use log::info;

use ascii_processing_unit::Server;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Initialize logging
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    // Parse command line args
    let args: Vec<String> = env::args().collect();

    let mut game_port: u16 = 6122;
    let mut client_port: u16 = 6123;
    let mut game_bind = "127.0.0.1".to_string();

    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--game-bind" => {
                if i + 1 < args.len() {
                    game_bind = args[i + 1].clone();
                    i += 2;
                } else {
                    eprintln!("Error: --game-bind requires an address");
                    std::process::exit(1);
                }
            }
            "--help" | "-h" => {
                println!("APU - ASCII Processing Unit v0.1.0");
                println!();
                println!("Usage: apu-server [game_port] [client_port] [options]");
                println!();
                println!("Options:");
                println!("  --game-bind <addr>  Bind game port to address (default: 127.0.0.1)");
                println!("                      Use 0.0.0.0 for network access");
                println!("  --help, -h          Show this help");
                println!();
                println!("Examples:");
                println!("  apu-server 6122 6123                    # Local game, public telnet");
                println!("  apu-server 6122 6123 --game-bind 0.0.0.0  # Network game connections");
                std::process::exit(0);
            }
            arg => {
                // Positional arguments: game_port, client_port
                if let Ok(port) = arg.parse::<u16>() {
                    if game_port == 6122 && i == 1 {
                        game_port = port;
                    } else {
                        client_port = port;
                    }
                }
                i += 1;
            }
        }
    }

    let network_warning = if game_bind == "0.0.0.0" {
        "\n║  ⚠️  WARNING: Game port open to network!                       ║"
    } else {
        ""
    };

    info!("╔═══════════════════════════════════════════════════════════════╗");
    info!("║            APU - ASCII Processing Unit v0.1.0                 ║");
    info!("║     Universal Character-Cell Display Engine                   ║");
    info!("╠═══════════════════════════════════════════════════════════════╣");
    info!("║  Game port:   {} (bind: {})                       ║", game_port, game_bind);
    info!("║  Client port: {} (bind: 0.0.0.0)                          ║", client_port);
    if !network_warning.is_empty() {
        info!("{}", network_warning.trim_start_matches('\n'));
    }
    info!("╚═══════════════════════════════════════════════════════════════╝");

    let server = Server::new(game_port, client_port, game_bind);
    server.run().await?;

    Ok(())
}
