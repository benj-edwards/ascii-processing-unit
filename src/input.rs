//! APU Input Parser
//!
//! Parses raw terminal input into structured events.
//! Handles:
//! - Regular characters
//! - Arrow keys and other escape sequences
//! - Mouse events (X10, SGR extended)

use serde::{Deserialize, Serialize};

/// A parsed input event
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum InputEvent {
    /// A regular character
    Char { char: char },

    /// A key press
    Key { key: Key },

    /// Mouse event
    Mouse {
        x: u16,
        y: u16,
        button: MouseButton,
        event: MouseEvent,
        modifiers: Modifiers,
    },
}

/// Special keys
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Key {
    Up,
    Down,
    Left,
    Right,
    Home,
    End,
    PageUp,
    PageDown,
    Insert,
    Delete,
    Escape,
    Enter,
    Tab,
    Backspace,
    F1, F2, F3, F4, F5, F6, F7, F8, F9, F10, F11, F12,
}

/// Mouse buttons
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MouseButton {
    Left,
    Middle,
    Right,
    WheelUp,
    WheelDown,
    None,  // For motion events
}

/// Mouse event types
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MouseEvent {
    Press,
    Release,
    Drag,
    Move,
}

/// Modifier keys
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Modifiers {
    pub shift: bool,
    pub ctrl: bool,
    pub alt: bool,
}

/// Input parser state machine
pub struct InputParser {
    /// Buffer for incomplete escape sequences
    buffer: Vec<u8>,
    /// Maximum time to wait for escape sequence completion (not used yet)
    _escape_timeout_ms: u64,
}

impl InputParser {
    pub fn new() -> Self {
        Self {
            buffer: Vec::with_capacity(32),
            _escape_timeout_ms: 50,
        }
    }

    /// Parse input bytes into events
    /// Returns a vector of events and any remaining unparsed bytes
    pub fn parse(&mut self, data: &[u8]) -> Vec<InputEvent> {
        let mut events = Vec::new();
        self.buffer.extend_from_slice(data);

        while !self.buffer.is_empty() {
            match self.try_parse_one() {
                ParseResult::Event(event) => {
                    events.push(event);
                }
                ParseResult::Incomplete => {
                    // Need more data
                    break;
                }
                ParseResult::Invalid(skip) => {
                    // Skip invalid bytes
                    self.buffer.drain(0..skip);
                }
            }
        }

        events
    }

    /// Try to parse one event from the buffer
    fn try_parse_one(&mut self) -> ParseResult {
        if self.buffer.is_empty() {
            return ParseResult::Incomplete;
        }

        let first = self.buffer[0];

        // Escape sequence
        if first == 0x1b {
            return self.parse_escape();
        }

        // Control characters (< 32) and DEL (0x7f)
        if first < 32 || first == 0x7f {
            let event = match first {
                0x0d | 0x0a => Some(InputEvent::Key { key: Key::Enter }),
                0x09 => Some(InputEvent::Key { key: Key::Tab }),
                0x7f | 0x08 => Some(InputEvent::Key { key: Key::Backspace }),
                0x03 => Some(InputEvent::Char { char: '\x03' }), // Ctrl+C
                _ => Some(InputEvent::Char { char: first as char }),
            };
            self.buffer.remove(0);
            return event.map(ParseResult::Event).unwrap_or(ParseResult::Invalid(1));
        }

        // Regular character (handle UTF-8)
        if let Some((ch, len)) = self.decode_utf8() {
            self.buffer.drain(0..len);
            return ParseResult::Event(InputEvent::Char { char: ch });
        }

        // Invalid byte
        ParseResult::Invalid(1)
    }

