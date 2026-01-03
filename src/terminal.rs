//! Terminal Emulator Module
//!
//! Provides ANSI terminal emulation for remote connections.
//! Parses incoming ANSI escape sequences and maintains terminal state.

use crate::core::{Cell, Color, Attrs};
use tokio::sync::mpsc;
use std::collections::VecDeque;

/// Terminal emulator state
pub struct Terminal {
    /// Terminal ID (window ID)
    pub id: String,
    /// Screen buffer
    pub screen: Vec<Vec<Cell>>,
    /// Width in characters
    pub width: usize,
    /// Height in characters
    pub height: usize,
    /// Cursor X position
    pub cursor_x: usize,
    /// Cursor Y position
    pub cursor_y: usize,
    /// Current foreground color
    pub fg: Color,
    /// Current background color
    pub bg: Color,
    /// Current attributes
    pub attrs: Attrs,
    /// Saved cursor position (for ESC 7 / ESC 8)
    pub saved_cursor: Option<(usize, usize)>,
    /// Scrollback buffer
    pub scrollback: VecDeque<Vec<Cell>>,
    /// Max scrollback lines
    pub max_scrollback: usize,
    /// Whether display needs refresh
    pub dirty: bool,
    /// Parser state
    parser_state: ParserState,
    /// Escape sequence buffer
    esc_buffer: String,
    /// Terminal type for compatibility
    pub terminal_type: TerminalType,
    /// Response queue - data to send back to remote server
    pub response_queue: VecDeque<Vec<u8>>,
}

/// Parser state machine
#[derive(Debug, Clone, PartialEq)]
enum ParserState {
    /// Normal text input
    Normal,
    /// Got ESC, waiting for next char
    Escape,
    /// Got ESC [, reading CSI sequence
    Csi,
    /// Got ESC ], reading OSC sequence
    Osc,
}

/// Terminal type for compatibility
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum TerminalType {
    /// Full ANSI color support (16 colors)
    Ansi,
    /// VT100 compatible (limited)
    Vt100,
    /// XTerm (256 colors, more features)
    Xterm,
    /// Raw mode - no parsing, just display
    Raw,
}

impl TerminalType {
    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "vt100" => TerminalType::Vt100,
            "xterm" => TerminalType::Xterm,
            "raw" => TerminalType::Raw,
            _ => TerminalType::Ansi,
        }
    }
}

impl Terminal {
    /// Create a new terminal with given dimensions
    pub fn new(id: String, width: usize, height: usize, terminal_type: TerminalType) -> Self {
        let default_cell = Cell::full(' ', Color::White, Color::Black, Attrs::default());
        let screen = vec![vec![default_cell.clone(); width]; height];

        Terminal {
            id,
            screen,
            width,
            height,
            cursor_x: 0,
            cursor_y: 0,
            fg: Color::White,
            bg: Color::Black,
            attrs: Attrs::default(),
            saved_cursor: None,
            scrollback: VecDeque::new(),
            max_scrollback: 1000,
            dirty: true,
            parser_state: ParserState::Normal,
            esc_buffer: String::new(),
            terminal_type,
            response_queue: VecDeque::new(),
        }
    }

    /// Process incoming data from remote server
    pub fn process_data(&mut self, data: &[u8]) {
        if self.terminal_type == TerminalType::Raw {
            // Raw mode - just display printable characters
            for &byte in data {
                if byte >= 32 && byte < 127 {
                    self.put_char(byte as char);
                } else if byte == b'\n' {
                    self.newline();
                } else if byte == b'\r' {
                    self.cursor_x = 0;
                }
            }
            self.dirty = true;
            return;
        }

        // Parse ANSI sequences
        for &byte in data {
            self.process_byte(byte);
        }
        self.dirty = true;
    }

