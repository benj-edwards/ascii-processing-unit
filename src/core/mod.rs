//! APU Core Module
//!
//! Core data structures for the display engine:
//! - Cell: Individual character cell
//! - Grid: 2D display buffer
//! - Window: Bordered content region

pub mod cell;
pub mod grid;
pub mod window;

pub use cell::{Attrs, Cell, Color};
pub use grid::{box_styles, BoxChars, Grid};
pub use window::{Window, WindowManager, InteractionState, DragState, ResizeState, TitleBarClick};