    /// Parse an escape sequence
    fn parse_escape(&mut self) -> ParseResult {
        if self.buffer.len() < 2 {
            return ParseResult::Incomplete;
        }

        // Just ESC key (would need timeout in real impl)
        // For now, check if next char is not a sequence starter
        if self.buffer.len() == 1 {
            return ParseResult::Incomplete;
        }

        match self.buffer[1] {
            // CSI sequence: ESC [
            b'[' => self.parse_csi(),
            // SS3 sequence: ESC O (for F1-F4 on some terminals)
            b'O' => self.parse_ss3(),
            // Alt+key
            c if c >= 32 => {
                self.buffer.drain(0..2);
                ParseResult::Event(InputEvent::Char { char: c as char })
            }
            _ => ParseResult::Invalid(1),
        }
    }

    /// Parse CSI (Control Sequence Introducer) sequence: ESC [
    fn parse_csi(&mut self) -> ParseResult {
        if self.buffer.len() < 3 {
            return ParseResult::Incomplete;
        }

        // Check for mouse events
        if self.buffer[2] == b'<' {
            return self.parse_sgr_mouse();
        }
        if self.buffer[2] == b'M' {
            return self.parse_x10_mouse();
        }

        // Find the end of the sequence (a letter)
        let end = self.buffer[2..].iter().position(|&b| b.is_ascii_alphabetic() || b == b'~');

        match end {
            None => ParseResult::Incomplete,
            Some(pos) => {
                let end_idx = 2 + pos;
                let final_byte = self.buffer[end_idx];
                let params: Vec<u8> = self.buffer[2..end_idx].to_vec();

                let event = self.decode_csi(&params, final_byte);
                self.buffer.drain(0..=end_idx);

                event.map(ParseResult::Event).unwrap_or(ParseResult::Invalid(0))
            }
        }
    }

    /// Decode CSI parameters into an event
    fn decode_csi(&self, params: &[u8], final_byte: u8) -> Option<InputEvent> {
        match final_byte {
            b'A' => Some(InputEvent::Key { key: Key::Up }),
            b'B' => Some(InputEvent::Key { key: Key::Down }),
            b'C' => Some(InputEvent::Key { key: Key::Right }),
            b'D' => Some(InputEvent::Key { key: Key::Left }),
            b'H' => Some(InputEvent::Key { key: Key::Home }),
            b'F' => Some(InputEvent::Key { key: Key::End }),
            b'~' => {
                // Parse the number before ~
                let num: u8 = params.iter()
                    .take_while(|&&b| b.is_ascii_digit())
                    .fold(0, |acc, &b| acc * 10 + (b - b'0'));
                match num {
                    1 => Some(InputEvent::Key { key: Key::Home }),
                    2 => Some(InputEvent::Key { key: Key::Insert }),
                    3 => Some(InputEvent::Key { key: Key::Delete }),
                    4 => Some(InputEvent::Key { key: Key::End }),
                    5 => Some(InputEvent::Key { key: Key::PageUp }),
                    6 => Some(InputEvent::Key { key: Key::PageDown }),
                    15 => Some(InputEvent::Key { key: Key::F5 }),
                    17 => Some(InputEvent::Key { key: Key::F6 }),
                    18 => Some(InputEvent::Key { key: Key::F7 }),
                    19 => Some(InputEvent::Key { key: Key::F8 }),
                    20 => Some(InputEvent::Key { key: Key::F9 }),
                    21 => Some(InputEvent::Key { key: Key::F10 }),
                    23 => Some(InputEvent::Key { key: Key::F11 }),
                    24 => Some(InputEvent::Key { key: Key::F12 }),
                    _ => None,
                }
            }
            _ => None,
        }
    }