    /// Process a single byte
    fn process_byte(&mut self, byte: u8) {
        match self.parser_state {
            ParserState::Normal => {
                match byte {
                    0x1b => {
                        // ESC - start escape sequence
                        self.parser_state = ParserState::Escape;
                        self.esc_buffer.clear();
                    }
                    0x07 => {
                        // BEL - bell (ignore)
                    }
                    0x08 => {
                        // BS - backspace
                        if self.cursor_x > 0 {
                            self.cursor_x -= 1;
                        }
                    }
                    0x09 => {
                        // TAB - move to next tab stop
                        self.cursor_x = (self.cursor_x + 8) & !7;
                        if self.cursor_x >= self.width {
                            self.cursor_x = self.width - 1;
                        }
                    }
                    0x0a => {
                        // LF - line feed
                        self.newline();
                    }
                    0x0d => {
                        // CR - carriage return
                        self.cursor_x = 0;
                    }
                    0x20..=0x7e => {
                        // Printable ASCII
                        self.put_char(byte as char);
                    }
                    0x80..=0xff => {
                        // Extended ASCII / CP437 - display as-is
                        self.put_char(byte as char);
                    }
                    _ => {
                        // Ignore other control characters
                    }
                }
            }
            ParserState::Escape => {
                match byte {
                    b'[' => {
                        // CSI - Control Sequence Introducer
                        self.parser_state = ParserState::Csi;
                        self.esc_buffer.clear();
                    }
                    b']' => {
                        // OSC - Operating System Command
                        self.parser_state = ParserState::Osc;
                        self.esc_buffer.clear();
                    }
                    b'7' => {
                        // Save cursor position
                        self.saved_cursor = Some((self.cursor_x, self.cursor_y));
                        self.parser_state = ParserState::Normal;
                    }
                    b'8' => {
                        // Restore cursor position
                        if let Some((x, y)) = self.saved_cursor {
                            self.cursor_x = x;
                            self.cursor_y = y;
                        }
                        self.parser_state = ParserState::Normal;
                    }
                    b'D' => {
                        // Index (move down, scroll if needed)
                        self.newline();
                        self.parser_state = ParserState::Normal;
                    }
                    b'E' => {
                        // Next line
                        self.cursor_x = 0;
                        self.newline();
                        self.parser_state = ParserState::Normal;
                    }
                    b'M' => {
                        // Reverse index (move up, scroll if needed)
                        if self.cursor_y > 0 {
                            self.cursor_y -= 1;
                        }
                        self.parser_state = ParserState::Normal;
                    }
                    b'c' => {
                        // Reset terminal
                        self.reset();
                        self.parser_state = ParserState::Normal;
                    }
                    _ => {
                        // Unknown escape sequence, ignore
                        self.parser_state = ParserState::Normal;
                    }
                }
            }
            ParserState::Csi => {
                if byte >= 0x40 && byte <= 0x7e {
                    // Final byte - execute sequence
                    self.execute_csi(byte as char);
                    self.parser_state = ParserState::Normal;
                } else {
                    // Parameter byte
                    self.esc_buffer.push(byte as char);
                }
            }
            ParserState::Osc => {
                if byte == 0x07 || byte == 0x1b {
                    // BEL or ESC terminates OSC
                    // We ignore OSC sequences for now (window title, etc.)
                    self.parser_state = ParserState::Normal;
                } else {
                    self.esc_buffer.push(byte as char);
                }
            }
        }
    }

