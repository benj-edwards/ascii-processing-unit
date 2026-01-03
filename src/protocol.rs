//! APU Protocol
//!
//! JSON-based protocol for communication between games and APU.
//! Games send commands, APU sends rendered output.
//!
//! ## Session Targeting
//!
//! Commands can target specific sessions using the `session` field:
//! - Omitted or "*": Broadcast to all sessions (default, backward compatible)
//! - "session_id": Send only to that specific session
//!
//! Example:
//! ```json
//! {"cmd": "print", "session": "session_123", "window": "main", "x": 0, "y": 0, "text": "Hello"}
//! ```

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Commands from game to APU
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "cmd", rename_all = "snake_case")]
pub enum Command {
    /// Initialize display
    Init {
        cols: Option<usize>,
        rows: Option<usize>,
    },

    /// Shutdown display
    Shutdown,

    /// Clear background layer only (preserves windows)
    /// For non-windowed apps (IRC, MUSH, Zork), this clears the visible screen.
    /// For windowed apps, use `reset` to also destroy all windows.
    Clear,

    /// Clear everything: destroy all windows AND clear background
    /// Use this for a complete slate reset (e.g., switching game modes)
    Reset,

    /// Explicit alias for Clear - clears background layer only
    /// Provided for clarity in windowed apps
    ClearBackground,

    /// Create a window
    CreateWindow {
        id: String,
        x: usize,
        y: usize,
        width: usize,
        height: usize,
        #[serde(default)]
        border: BorderStyle,
        #[serde(default)]
        title: Option<String>,
        /// Show close button in title bar (default: true)
        #[serde(default = "default_true")]
        closable: bool,
        /// Allow resizing via bottom-right handle (default: true)
        #[serde(default = "default_true")]
        resizable: bool,
        /// Allow dragging via title bar (default: true)
        #[serde(default = "default_true")]
        draggable: bool,
        /// Minimum width when resizing
        #[serde(default = "default_min_width")]
        min_width: usize,
        /// Minimum height when resizing
        #[serde(default = "default_min_height")]
        min_height: usize,
        /// Invert colors of whatever is underneath (default: false)
        #[serde(default)]
        invert: bool,
    },

    /// Remove a window
    RemoveWindow {
        id: String,
    },

    /// Update window properties
    UpdateWindow {
        id: String,
        #[serde(default)]
        x: Option<usize>,
        #[serde(default)]
        y: Option<usize>,
        #[serde(default)]
        width: Option<usize>,
        #[serde(default)]
        height: Option<usize>,
        #[serde(default)]
        visible: Option<bool>,
        #[serde(default)]
        title: Option<String>,
        #[serde(default)]
        z_index: Option<i32>,
    },

    /// Set a cell in a window
    SetCell {
        window: String,
        x: usize,
        y: usize,
        char: char,
        #[serde(default = "default_fg")]
        fg: u8,
        #[serde(default)]
        bg: u8,
    },

    /// Write text to a window
    Print {
        window: String,
        x: usize,
        y: usize,
        text: String,
        #[serde(default = "default_fg")]
        fg: u8,
        #[serde(default)]
        bg: u8,
    },

    /// Clear a window
    ClearWindow {
        id: String,
    },

    /// Fill a rectangle in a window
    Fill {
        window: String,
        x: usize,
        y: usize,
        width: usize,
        height: usize,
        char: char,
        #[serde(default = "default_fg")]
        fg: u8,
        #[serde(default)]
        bg: u8,
    },

    /// Set a cell directly on display (no window)
    SetDirect {
        x: usize,
        y: usize,
        char: char,
        #[serde(default = "default_fg")]
        fg: u8,
        #[serde(default)]
        bg: u8,
    },

    /// Write text directly to display
    PrintDirect {
        x: usize,
        y: usize,
        text: String,
        #[serde(default = "default_fg")]
        fg: u8,
        #[serde(default)]
        bg: u8,
    },

    /// Batch update - multiple cells at once
    Batch {
        cells: Vec<BatchCell>,
    },

    /// Request flush/render
    Flush {
        #[serde(default)]
        force_full: bool,
    },

    /// Bring window to front
    BringToFront {
        id: String,
    },

    /// Send window to back
    SendToBack {
        id: String,
    },