    /// Parse SS3 sequence: ESC O
    fn parse_ss3(&mut self) -> ParseResult {
        if self.buffer.len() < 3 {
            return ParseResult::Incomplete;
        }

        let event = match self.buffer[2] {
            b'P' => Some(InputEvent::Key { key: Key::F1 }),
            b'Q' => Some(InputEvent::Key { key: Key::F2 }),
            b'R' => Some(InputEvent::Key { key: Key::F3 }),
            b'S' => Some(InputEvent::Key { key: Key::F4 }),
            b'A' => Some(InputEvent::Key { key: Key::Up }),
            b'B' => Some(InputEvent::Key { key: Key::Down }),
            b'C' => Some(InputEvent::Key { key: Key::Right }),
            b'D' => Some(InputEvent::Key { key: Key::Left }),
            b'H' => Some(InputEvent::Key { key: Key::Home }),
            b'F' => Some(InputEvent::Key { key: Key::End }),
            _ => None,
        };

        self.buffer.drain(0..3);
        event.map(ParseResult::Event).unwrap_or(ParseResult::Invalid(0))
    }

    /// Parse X10 mouse: ESC [ M Cb Cx Cy
    fn parse_x10_mouse(&mut self) -> ParseResult {
        if self.buffer.len() < 6 {
            return ParseResult::Incomplete;
        }

        let cb = self.buffer[3];
        let cx = self.buffer[4];
        let cy = self.buffer[5];

        let x = cx.saturating_sub(32) as u16;
        let y = cy.saturating_sub(32) as u16;

        let (button, event) = decode_x10_button(cb);
        let modifiers = decode_x10_modifiers(cb);

        self.buffer.drain(0..6);

        ParseResult::Event(InputEvent::Mouse {
            x,
            y,
            button,
            event,
            modifiers,
        })
    }

    /// Parse SGR mouse: ESC [ < Pb ; Px ; Py M/m
    fn parse_sgr_mouse(&mut self) -> ParseResult {
        // Find the terminating M or m
        let end = self.buffer[3..].iter().position(|&b| b == b'M' || b == b'm');

        match end {
            None => ParseResult::Incomplete,
            Some(pos) => {
                let end_idx = 3 + pos;
                let is_release = self.buffer[end_idx] == b'm';
                let params_str = String::from_utf8_lossy(&self.buffer[3..end_idx]);

                let parts: Vec<&str> = params_str.split(';').collect();
                if parts.len() < 3 {
                    self.buffer.drain(0..=end_idx);
                    return ParseResult::Invalid(0);
                }

                let pb: u8 = parts[0].parse().unwrap_or(0);
                let x: u16 = parts[1].parse::<u16>().unwrap_or(1).saturating_sub(1);
                let y: u16 = parts[2].parse::<u16>().unwrap_or(1).saturating_sub(1);

                let (button, mut event) = decode_sgr_button(pb);
                // Only treat as release if a button was actually involved
                // Motion events after release (button=None) should stay as Move, not Release
                if is_release && button != MouseButton::None {
                    event = MouseEvent::Release;
                }
                let modifiers = decode_sgr_modifiers(pb);

                self.buffer.drain(0..=end_idx);

                ParseResult::Event(InputEvent::Mouse {
                    x,
                    y,
                    button,
                    event,
                    modifiers,
                })
            }
        }
    }

    /// Decode a UTF-8 character from the buffer
    fn decode_utf8(&self) -> Option<(char, usize)> {
        if self.buffer.is_empty() {
            return None;
        }

        let first = self.buffer[0];

        // ASCII
        if first < 128 {
            return Some((first as char, 1));
        }

        // Determine expected length
        let len = if first & 0xE0 == 0xC0 { 2 }
            else if first & 0xF0 == 0xE0 { 3 }
            else if first & 0xF8 == 0xF0 { 4 }
            else { return None };

        if self.buffer.len() < len {
            return None;
        }

        // Decode UTF-8
        let s = std::str::from_utf8(&self.buffer[0..len]).ok()?;
        s.chars().next().map(|c| (c, len))
    }
}

impl Default for InputParser {
    fn default() -> Self {
        Self::new()
    }
}

enum ParseResult {
    Event(InputEvent),
    Incomplete,
    Invalid(usize),
}

