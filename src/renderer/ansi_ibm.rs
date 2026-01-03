//! IBM PC ANSI Renderer
//!
//! Renders to IBM PC compatible ANSI terminals.
//! - 80x24 fixed size (default) or dynamic
//! - 16 colors (standard ANSI)
//! - CP437/Unicode character set

use crate::core::{Attrs, Cell, Color, Grid};
use super::{MouseMode, Renderer};

/// ANSI escape sequences
const CSI: &str = "\x1b[";

/// IBM ANSI Renderer
pub struct AnsiIbmRenderer {
    /// Display dimensions
    pub cols: usize,
    pub rows: usize,
    /// Track cursor position for optimization
    cursor_x: usize,
    cursor_y: usize,
    /// Track current attributes to minimize escape codes
    current_fg: Color,
    current_bg: Color,
    current_attrs: Attrs,
}

impl AnsiIbmRenderer {
    /// Create a new renderer with specified dimensions
    pub fn new(cols: usize, rows: usize) -> Self {
        Self {
            cols,
            rows,
            cursor_x: 0,
            cursor_y: 0,
            current_fg: Color::White,
            current_bg: Color::Black,
            current_attrs: Attrs::default(),
        }
    }

    /// Create a standard 80x24 renderer
    pub fn standard() -> Self {
        Self::new(80, 24)
    }

    /// Reset internal state
    pub fn reset(&mut self) {
        self.cursor_x = 0;
        self.cursor_y = 0;
        self.current_fg = Color::White;
        self.current_bg = Color::Black;
        self.current_attrs = Attrs::default();
    }

    /// Generate cursor move sequence
    fn move_cursor(&mut self, x: usize, y: usize) -> String {
        self.cursor_x = x;
        self.cursor_y = y;
        format!("{}{};{}H", CSI, y + 1, x + 1)
    }

    /// Generate SGR (color/attribute) sequence
    fn sgr(&mut self, fg: Color, bg: Color, attrs: Attrs) -> String {
        let mut codes: Vec<u8> = Vec::new();

        // Check if we need to reset (attrs were set before but not now)
        // All "turn on" attributes need reset to turn off - there's no SGR code to turn them off individually
        let needs_reset = (self.current_attrs.bold && !attrs.bold)
            || (self.current_attrs.dim && !attrs.dim)
            || (self.current_attrs.italic && !attrs.italic)
            || (self.current_attrs.underline && !attrs.underline)
            || (self.current_attrs.blink && !attrs.blink)
            || (self.current_attrs.reverse && !attrs.reverse);

        if needs_reset {
            codes.push(0); // Reset
            // After reset, terminal is at "default" state, not explicit White/Black
            // Use sentinel values to force color output for next cell
            self.current_fg = Color::BrightMagenta; // Unlikely color as sentinel
            self.current_bg = Color::BrightMagenta;
            self.current_attrs = Attrs::default();
        }

        // Add attribute codes
        if attrs.bold && !self.current_attrs.bold {
            codes.push(1);
        }
        if attrs.dim && !self.current_attrs.dim {
            codes.push(2);
        }
        if attrs.italic && !self.current_attrs.italic {
            codes.push(3);
        }
        if attrs.underline && !self.current_attrs.underline {
            codes.push(4);
        }
        if attrs.blink && !self.current_attrs.blink {
            codes.push(5);
        }
        if attrs.reverse && !self.current_attrs.reverse {
            codes.push(7);
        }

        // Foreground color
        if fg != self.current_fg {
            codes.push(fg.fg_code());
        }

        // Background color
        if bg != self.current_bg {
            codes.push(bg.bg_code());
        }

        // Update current state
        self.current_fg = fg;
        self.current_bg = bg;
        self.current_attrs = attrs;

        if codes.is_empty() {
            String::new()
        } else {
            let code_strs: Vec<String> = codes.iter().map(|c| c.to_string()).collect();
            format!("{}{}m", CSI, code_strs.join(";"))
        }
    }