    /// Enable mouse tracking
    EnableMouse {
        /// Mode: "normal" (press/release), "button" (+ drag), "any" (all motion), "sgr" (extended)
        #[serde(default = "default_mouse_mode")]
        mode: String,
    },

    /// Disable mouse tracking
    DisableMouse,

    /// List all connected sessions
    ListSessions,

    /// Share one session's display with another (target sees source's screen)
    ShareDisplay {
        /// Source session to share from
        source: String,
        /// Target session that will see the shared display
        target: String,
    },

    /// Stop sharing display
    UnshareDisplay {
        /// Source session
        source: String,
        /// Target session to stop sharing with
        target: String,
    },

    /// Share a specific window from one session to another
    ShareWindow {
        /// Window ID to share
        window_id: String,
        /// Source session that owns the window
        source: String,
        /// Target session that will see the window
        target: String,
    },

    /// Stop sharing a window
    UnshareWindow {
        /// Window ID
        window_id: String,
        /// Source session
        source: String,
        /// Target session
        target: String,
    },

    // ============== Terminal Emulator Commands ==============

    /// Create a terminal window connected to a remote server
    /// The terminal will parse ANSI sequences and render them
    CreateTerminal {
        /// Window ID for the terminal
        id: String,
        /// Remote host to connect to
        host: String,
        /// Remote port
        port: u16,
        /// Window position
        x: usize,
        y: usize,
        /// Window size
        width: usize,
        height: usize,
        /// Terminal type for ANSI parsing (default: "ansi")
        /// Options: "ansi", "vt100", "xterm", "raw"
        #[serde(default = "default_terminal_type")]
        terminal_type: String,
        /// Border style (default: "single")
        /// Options: "none", "single", "double"
        #[serde(default = "default_border")]
        border: String,
        /// Window title (default: "Terminal")
        #[serde(default)]
        title: Option<String>,
        /// Show close button (default: true)
        #[serde(default = "default_true")]
        closable: bool,
        /// Allow resizing (default: true)
        #[serde(default = "default_true")]
        resizable: bool,
    },

    /// Close a terminal connection and remove the window
    CloseTerminal {
        id: String,
    },

    /// Send input to a terminal (when not using automatic input routing)
    TerminalInput {
        id: String,
        data: String,
    },

    /// Configure terminal emulation settings
    TerminalConfig {
        id: String,
        /// Enable local echo (characters are echoed locally as typed)
        #[serde(default)]
        local_echo: Option<bool>,
        /// Line ending to send on Enter: "cr" or "crlf"
        #[serde(default)]
        line_ending: Option<String>,
    },

    /// Resize a terminal window (updates window size and sends NAWS to remote)
    ResizeTerminal {
        id: String,
        /// New window X position
        x: usize,
        /// New window Y position
        y: usize,
        /// New window width
        width: usize,
        /// New window height
        height: usize,
        /// Border style: "none", "single", "double"
        #[serde(default = "default_border")]
        border: String,
        /// Window title (optional)
        #[serde(default)]
        title: Option<String>,
        /// Show close button
        #[serde(default = "default_true")]
        closable: bool,
        /// Allow resizing
        #[serde(default = "default_true")]
        resizable: bool,
        /// Allow dragging
        #[serde(default = "default_true")]
        draggable: bool,
    },
}

/// A single cell in a batch update
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BatchCell {
    pub x: usize,
    pub y: usize,
    pub char: char,
    #[serde(default = "default_fg")]
    pub fg: u8,
    #[serde(default)]
    pub bg: u8,
    #[serde(default)]
    pub window: Option<String>,
}

/// Border style (for JSON)
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BorderStyle {
    None,
    #[default]
    Single,
    Double,
    Rounded,
    Heavy,
    Ascii,
}

impl From<BorderStyle> for crate::core::window::BorderStyle {
    fn from(bs: BorderStyle) -> Self {
        match bs {
            BorderStyle::None => crate::core::window::BorderStyle::None,
            BorderStyle::Single => crate::core::window::BorderStyle::Single,
            BorderStyle::Double => crate::core::window::BorderStyle::Double,
            BorderStyle::Rounded => crate::core::window::BorderStyle::Rounded,
            BorderStyle::Heavy => crate::core::window::BorderStyle::Heavy,
            BorderStyle::Ascii => crate::core::window::BorderStyle::Ascii,
        }
    }
}

