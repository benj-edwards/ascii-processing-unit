//! APU Cell - The fundamental display unit
//!
//! Each cell represents one character position with:
//! - Character (Unicode codepoint)
//! - Foreground color (0-15 ANSI, or extended)
//! - Background color (0-15 ANSI, or extended)
//! - Attributes (bold, blink, reverse, etc.)

use serde::{Deserialize, Serialize};

/// Standard ANSI 16-color palette
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[repr(u8)]
pub enum Color {
    Black = 0,
    Red = 1,
    Green = 2,
    Yellow = 3,
    Blue = 4,
    Magenta = 5,
    Cyan = 6,
    White = 7,
    BrightBlack = 8,   // Gray
    BrightRed = 9,
    BrightGreen = 10,
    BrightYellow = 11,
    BrightBlue = 12,
    BrightMagenta = 13,
    BrightCyan = 14,
    BrightWhite = 15,
}

impl Default for Color {
    fn default() -> Self {
        Color::White
    }
}

impl From<u8> for Color {
    fn from(v: u8) -> Self {
        match v {
            0 => Color::Black,
            1 => Color::Red,
            2 => Color::Green,
            3 => Color::Yellow,
            4 => Color::Blue,
            5 => Color::Magenta,
            6 => Color::Cyan,
            7 => Color::White,
            8 => Color::BrightBlack,
            9 => Color::BrightRed,
            10 => Color::BrightGreen,
            11 => Color::BrightYellow,
            12 => Color::BrightBlue,
            13 => Color::BrightMagenta,
            14 => Color::BrightCyan,
            15 => Color::BrightWhite,
            _ => Color::White,
        }
    }
}

impl Color {
    /// Get ANSI SGR code for foreground
    pub fn fg_code(&self) -> u8 {
        let v = *self as u8;
        if v < 8 { 30 + v } else { 90 + (v - 8) }
    }

    /// Get ANSI SGR code for background
    pub fn bg_code(&self) -> u8 {
        let v = *self as u8;
        if v < 8 { 40 + v } else { 100 + (v - 8) }
    }
}

/// Cell attributes (bold, blink, etc.)
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Attrs {
    pub bold: bool,
    pub dim: bool,
    pub italic: bool,
    pub underline: bool,
    pub blink: bool,
    pub reverse: bool,
}

impl Attrs {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn bold(mut self) -> Self {
        self.bold = true;
        self
    }

    pub fn blink(mut self) -> Self {
        self.blink = true;
        self
    }

    pub fn reverse(mut self) -> Self {
        self.reverse = true;
        self
    }

    /// Check if any attributes are set
    pub fn any(&self) -> bool {
        self.bold || self.dim || self.italic || self.underline || self.blink || self.reverse
    }

    /// Generate ANSI SGR codes for these attributes
    pub fn sgr_codes(&self) -> Vec<u8> {
        let mut codes = Vec::new();
        if self.bold { codes.push(1); }
        if self.dim { codes.push(2); }
        if self.italic { codes.push(3); }
        if self.underline { codes.push(4); }
        if self.blink { codes.push(5); }
        if self.reverse { codes.push(7); }
        codes
    }
}

/// A single character cell
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Cell {
    /// The character to display (Unicode)
    pub char: char,
    /// Foreground color
    pub fg: Color,
    /// Background color
    pub bg: Color,
    /// Display attributes
    pub attrs: Attrs,
    /// Whether this cell needs redrawing
    #[serde(skip)]
    pub dirty: bool,
}

impl Default for Cell {
    fn default() -> Self {
        Self {
            char: ' ',
            fg: Color::White,
            bg: Color::Black,
            attrs: Attrs::default(),
            dirty: true,
        }
    }
}

impl Cell {
    /// Create a new cell with given character
    pub fn new(char: char) -> Self {
        Self {
            char,
            ..Default::default()
        }
    }

    /// Create a cell with full specification
    pub fn with_colors(char: char, fg: Color, bg: Color) -> Self {
        Self {
            char,
            fg,
            bg,
            attrs: Attrs::default(),
            dirty: true,
        }
    }

    /// Create a cell with all properties
    pub fn full(char: char, fg: Color, bg: Color, attrs: Attrs) -> Self {
        Self {
            char,
            fg,
            bg,
            attrs,
            dirty: true,
        }
    }

    /// Set character and mark dirty
    pub fn set_char(&mut self, char: char) {
        if self.char != char {
            self.char = char;
            self.dirty = true;
        }
    }

    /// Set foreground color and mark dirty
    pub fn set_fg(&mut self, fg: Color) {
        if self.fg != fg {
            self.fg = fg;
            self.dirty = true;
        }
    }

    /// Set background color and mark dirty
    pub fn set_bg(&mut self, bg: Color) {
        if self.bg != bg {
            self.bg = bg;
            self.dirty = true;
        }
    }

    /// Set all properties and mark dirty if changed
    pub fn set(&mut self, char: char, fg: Color, bg: Color, attrs: Attrs) {
        if self.char != char || self.fg != fg || self.bg != bg || self.attrs != attrs {
            self.char = char;
            self.fg = fg;
            self.bg = bg;
            self.attrs = attrs;
            self.dirty = true;
        }
    }

    /// Clear the cell to defaults
    pub fn clear(&mut self) {
        *self = Self::default();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_color_codes() {
        assert_eq!(Color::Black.fg_code(), 30);
        assert_eq!(Color::White.fg_code(), 37);
        assert_eq!(Color::BrightRed.fg_code(), 91);
        assert_eq!(Color::Black.bg_code(), 40);
        assert_eq!(Color::BrightWhite.bg_code(), 107);
    }

    #[test]
    fn test_cell_dirty() {
        let mut cell = Cell::default();
        cell.dirty = false;
        cell.set_char('X');
        assert!(cell.dirty);
    }
}