    /// Execute a CSI sequence
    fn execute_csi(&mut self, final_byte: char) {
        let params: Vec<usize> = self.esc_buffer
            .split(';')
            .map(|s| s.parse().unwrap_or(0))
            .collect();

        match final_byte {
            'A' => {
                // Cursor up
                let n = params.first().copied().unwrap_or(1).max(1);
                self.cursor_y = self.cursor_y.saturating_sub(n);
            }
            'B' => {
                // Cursor down
                let n = params.first().copied().unwrap_or(1).max(1);
                self.cursor_y = (self.cursor_y + n).min(self.height - 1);
            }
            'C' => {
                // Cursor forward
                let n = params.first().copied().unwrap_or(1).max(1);
                self.cursor_x = (self.cursor_x + n).min(self.width - 1);
            }
            'D' => {
                // Cursor back
                let n = params.first().copied().unwrap_or(1).max(1);
                self.cursor_x = self.cursor_x.saturating_sub(n);
            }
            'E' => {
                // Cursor next line
                let n = params.first().copied().unwrap_or(1).max(1);
                self.cursor_y = (self.cursor_y + n).min(self.height - 1);
                self.cursor_x = 0;
            }
            'F' => {
                // Cursor previous line
                let n = params.first().copied().unwrap_or(1).max(1);
                self.cursor_y = self.cursor_y.saturating_sub(n);
                self.cursor_x = 0;
            }
            'G' => {
                // Cursor horizontal absolute
                let n = params.first().copied().unwrap_or(1).max(1);
                self.cursor_x = (n - 1).min(self.width - 1);
            }
            'H' | 'f' => {
                // Cursor position
                let row = params.first().copied().unwrap_or(1).max(1);
                let col = params.get(1).copied().unwrap_or(1).max(1);
                self.cursor_y = (row - 1).min(self.height - 1);
                self.cursor_x = (col - 1).min(self.width - 1);
            }
            'J' => {
                // Erase in display
                let n = params.first().copied().unwrap_or(0);
                match n {
                    0 => self.erase_below(),
                    1 => self.erase_above(),
                    2 | 3 => self.erase_all(),
                    _ => {}
                }
            }
            'K' => {
                // Erase in line
                let n = params.first().copied().unwrap_or(0);
                match n {
                    0 => self.erase_line_right(),
                    1 => self.erase_line_left(),
                    2 => self.erase_line(),
                    _ => {}
                }
            }
            'S' => {
                // Scroll up
                let n = params.first().copied().unwrap_or(1).max(1);
                for _ in 0..n {
                    self.scroll_up();
                }
            }
            'T' => {
                // Scroll down
                let n = params.first().copied().unwrap_or(1).max(1);
                for _ in 0..n {
                    self.scroll_down();
                }
            }
            'm' => {
                // SGR - Select Graphic Rendition (colors/attributes)
                self.process_sgr(&params);
            }
            's' => {
                // Save cursor position
                self.saved_cursor = Some((self.cursor_x, self.cursor_y));
            }
            'u' => {
                // Restore cursor position
                if let Some((x, y)) = self.saved_cursor {
                    self.cursor_x = x;
                    self.cursor_y = y;
                }
            }
            'n' => {
                // Device Status Report
                let n = params.first().copied().unwrap_or(0);
                if n == 6 {
                    // ESC[6n - Cursor Position Report request
                    // Respond with ESC[row;colR (1-indexed)
                    let response = format!("\x1b[{};{}R", self.cursor_y + 1, self.cursor_x + 1);
                    self.response_queue.push_back(response.into_bytes());
                }
                // n=5 is status report (we'd respond ESC[0n for "OK") - ignore for now
            }
            'h' | 'l' => {
                // Mode set/reset - we ignore most of these
            }
            _ => {
                // Unknown CSI sequence
            }
        }
    }

    /// Process SGR (Select Graphic Rendition) parameters
    fn process_sgr(&mut self, params: &[usize]) {
        if params.is_empty() {
            // ESC[m means reset
            self.fg = Color::White;
            self.bg = Color::Black;
            self.attrs = Attrs::default();
            return;
        }

        let mut i = 0;
        while i < params.len() {
            match params[i] {
                0 => {
                    // Reset
                    self.fg = Color::White;
                    self.bg = Color::Black;
                    self.attrs = Attrs::default();
                }
                1 => self.attrs.bold = true,
                2 => self.attrs.dim = true,
                3 => self.attrs.italic = true,
                4 => self.attrs.underline = true,
                5 | 6 => self.attrs.blink = true,
                7 => self.attrs.reverse = true,
                8 => {} // Hidden - not supported
                9 => {} // Strikethrough - not supported
                21 => self.attrs.bold = false,
                22 => { self.attrs.bold = false; self.attrs.dim = false; }
                23 => self.attrs.italic = false,
                24 => self.attrs.underline = false,
                25 => self.attrs.blink = false,
                27 => self.attrs.reverse = false,
                29 => {} // Strikethrough - not supported
                30..=37 => {
                    // Standard foreground colors
                    self.fg = Color::from(params[i] as u8 - 30);
                }
                38 => {
                    // Extended foreground color
                    if i + 2 < params.len() && params[i + 1] == 5 {
                        // 256-color mode
                        self.fg = Color::from(params[i + 2] as u8);
                        i += 2;
                    }
                }
                39 => self.fg = Color::White, // Default foreground
                40..=47 => {
                    // Standard background colors
                    self.bg = Color::from(params[i] as u8 - 40);
                }
                48 => {
                    // Extended background color
                    if i + 2 < params.len() && params[i + 1] == 5 {
                        // 256-color mode
                        self.bg = Color::from(params[i + 2] as u8);
                        i += 2;
                    }
                }
                49 => self.bg = Color::Black, // Default background
                90..=97 => {
                    // Bright foreground colors
                    self.fg = Color::from(params[i] as u8 - 90 + 8);
                }
                100..=107 => {
                    // Bright background colors
                    self.bg = Color::from(params[i] as u8 - 100 + 8);
                }
                _ => {}
            }
            i += 1;
        }
    }