/// Response from APU to game
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Response {
    /// Rendered output to send to terminal
    Output {
        data: String,
    },

    /// Error message
    Error {
        message: String,
    },

    /// Acknowledgment
    Ok,

    /// Display info
    Info {
        cols: usize,
        rows: usize,
        renderer: String,
    },

    /// Input event from client
    Input {
        session: String,
        event: crate::input::InputEvent,
    },

    /// Client connected
    ClientConnect {
        session: String,
    },

    /// Client disconnected
    ClientDisconnect {
        session: String,
    },

    /// Window was moved (by dragging title bar)
    WindowMoved {
        id: String,
        x: usize,
        y: usize,
    },

    /// Window was resized (by dragging resize handle)
    WindowResized {
        id: String,
        width: usize,
        height: usize,
    },

    /// Close button was clicked
    WindowCloseRequested {
        id: String,
    },

    /// Title bar was double-clicked (maximize/restore)
    WindowMaximizeRequested {
        id: String,
    },

    /// Window was focused (clicked on)
    WindowFocused {
        id: String,
    },

    /// List of connected sessions
    Sessions {
        sessions: Vec<SessionInfo>,
    },

    /// Request game to refresh/redraw everything for this session
    /// Sent when APU console executes "reset" command
    RefreshRequested {
        session: String,
    },

    // ============== Terminal Events ==============

    /// Terminal connected successfully to remote host
    TerminalConnected {
        id: String,
        host: String,
        port: u16,
    },

    /// Terminal disconnected (connection closed or lost)
    TerminalDisconnected {
        id: String,
        reason: String,
    },

    /// Terminal connection failed
    TerminalError {
        id: String,
        error: String,
    },
}

/// Information about a connected session
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionInfo {
    /// Session ID
    pub id: String,
    /// Remote address
    pub address: String,
    /// Connection time (Unix timestamp)
    pub connected_at: u64,
}

/// A command with optional session targeting
#[derive(Debug, Clone)]
pub struct TargetedCommand {
    /// Target session(s): None = broadcast, Some("*") = broadcast, Some(id) = specific session
    pub session: Option<String>,
    /// The actual command
    pub command: Command,
}

fn default_fg() -> u8 {
    7 // White
}

fn default_mouse_mode() -> String {
    "sgr".to_string()
}

fn default_true() -> bool {
    true
}

fn default_min_width() -> usize {
    10
}

fn default_min_height() -> usize {
    5
}

fn default_terminal_type() -> String {
    "ansi".to_string()
}

fn default_border() -> String {
    "single".to_string()
}

/// Parse a command from JSON (legacy, without session targeting)
pub fn parse_command(json: &str) -> Result<Command, serde_json::Error> {
    serde_json::from_str(json)
}

/// Parse a command with optional session targeting
/// Extracts the "session" field before parsing the command
pub fn parse_targeted_command(json: &str) -> Result<TargetedCommand, serde_json::Error> {
    // First parse as generic JSON to extract session field
    let mut value: Value = serde_json::from_str(json)?;

    // Extract and remove the session field if present
    let session = if let Some(obj) = value.as_object_mut() {
        obj.remove("session").and_then(|v| v.as_str().map(String::from))
    } else {
        None
    };

    // Parse the remaining JSON as a Command
    let command: Command = serde_json::from_value(value)?;

    Ok(TargetedCommand { session, command })
}

/// Serialize a response to JSON
pub fn serialize_response(response: &Response) -> String {
    serde_json::to_string(response).unwrap_or_else(|_| r#"{"type":"error","message":"Serialization failed"}"#.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_init() {
        let json = r#"{"cmd":"init","cols":80,"rows":24}"#;
        let cmd = parse_command(json).unwrap();
        match cmd {
            Command::Init { cols, rows } => {
                assert_eq!(cols, Some(80));
                assert_eq!(rows, Some(24));
            }
            _ => panic!("Wrong command type"),
        }
    }

    #[test]
    fn test_parse_print() {
        let json = r#"{"cmd":"print","window":"main","x":5,"y":3,"text":"Hello","fg":10}"#;
        let cmd = parse_command(json).unwrap();
        match cmd {
            Command::Print { window, x, y, text, fg, .. } => {
                assert_eq!(window, "main");
                assert_eq!(x, 5);
                assert_eq!(y, 3);
                assert_eq!(text, "Hello");
                assert_eq!(fg, 10);
            }
            _ => panic!("Wrong command type"),
        }
    }
}
