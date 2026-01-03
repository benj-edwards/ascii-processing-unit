//! APU - ASCII Processing Unit
//!
//! A universal character-cell display engine for terminal applications.
//!
//! # Overview
//!
//! APU provides:
//! - A cell grid for display buffering
//! - A window manager for overlapping windows
//! - Renderers for different terminal types (starting with IBM ANSI)
//! - A JSON protocol for game integration
//! - A TCP server for network connections
//!
//! # Example
//!
//! ```no_run
//! use ascii_processing_unit::core::{Grid, Color, WindowManager};
//! use ascii_processing_unit::renderer::{AnsiIbmRenderer, Renderer};
//!
//! let mut wm = WindowManager::new(80, 24);
//! let win = wm.create_window("main", 10, 5, 40, 10);
//! win.print(2, 2, "Hello APU!", Color::BrightGreen, None);
//!
//! wm.composite();
//!
//! let mut renderer = AnsiIbmRenderer::standard();
//! let output = renderer.render_full(&wm.display);
//! print!("{}", output);
//! ```

pub mod core;
pub mod renderer;
pub mod protocol;
pub mod server;
pub mod input;
pub mod terminal;

// Re-export commonly used types
pub use core::{Cell, Color, Attrs, Grid, Window, WindowManager};
pub use renderer::{AnsiIbmRenderer, Renderer};
pub use protocol::{Command, Response};
pub use server::Server;
pub use input::{InputEvent, InputParser, Key, MouseButton, MouseEvent, Modifiers};
pub use terminal::{Terminal, TerminalType};
