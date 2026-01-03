//! APU Cell Grid - The display buffer
//!
//! A 2D array of cells representing the terminal display.
//! Supports efficient dirty-rectangle tracking for optimized updates.

use super::cell::{Attrs, Cell, Color};

/// Box drawing character sets
pub struct BoxChars {
    pub tl: char,  // Top-left corner
    pub tr: char,  // Top-right corner
    pub bl: char,  // Bottom-left corner
    pub br: char,  // Bottom-right corner
    pub h: char,   // Horizontal line
    pub v: char,   // Vertical line
    pub lt: char,  // Left tee
    pub rt: char,  // Right tee
    pub tt: char,  // Top tee
    pub bt: char,  // Bottom tee
    pub cross: char, // Cross/plus
}

/// Predefined box styles
pub mod box_styles {
    use super::BoxChars;

    pub const SINGLE: BoxChars = BoxChars {
        tl: '┌', tr: '┐', bl: '└', br: '┘',
        h: '─', v: '│',
        lt: '├', rt: '┤', tt: '┬', bt: '┴',
        cross: '┼',
    };

    pub const DOUBLE: BoxChars = BoxChars {
        tl: '╔', tr: '╗', bl: '╚', br: '╝',
        h: '═', v: '║',
        lt: '╠', rt: '╣', tt: '╦', bt: '╩',
        cross: '╬',
    };

    pub const ROUNDED: BoxChars = BoxChars {
        tl: '╭', tr: '╮', bl: '╰', br: '╯',
        h: '─', v: '│',
        lt: '├', rt: '┤', tt: '┬', bt: '┴',
        cross: '┼',
    };

    pub const HEAVY: BoxChars = BoxChars {
        tl: '┏', tr: '┓', bl: '┗', br: '┛',
        h: '━', v: '┃',
        lt: '┣', rt: '┫', tt: '┳', bt: '┻',
        cross: '╋',
    };

    pub const ASCII: BoxChars = BoxChars {
        tl: '+', tr: '+', bl: '+', br: '+',
        h: '-', v: '|',
        lt: '+', rt: '+', tt: '+', bt: '+',
        cross: '+',
    };
}

/// The display grid - a 2D array of cells
pub struct Grid {
    /// Grid width in columns
    pub cols: usize,
    /// Grid height in rows
    pub rows: usize,
    /// The cell buffer (row-major order)
    cells: Vec<Cell>,
}

impl Grid {
    /// Create a new grid with given dimensions
    pub fn new(cols: usize, rows: usize) -> Self {
        let cells = vec![Cell::default(); cols * rows];
        Self { cols, rows, cells }
    }

    /// Get the index for a position
    #[inline]
    fn index(&self, x: usize, y: usize) -> Option<usize> {
        if x < self.cols && y < self.rows {
            Some(y * self.cols + x)
        } else {
            None
        }
    }

    /// Get a reference to a cell
    pub fn get(&self, x: usize, y: usize) -> Option<&Cell> {
        self.index(x, y).map(|i| &self.cells[i])
    }

    /// Get a mutable reference to a cell
    pub fn get_mut(&mut self, x: usize, y: usize) -> Option<&mut Cell> {
        self.index(x, y).map(|i| &mut self.cells[i])
    }

    /// Set a cell at position
    pub fn set(&mut self, x: usize, y: usize, char: char, fg: Color, bg: Color, attrs: Attrs) {
        if let Some(cell) = self.get_mut(x, y) {
            cell.set(char, fg, bg, attrs);
        }
    }

    /// Set just the character at position
    pub fn set_char(&mut self, x: usize, y: usize, char: char) {
        if let Some(cell) = self.get_mut(x, y) {
            cell.set_char(char);
        }
    }

    /// Clear the entire grid
    pub fn clear(&mut self) {
        for cell in &mut self.cells {
            cell.clear();
        }
    }

    /// Clear with specific character and colors
    pub fn clear_with(&mut self, char: char, fg: Color, bg: Color) {
        for cell in &mut self.cells {
            cell.char = char;
            cell.fg = fg;
            cell.bg = bg;
            cell.attrs = Attrs::default();
            cell.dirty = true;
        }
    }

    /// Copy contents from another grid
    pub fn copy_from(&mut self, other: &Grid) {
        // Only copy if dimensions match
        if self.cols == other.cols && self.rows == other.rows {
            for (dst, src) in self.cells.iter_mut().zip(other.cells.iter()) {
                dst.char = src.char;
                dst.fg = src.fg;
                dst.bg = src.bg;
                dst.attrs = src.attrs;
                dst.dirty = true;
            }
        }
    }

    /// Write a string at position
    pub fn write_str(&mut self, x: usize, y: usize, s: &str, fg: Color, bg: Color, attrs: Attrs) {
        for (i, ch) in s.chars().enumerate() {
            let px = x + i;
            if px >= self.cols {
                break;
            }
            self.set(px, y, ch, fg, bg, attrs);
        }
    }

