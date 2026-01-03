//! APU Renderer Module
//!
//! Renderers convert the cell grid to terminal output.

pub mod ansi_ibm;

pub use ansi_ibm::AnsiIbmRenderer;

/// Mouse tracking mode
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MouseMode {
    /// No mouse tracking
    None,
    /// Normal tracking - press and release
    Normal,
    /// Button event tracking - press, release, and drag
    Button,
    /// Any event tracking - all motion
    Any,
    /// SGR extended mode (better for large screens)
    Sgr,
}

impl MouseMode {
    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "normal" => MouseMode::Normal,
            "button" => MouseMode::Button,
            "any" => MouseMode::Any,
            "sgr" => MouseMode::Sgr,
            "none" | "off" => MouseMode::None,
            _ => MouseMode::Sgr, // Default to SGR
        }
    }
}

/// Trait for renderers
pub trait Renderer {
    /// Renderer name
    fn name(&self) -> &str;

    /// Display dimensions
    fn dimensions(&self) -> (usize, usize);

    /// Initialize sequence
    fn init(&mut self) -> String;

    /// Shutdown sequence
    fn shutdown(&self) -> String;

    /// Clear screen
    fn clear(&self) -> String;

    /// Render entire grid
    fn render_full(&mut self, grid: &crate::core::Grid) -> String;

    /// Render only dirty cells
    fn render_dirty(&mut self, grid: &crate::core::Grid) -> String;

    /// Auto-choose render method
    fn render(&mut self, grid: &crate::core::Grid, force_full: bool) -> String {
        if force_full {
            self.render_full(grid)
        } else {
            self.render_dirty(grid)
        }
    }

    /// Enable mouse tracking
    fn enable_mouse(&self, mode: MouseMode) -> String;

    /// Disable mouse tracking
    fn disable_mouse(&self) -> String;
}