    /// Render a single cell (SGR + character)
    fn render_cell(&mut self, cell: &Cell) -> String {
        let mut output = self.sgr(cell.fg, cell.bg, cell.attrs);
        // Sanitize control characters to prevent terminal corruption
        let ch = cell.char;
        if ch < ' ' || ch == '\x7f' {
            // Replace control characters with space
            output.push(' ');
        } else {
            output.push(ch);
        }
        output
    }
}

impl Renderer for AnsiIbmRenderer {
    fn name(&self) -> &str {
        "ansi-ibm"
    }

    fn dimensions(&self) -> (usize, usize) {
        (self.cols, self.rows)
    }

    fn init(&mut self) -> String {
        self.reset();
        format!(
            "{}?25l{}2J{}H{}0m",
            CSI, CSI, CSI, CSI
        )
    }

    fn shutdown(&self) -> String {
        // Disable mouse mode, reset attributes, show cursor, clear screen, home cursor
        format!(
            "{}{}0m{}?25h{}2J{}H",
            self.disable_mouse(), CSI, CSI, CSI, CSI
        )
    }

    fn clear(&self) -> String {
        format!("{}2J{}H", CSI, CSI)
    }

    fn render_full(&mut self, grid: &Grid) -> String {
        let mut output = String::with_capacity(grid.cols * grid.rows * 10);

        // Reset state
        self.reset();

        // Just home cursor (no clear - that causes flicker during drag/resize)
        output.push_str(&format!("{}H{}0m", CSI, CSI));

        // Render each row
        for y in 0..grid.rows.min(self.rows) {
            output.push_str(&self.move_cursor(0, y));
            for x in 0..grid.cols.min(self.cols) {
                if let Some(cell) = grid.get(x, y) {
                    output.push_str(&self.render_cell(cell));
                }
            }
        }

        output
    }

    fn render_dirty(&mut self, grid: &Grid) -> String {
        // Count dirty cells
        let dirty_count = grid.iter_dirty().count();

        // If more than 50% dirty, do full redraw
        let total = grid.cols * grid.rows;
        if dirty_count > total / 2 {
            return self.render_full(grid);
        }

        let mut output = String::with_capacity(dirty_count * 15);
        let mut last_x: Option<usize> = None;
        let mut last_y: Option<usize> = None;

        // Collect dirty cells and sort by position
        let mut dirty: Vec<_> = grid.iter_dirty().collect();
        dirty.sort_by(|a, b| {
            if a.1 != b.1 {
                a.1.cmp(&b.1)
            } else {
                a.0.cmp(&b.0)
            }
        });

        for (x, y, cell) in dirty {
            // Move cursor if needed
            let need_move = match (last_x, last_y) {
                (Some(lx), Some(ly)) => !(y == ly && x == lx + 1),
                _ => true,
            };

            if need_move {
                output.push_str(&self.move_cursor(x, y));
            }

            output.push_str(&self.render_cell(cell));

            last_x = Some(x);
            last_y = Some(y);
        }

        output
    }

    fn enable_mouse(&self, mode: MouseMode) -> String {
        match mode {
            MouseMode::None => self.disable_mouse(),
            MouseMode::Normal => format!("{}?1000h", CSI),
            MouseMode::Button => format!("{}?1002h", CSI),
            MouseMode::Any => format!("{}?1003h", CSI),
            MouseMode::Sgr => {
                // Enable SGR extended mode + button event tracking
                format!("{}?1006h{}?1002h", CSI, CSI)
            }
        }
    }

    fn disable_mouse(&self) -> String {
        // Disable all mouse modes
        format!(
            "{}?1000l{}?1002l{}?1003l{}?1006l",
            CSI, CSI, CSI, CSI
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_renderer_init() {
        let mut renderer = AnsiIbmRenderer::standard();
        let init = renderer.init();
        assert!(init.contains("\x1b[?25l")); // Hide cursor
        assert!(init.contains("\x1b[2J"));   // Clear screen
    }

    #[test]
    fn test_render_simple() {
        let mut renderer = AnsiIbmRenderer::new(10, 5);
        let mut grid = Grid::new(10, 5);
        grid.set(0, 0, 'X', Color::Red, Color::Black, Attrs::default());

        let output = renderer.render_full(&grid);
        assert!(output.contains("X"));
        assert!(output.contains("31")); // Red foreground
    }
}