    /// Fill a rectangular region
    pub fn fill_rect(&mut self, x: usize, y: usize, w: usize, h: usize, char: char, fg: Color, bg: Color) {
        for dy in 0..h {
            for dx in 0..w {
                self.set(x + dx, y + dy, char, fg, bg, Attrs::default());
            }
        }
    }

    /// Draw a box border
    pub fn draw_box(&mut self, x: usize, y: usize, w: usize, h: usize, style: &BoxChars, fg: Color, bg: Color) {
        if w < 2 || h < 2 {
            return;
        }

        let attrs = Attrs::default();

        // Corners
        self.set(x, y, style.tl, fg, bg, attrs);
        self.set(x + w - 1, y, style.tr, fg, bg, attrs);
        self.set(x, y + h - 1, style.bl, fg, bg, attrs);
        self.set(x + w - 1, y + h - 1, style.br, fg, bg, attrs);

        // Horizontal lines
        for dx in 1..w - 1 {
            self.set(x + dx, y, style.h, fg, bg, attrs);
            self.set(x + dx, y + h - 1, style.h, fg, bg, attrs);
        }

        // Vertical lines
        for dy in 1..h - 1 {
            self.set(x, y + dy, style.v, fg, bg, attrs);
            self.set(x + w - 1, y + dy, style.v, fg, bg, attrs);
        }
    }

    /// Draw horizontal line
    pub fn hline(&mut self, x: usize, y: usize, len: usize, char: char, fg: Color, bg: Color) {
        for dx in 0..len {
            self.set(x + dx, y, char, fg, bg, Attrs::default());
        }
    }

    /// Draw vertical line
    pub fn vline(&mut self, x: usize, y: usize, len: usize, char: char, fg: Color, bg: Color) {
        for dy in 0..len {
            self.set(x, y + dy, char, fg, bg, Attrs::default());
        }
    }

    /// Mark all cells as dirty
    pub fn mark_all_dirty(&mut self) {
        for cell in &mut self.cells {
            cell.dirty = true;
        }
    }

    /// Mark all cells as clean
    pub fn mark_all_clean(&mut self) {
        for cell in &mut self.cells {
            cell.dirty = false;
        }
    }

    /// Check if any cells are dirty
    pub fn is_dirty(&self) -> bool {
        self.cells.iter().any(|c| c.dirty)
    }

    /// Get iterator over all cells with positions
    pub fn iter(&self) -> impl Iterator<Item = (usize, usize, &Cell)> {
        self.cells.iter().enumerate().map(move |(i, cell)| {
            let x = i % self.cols;
            let y = i / self.cols;
            (x, y, cell)
        })
    }

    /// Get iterator over dirty cells with positions
    pub fn iter_dirty(&self) -> impl Iterator<Item = (usize, usize, &Cell)> {
        self.iter().filter(|(_, _, cell)| cell.dirty)
    }

    /// Resize the grid (content is lost)
    pub fn resize(&mut self, cols: usize, rows: usize) {
        self.cols = cols;
        self.rows = rows;
        self.cells = vec![Cell::default(); cols * rows];
    }

    /// Copy region from another grid
    pub fn blit(&mut self, src: &Grid, src_x: usize, src_y: usize, dst_x: usize, dst_y: usize, w: usize, h: usize) {
        for dy in 0..h {
            for dx in 0..w {
                if let Some(src_cell) = src.get(src_x + dx, src_y + dy) {
                    if let Some(dst_cell) = self.get_mut(dst_x + dx, dst_y + dy) {
                        dst_cell.char = src_cell.char;
                        dst_cell.fg = src_cell.fg;
                        dst_cell.bg = src_cell.bg;
                        dst_cell.attrs = src_cell.attrs;
                        dst_cell.dirty = true;
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_grid_new() {
        let grid = Grid::new(80, 24);
        assert_eq!(grid.cols, 80);
        assert_eq!(grid.rows, 24);
    }

    #[test]
    fn test_grid_set_get() {
        let mut grid = Grid::new(80, 24);
        grid.set(10, 5, 'X', Color::Red, Color::Black, Attrs::default());

        let cell = grid.get(10, 5).unwrap();
        assert_eq!(cell.char, 'X');
        assert_eq!(cell.fg, Color::Red);
    }

    #[test]
    fn test_grid_write_str() {
        let mut grid = Grid::new(80, 24);
        grid.write_str(5, 10, "Hello", Color::Green, Color::Black, Attrs::default());

        assert_eq!(grid.get(5, 10).unwrap().char, 'H');
        assert_eq!(grid.get(6, 10).unwrap().char, 'e');
        assert_eq!(grid.get(9, 10).unwrap().char, 'o');
    }
}