/// Decode X10 button byte
fn decode_x10_button(cb: u8) -> (MouseButton, MouseEvent) {
    let b = cb.saturating_sub(32);
    let button_bits = b & 0x03;
    let motion = (b & 0x20) != 0;

    let button = match button_bits {
        0 => MouseButton::Left,
        1 => MouseButton::Middle,
        2 => MouseButton::Right,
        3 => MouseButton::None,  // Release
        _ => MouseButton::None,
    };

    // Check for wheel
    let button = if (b & 0x40) != 0 {
        match button_bits {
            0 => MouseButton::WheelUp,
            1 => MouseButton::WheelDown,
            _ => button,
        }
    } else {
        button
    };

    let event = if button_bits == 3 {
        MouseEvent::Release
    } else if motion {
        MouseEvent::Drag
    } else {
        MouseEvent::Press
    };

    (button, event)
}

/// Decode X10 modifiers
fn decode_x10_modifiers(cb: u8) -> Modifiers {
    let b = cb.saturating_sub(32);
    Modifiers {
        shift: (b & 0x04) != 0,
        alt: (b & 0x08) != 0,
        ctrl: (b & 0x10) != 0,
    }
}

/// Decode SGR button byte
fn decode_sgr_button(pb: u8) -> (MouseButton, MouseEvent) {
    let button_bits = pb & 0x03;
    let motion = (pb & 0x20) != 0;

    let button = if (pb & 0x40) != 0 {
        // Wheel events
        match button_bits {
            0 => MouseButton::WheelUp,
            1 => MouseButton::WheelDown,
            _ => MouseButton::None,
        }
    } else {
        match button_bits {
            0 => MouseButton::Left,
            1 => MouseButton::Middle,
            2 => MouseButton::Right,
            3 => MouseButton::None,
            _ => MouseButton::None,
        }
    };

    let event = if motion && button != MouseButton::None {
        MouseEvent::Drag
    } else if motion {
        MouseEvent::Move
    } else {
        MouseEvent::Press
    };

    (button, event)
}

/// Decode SGR modifiers
fn decode_sgr_modifiers(pb: u8) -> Modifiers {
    Modifiers {
        shift: (pb & 0x04) != 0,
        alt: (pb & 0x08) != 0,
        ctrl: (pb & 0x10) != 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_char() {
        let mut parser = InputParser::new();
        let events = parser.parse(b"a");
        assert_eq!(events, vec![InputEvent::Char { char: 'a' }]);
    }

    #[test]
    fn test_parse_arrow_keys() {
        let mut parser = InputParser::new();

        let events = parser.parse(b"\x1b[A");
        assert_eq!(events, vec![InputEvent::Key { key: Key::Up }]);

        let events = parser.parse(b"\x1b[B");
        assert_eq!(events, vec![InputEvent::Key { key: Key::Down }]);
    }

    #[test]
    fn test_parse_sgr_mouse() {
        let mut parser = InputParser::new();

        // Left click at (10, 5)
        let events = parser.parse(b"\x1b[<0;10;5M");
        assert_eq!(events.len(), 1);
        if let InputEvent::Mouse { x, y, button, event, .. } = &events[0] {
            assert_eq!(*x, 9);  // 0-indexed
            assert_eq!(*y, 4);
            assert_eq!(*button, MouseButton::Left);
            assert_eq!(*event, MouseEvent::Press);
        } else {
            panic!("Expected mouse event");
        }
    }

    #[test]
    fn test_parse_multiple() {
        let mut parser = InputParser::new();
        let events = parser.parse(b"abc\x1b[A");
        assert_eq!(events.len(), 4);
        assert_eq!(events[0], InputEvent::Char { char: 'a' });
        assert_eq!(events[1], InputEvent::Char { char: 'b' });
        assert_eq!(events[2], InputEvent::Char { char: 'c' });
        assert_eq!(events[3], InputEvent::Key { key: Key::Up });
    }
}