    /// Put a character at cursor position and advance
    fn put_char(&mut self, ch: char) {
        if self.cursor_x >= self.width {
            // Wrap to next line
            self.cursor_x = 0;
            self.newline();
        }

        if self.cursor_y < self.height && self.cursor_x < self.width {
            self.screen[self.cursor_y][self.cursor_x] = Cell::full(
                ch,
                self.fg,
                self.bg,
                self.attrs,
            );
            self.cursor_x += 1;
        }
    }

    /// Move to next line, scrolling if needed
    fn newline(&mut self) {
        if self.cursor_y < self.height - 1 {
            self.cursor_y += 1;
        } else {
            self.scroll_up();
        }
    }

    /// Scroll screen up by one line
    fn scroll_up(&mut self) {
        if !self.screen.is_empty() {
            // Save top line to scrollback
            let top = self.screen.remove(0);
            self.scrollback.push_back(top);
            while self.scrollback.len() > self.max_scrollback {
                self.scrollback.pop_front();
            }
            // Add blank line at bottom
            let blank = vec![Cell::full(' ', self.fg, self.bg, Attrs::default()); self.width];
            self.screen.push(blank);
        }
    }

    /// Scroll screen down by one line
    fn scroll_down(&mut self) {
        if !self.screen.is_empty() {
            // Remove bottom line
            self.screen.pop();
            // Add blank line at top
            let blank = vec![Cell::full(' ', self.fg, self.bg, Attrs::default()); self.width];
            self.screen.insert(0, blank);
        }
    }

    /// Erase from cursor to end of screen
    fn erase_below(&mut self) {
        self.erase_line_right();
        for y in (self.cursor_y + 1)..self.height {
            for x in 0..self.width {
                self.screen[y][x] = Cell::full(' ', self.fg, self.bg, Attrs::default());
            }
        }
    }

    /// Erase from start of screen to cursor
    fn erase_above(&mut self) {
        for y in 0..self.cursor_y {
            for x in 0..self.width {
                self.screen[y][x] = Cell::full(' ', self.fg, self.bg, Attrs::default());
            }
        }
        self.erase_line_left();
    }

    /// Erase entire screen
    fn erase_all(&mut self) {
        for y in 0..self.height {
            for x in 0..self.width {
                self.screen[y][x] = Cell::full(' ', self.fg, self.bg, Attrs::default());
            }
        }
    }

    /// Erase from cursor to end of line
    fn erase_line_right(&mut self) {
        for x in self.cursor_x..self.width {
            self.screen[self.cursor_y][x] = Cell::full(' ', self.fg, self.bg, Attrs::default());
        }
    }

    /// Erase from start of line to cursor
    fn erase_line_left(&mut self) {
        for x in 0..=self.cursor_x.min(self.width - 1) {
            self.screen[self.cursor_y][x] = Cell::full(' ', self.fg, self.bg, Attrs::default());
        }
    }

    /// Erase entire line
    fn erase_line(&mut self) {
        for x in 0..self.width {
            self.screen[self.cursor_y][x] = Cell::full(' ', self.fg, self.bg, Attrs::default());
        }
    }

    /// Reset terminal to initial state
    fn reset(&mut self) {
        self.cursor_x = 0;
        self.cursor_y = 0;
        self.fg = Color::White;
        self.bg = Color::Black;
        self.attrs = Attrs::default();
        self.saved_cursor = None;
        self.erase_all();
    }

    /// Resize terminal
    pub fn resize(&mut self, new_width: usize, new_height: usize) {
        let default_cell = Cell::full(' ', Color::White, Color::Black, Attrs::default());

        // Create new screen buffer
        let mut new_screen = vec![vec![default_cell.clone(); new_width]; new_height];

        // Copy existing content
        for y in 0..new_height.min(self.height) {
            for x in 0..new_width.min(self.width) {
                new_screen[y][x] = self.screen[y][x].clone();
            }
        }

        self.screen = new_screen;
        self.width = new_width;
        self.height = new_height;
        self.cursor_x = self.cursor_x.min(new_width - 1);
        self.cursor_y = self.cursor_y.min(new_height - 1);
        self.dirty = true;
    }

    /// Get the screen buffer for rendering
    pub fn get_screen(&self) -> &Vec<Vec<Cell>> {
        &self.screen
    }
}

/// Active terminal connection
pub struct TerminalConnection {
    pub id: String,
    pub terminal: Terminal,
    pub tx: mpsc::Sender<Vec<u8>>,
}

impl TerminalConnection {
    /// Send data to the remote server
    pub async fn send(&self, data: &[u8]) -> Result<(), mpsc::error::SendError<Vec<u8>>> {
        self.tx.send(data.to_vec()).await
    }
}
