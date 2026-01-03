//! APU TCP Server
//!
//! Listens for game connections and client connections.
//! Games send commands via JSON, clients receive ANSI output.
//! Client input is parsed and forwarded to games.

use std::collections::HashMap;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{broadcast, mpsc, oneshot, RwLock};
use log::{info, error, debug};

use crate::core::{Attrs, Color, WindowManager, InteractionState, DragState, ResizeState, TitleBarClick};
use crate::input::{InputParser, InputEvent, MouseButton, MouseEvent as MouseEventType};
use crate::protocol::{Command, Response, parse_targeted_command, serialize_response, SessionInfo};
use crate::renderer::{AnsiIbmRenderer, MouseMode, Renderer};
use crate::terminal::{Terminal, TerminalType};

// Telnet protocol constants
const IAC: u8 = 255;   // Interpret As Command
const WILL: u8 = 251;
const WONT: u8 = 252;
const DO: u8 = 253;
const DONT: u8 = 254;
const SB: u8 = 250;    // Subnegotiation Begin
const SE: u8 = 240;    // Subnegotiation End

// Telnet options
const ECHO: u8 = 1;
const SUPPRESS_GO_AHEAD: u8 = 3;
const LINEMODE: u8 = 34;

/// Telnet negotiation to enable raw mode (character-at-a-time, no local echo)
fn telnet_raw_mode() -> Vec<u8> {
    vec![
        IAC, WILL, ECHO,              // Server will echo (client should not)
        IAC, WILL, SUPPRESS_GO_AHEAD, // No line buffering
        IAC, DO, SUPPRESS_GO_AHEAD,   // Client should not buffer
        IAC, DONT, LINEMODE,          // Disable line mode
    ]
}

/// Filter telnet IAC sequences from input data
fn filter_telnet_commands(data: &[u8]) -> Vec<u8> {
    let mut filtered = Vec::new();
    let mut i = 0;
    while i < data.len() {
        if data[i] == IAC {
            // Skip IAC sequences
            if i + 1 < data.len() {
                match data[i + 1] {
                    WILL | WONT | DO | DONT => {
                        // 3-byte sequence: IAC + command + option
                        i += 3;
                        continue;
                    }
                    SB => {
                        // Subnegotiation - skip until IAC SE
                        i += 2;
                        while i < data.len() {
                            if data[i] == IAC && i + 1 < data.len() && data[i + 1] == SE {
                                i += 2;
                                break;
                            }
                            i += 1;
                        }
                        continue;
                    }
                    IAC => {
                        // Escaped IAC (255 255) = literal 255
                        filtered.push(255);
                        i += 2;
                        continue;
                    }
                    _ => {
                        // Other 2-byte command
                        i += 2;
                        continue;
                    }
                }
            }
        }
        filtered.push(data[i]);
        i += 1;
    }
    filtered
}

/// Telnet protocol state machine for parsing incoming data
#[derive(Clone, Copy, PartialEq)]
enum TelnetState {
    Normal,
    Iac,
    Option,
    Subneg,
    SubnegIac,
}

/// Handle to an active terminal connection
pub struct TerminalHandle {
    /// Terminal emulator state (shared with connection task)
    pub terminal: Arc<RwLock<Terminal>>,
    /// Channel to send data to the remote server
    pub input_tx: mpsc::Sender<Vec<u8>>,
    /// Handle to abort the connection task
    pub abort_handle: tokio::task::AbortHandle,
    /// Remote host
    pub host: String,
    /// Remote port
    pub port: u16,
    /// Local echo enabled (characters echoed as typed)
    pub local_echo: bool,
    /// Line ending mode: "cr" (default) or "crlf"
    pub line_ending: String,
}

/// A client session (player connection)
pub struct ClientSession {
    /// Session ID
    pub id: String,
    /// Remote address
    pub address: String,
    /// Connection timestamp (Unix epoch)
    pub connected_at: u64,
    /// Output sender
    output_tx: mpsc::Sender<String>,
    /// Window manager for this session
    pub windows: WindowManager,
    /// Renderer
    renderer: AnsiIbmRenderer,
    /// Interaction state for window chrome handling
    pub interaction: InteractionState,
    /// Sessions that are sharing their display with this session
    /// (we see their screen)
    pub display_shares_from: Vec<String>,
    /// Sessions we are sharing our display to
    /// (they see our screen)
    pub display_shares_to: Vec<String>,
    /// Debug console state
    pub console_open: bool,
    /// Debug console input buffer
    pub console_input: String,
    /// Active terminal connections (window_id -> terminal handle)
    pub terminals: HashMap<String, TerminalHandle>,
    /// Currently focused window (for terminal input routing)
    pub focused_window: Option<String>,
}

impl ClientSession {
    pub fn new(id: String, address: String, output_tx: mpsc::Sender<String>, cols: usize, rows: usize) -> Self {
        use std::time::{SystemTime, UNIX_EPOCH};
        let connected_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);

        Self {
            id,
            address,
            connected_at,
            output_tx,
            windows: WindowManager::new(cols, rows),
            renderer: AnsiIbmRenderer::new(cols, rows),
            interaction: InteractionState::default(),
            display_shares_from: Vec::new(),
            display_shares_to: Vec::new(),
            console_open: false,
            console_input: String::new(),
            terminals: HashMap::new(),
            focused_window: None,
        }
    }

    /// Get session info for protocol responses
    pub fn info(&self) -> SessionInfo {
        SessionInfo {
            id: self.id.clone(),
            address: self.address.clone(),
            connected_at: self.connected_at,
        }
    }

    /// Initialize display
    pub async fn init(&mut self) -> Result<(), mpsc::error::SendError<String>> {
        let output = self.renderer.init();
        self.output_tx.send(output).await
    }

    /// Shutdown display
    pub async fn shutdown(&self) -> Result<(), mpsc::error::SendError<String>> {
        let output = self.renderer.shutdown();
        self.output_tx.send(output).await
    }

    /// Enable mouse tracking
    pub async fn enable_mouse(&self, mode: MouseMode) -> Result<(), mpsc::error::SendError<String>> {
        info!("Enabling mouse mode {:?} for session {}", mode, self.id);
        let output = self.renderer.enable_mouse(mode);
        self.output_tx.send(output).await
    }

    /// Disable mouse tracking
    pub async fn disable_mouse(&self) -> Result<(), mpsc::error::SendError<String>> {
        info!("Disabling mouse mode for session {}", self.id);
        let output = self.renderer.disable_mouse();
        self.output_tx.send(output).await
    }

    /// Handle a mouse event and return any window events that should be emitted
    /// Returns (events_to_emit, should_forward_to_game)
    pub fn handle_mouse_event(&mut self, x: usize, y: usize, button: MouseButton, event_type: MouseEventType) -> (Vec<Response>, bool) {
        let mut events = Vec::new();
        let mut forward_to_game = true;

        match event_type {
            MouseEventType::Press => {
                if button == MouseButton::Left {
                    debug!("Left click at ({}, {})", x, y);

                    // IMPORTANT: First find the topmost window at this position
                    // Only check chrome (close, resize, title bar) for THAT window
                    // This prevents clicks on a front window from triggering
                    // drag/resize on windows behind it
                    if let Some(top_id) = self.windows.window_at(x, y).map(String::from) {
                        if let Some(win) = self.windows.get(&top_id) {
                            // Debug: log window info for chrome hit tests
                            let resize_x = win.x + win.width - 1;
                            let resize_y = win.y + win.height - 1;
                            debug!("Click at ({},{}) - topmost window '{}' at ({},{}) size {}x{}, resize handle at ({},{})",
                                x, y, top_id, win.x, win.y, win.width, win.height, resize_x, resize_y);

                            // Check close button on topmost window only
                            if win.hit_close_button(x, y) {
                                debug!("Close button hit for window: {}", top_id);
                                events.push(Response::WindowCloseRequested { id: top_id });
                                forward_to_game = false;
                                return (events, forward_to_game);
                            }

                            // Check resize handle on topmost window only
                            if win.hit_resize_handle(x, y) {
                                self.interaction.resizing = Some(ResizeState {
                                    window_id: top_id.clone(),
                                    original_width: win.width,
                                    original_height: win.height,
                                    start_x: x,
                                    start_y: y,
                                });
                                self.windows.bring_to_front(&top_id);
                                forward_to_game = false;
                                return (events, forward_to_game);
                            }

                            // Check title bar on topmost window only (dragging or double-click)
                            if win.hit_title_bar(x, y) {
                                // Check for double-click (within 500ms on same window)
                                let now_ms = std::time::SystemTime::now()
                                    .duration_since(std::time::UNIX_EPOCH)
                                    .map(|d| d.as_millis() as u64)
                                    .unwrap_or(0);

                                let is_double_click = if let Some(ref last) = self.interaction.last_title_bar_click {
                                    last.window_id == top_id && (now_ms - last.time_ms) < 500
                                } else {
                                    false
                                };

                                if is_double_click {
                                    // Double-click on title bar - maximize/restore
                                    events.push(Response::WindowMaximizeRequested { id: top_id.clone() });
                                    self.interaction.last_title_bar_click = None;
                                    self.windows.bring_to_front(&top_id);
                                    forward_to_game = false;
                                    return (events, forward_to_game);
                                }

                                // Record this click for double-click detection
                                self.interaction.last_title_bar_click = Some(TitleBarClick {
                                    window_id: top_id.clone(),
                                    time_ms: now_ms,
                                });

                                // Start dragging
                                self.interaction.dragging = Some(DragState {
                                    window_id: top_id.clone(),
                                    offset_x: x as isize - win.x as isize,
                                    offset_y: y as isize - win.y as isize,
                                });
                                self.windows.bring_to_front(&top_id);
                                forward_to_game = false;
                                return (events, forward_to_game);
                            }

                            // Debug: log if click is near bottom-right corner but didn't hit resize
                            let resize_x = win.x + win.width - 1;
                            let resize_y = win.y + win.height - 1;
                            if x >= resize_x.saturating_sub(2) && y >= resize_y.saturating_sub(2) {
                                debug!("Click near resize area but no hit: click ({},{}) vs resize ({},{}), resizable={}, visible={}, has_border={}",
                                    x, y, resize_x, resize_y, win.resizable, win.visible, win.border.has_border());
                            }
                        }

                        // Click on window content - bring to front and forward to game
                        self.windows.bring_to_front(&top_id);
                        self.focused_window = Some(top_id.clone());
                        events.push(Response::WindowFocused { id: top_id });
                    }
                }
            }

            MouseEventType::Release => {
                // End dragging
                if let Some(drag) = self.interaction.dragging.take() {
                    if let Some(win) = self.windows.get(&drag.window_id) {
                        events.push(Response::WindowMoved {
                            id: drag.window_id.clone(),
                            x: win.x,
                            y: win.y,
                        });
                    }
                    forward_to_game = false;
                }

                // End resizing
                if let Some(resize) = self.interaction.resizing.take() {
                    if let Some(win) = self.windows.get(&resize.window_id) {
                        events.push(Response::WindowResized {
                            id: resize.window_id.clone(),
                            width: win.width,
                            height: win.height,
                        });
                    }
                    forward_to_game = false;
                }
            }

            MouseEventType::Drag => {
                // Capture display dimensions before borrowing windows
                let cols = self.windows.cols;
                let rows = self.windows.rows;

                // Handle dragging
                if let Some(ref drag) = self.interaction.dragging {
                    let new_x = (x as isize - drag.offset_x).max(0) as usize;
                    // Y minimum is 1 to protect the menu bar at row 0
                    let new_y = (y as isize - drag.offset_y).max(1) as usize;

                    if let Some(win) = self.windows.get_mut(&drag.window_id) {
                        // Clamp to display bounds
                        let max_x = cols.saturating_sub(win.width);
                        let max_y = rows.saturating_sub(win.height);
                        win.x = new_x.min(max_x);
                        win.y = new_y.min(max_y);
                        win.dirty = true;
                    }
                    forward_to_game = false;
                }

                // Handle resizing
                if let Some(ref resize) = self.interaction.resizing {
                    let dx = x as isize - resize.start_x as isize;
                    let dy = y as isize - resize.start_y as isize;

                    if let Some(win) = self.windows.get_mut(&resize.window_id) {
                        let new_width = (resize.original_width as isize + dx).max(win.min_width as isize) as usize;
                        let new_height = (resize.original_height as isize + dy).max(win.min_height as isize) as usize;

                        // Clamp to display bounds
                        let max_width = cols.saturating_sub(win.x);
                        let max_height = rows.saturating_sub(win.y);
                        let new_width = new_width.min(max_width);
                        let new_height = new_height.min(max_height);

                        if new_width != win.width || new_height != win.height {
                            win.resize(new_width, new_height);
                        }
                    }
                    forward_to_game = false;
                }
            }

            MouseEventType::Move => {
                // Capture display dimensions before borrowing windows
                let cols = self.windows.cols;
                let rows = self.windows.rows;

                // Handle dragging during Move events too (some terminals send Move instead of Drag)
                if let Some(ref drag) = self.interaction.dragging {
                    let new_x = (x as isize - drag.offset_x).max(0) as usize;
                    // Y minimum is 1 to protect the menu bar at row 0
                    let new_y = (y as isize - drag.offset_y).max(1) as usize;

                    if let Some(win) = self.windows.get_mut(&drag.window_id) {
                        let max_x = cols.saturating_sub(win.width);
                        let max_y = rows.saturating_sub(win.height);
                        win.x = new_x.min(max_x);
                        win.y = new_y.min(max_y);
                        win.dirty = true;
                    }
                    forward_to_game = false;
                }

                // Handle resizing during Move events too
                if let Some(ref resize) = self.interaction.resizing {
                    let dx = x as isize - resize.start_x as isize;
                    let dy = y as isize - resize.start_y as isize;

                    if let Some(win) = self.windows.get_mut(&resize.window_id) {
                        let new_width = (resize.original_width as isize + dx).max(win.min_width as isize) as usize;
                        let new_height = (resize.original_height as isize + dy).max(win.min_height as isize) as usize;

                        let max_width = cols.saturating_sub(win.x);
                        let max_height = rows.saturating_sub(win.y);
                        let new_width = new_width.min(max_width);
                        let new_height = new_height.min(max_height);

                        if new_width != win.width || new_height != win.height {
                            win.resize(new_width, new_height);
                        }
                    }
                    forward_to_game = false;
                }
            }
        }

        (events, forward_to_game)
    }

    /// Auto-flush display if windows are dirty (for live drag/resize feedback)
    pub async fn auto_flush(&mut self) {
        if self.windows.is_dirty() {
            self.windows.composite();
            let output = self.renderer.render(&self.windows.display, false);
            self.windows.display.mark_all_clean();
            self.windows.mark_all_clean();
            let _ = self.output_tx.send(output).await;
        }
    }

    /// Toggle debug console
    pub fn toggle_console(&mut self) {
        self.console_open = !self.console_open;
        self.console_input.clear();
    }

    /// Check if a character is the console toggle
    /// Ctrl+\ sends 0x1C (File Separator) - available on Apple II!
    /// Note: Ctrl+[ is ESC which conflicts with escape sequences
    pub fn is_console_toggle_char(ch: char) -> bool {
        ch == '\x1C'  // Ctrl+\
    }

    /// Draw the debug console overlay
    pub async fn draw_console(&self) {
        if !self.console_open {
            return;
        }

        // Draw console box at top of screen (60 chars wide, 3 rows tall)
        let width = 60;
        let x = (self.windows.cols.saturating_sub(width)) / 2;

        // Use ANSI escape codes to draw directly
        let mut output = String::new();

        // Position cursor and draw box
        output.push_str(&format!("\x1b[1;{}H", x + 1)); // Row 1
        output.push_str("\x1b[0;30;47m"); // Black on white
        output.push_str("╔");
        output.push_str(&"═".repeat(width - 2));
        output.push_str("╗");

        output.push_str(&format!("\x1b[2;{}H", x + 1)); // Row 2
        output.push_str("║ APU Console (Ctrl+\\ close) > ");
        let input_display = if self.console_input.len() > 25 {
            &self.console_input[self.console_input.len() - 25..]
        } else {
            &self.console_input
        };
        output.push_str(input_display);
        output.push_str("█"); // Cursor
        let padding = width - 33 - input_display.len().min(25);
        output.push_str(&" ".repeat(padding));
        output.push_str("║");

        output.push_str(&format!("\x1b[3;{}H", x + 1)); // Row 3
        output.push_str("╚");
        output.push_str(&"═".repeat(width - 2));
        output.push_str("╝");

        output.push_str("\x1b[0m"); // Reset colors

        let _ = self.output_tx.send(output).await;
    }

    /// Process a console command, returns (should_reset, should_close)
    pub fn process_console_command(&mut self) -> (bool, bool) {
        let cmd = self.console_input.trim().to_lowercase();
        self.console_input.clear();

        match cmd.as_str() {
            "reset" => (true, false),
            "close" => (false, true),
            "help" => {
                // Just clear for now, could show help
                (false, false)
            }
            _ => (false, false)
        }
    }

    /// Process a command and return response
    pub async fn process_command(&mut self, cmd: Command) -> Response {
        match cmd {
            Command::Init { cols, rows } => {
                let cols = cols.unwrap_or(80);
                let rows = rows.unwrap_or(24);
                self.windows.resize(cols, rows);
                self.renderer = AnsiIbmRenderer::new(cols, rows);
                let output = self.renderer.init();
                let _ = self.output_tx.send(output).await;
                Response::Info {
                    cols,
                    rows,
                    renderer: self.renderer.name().to_string(),
                }
            }

            Command::Shutdown => {
                let output = self.renderer.shutdown();
                let _ = self.output_tx.send(output).await;
                Response::Ok
            }

            Command::Clear => {
                // Only clear background, preserve window contents
                // Use ClearWindow to clear specific windows if needed
                self.windows.background.clear();
                Response::Ok
            }

            Command::ClearBackground => {
                // Explicit alias for Clear - just clears background layer
                self.windows.background.clear();
                Response::Ok
            }

            Command::Reset => {
                // Nuclear option: destroy all windows AND clear background
                // Use when switching game modes or need a complete slate
                self.windows.clear_all_windows();
                self.windows.background.clear();
                Response::Ok
            }

            Command::CreateWindow { id, x, y, width, height, border, title, closable, resizable, draggable, min_width, min_height, invert } => {
                // Constrain y to be at least 1 to protect the menu bar, UNLESS it's an invert window (cursor)
                let actual_y = if invert { y } else { y.max(1) };
                let win = self.windows.create_window(&id, x, actual_y, width, height);
                win.set_border(border.into());
                if let Some(t) = title {
                    win.set_title(t);
                }
                // Apply chrome configuration
                win.closable = closable;
                win.resizable = resizable;
                win.draggable = draggable;
                win.min_width = min_width;
                win.min_height = min_height;
                // Apply blend mode
                win.invert = invert;
                Response::Ok
            }

            Command::RemoveWindow { id } => {
                self.windows.remove(&id);
                Response::Ok
            }

            Command::UpdateWindow { id, x, y, width, height, visible, title, z_index } => {
                if let Some(win) = self.windows.get_mut(&id) {
                    if let Some(x) = x { win.x = x; win.dirty = true; }
                    // Constrain y to be at least 1 to protect the menu bar, UNLESS it's an invert window (cursor)
                    if let Some(y) = y { win.y = if win.invert { y } else { y.max(1) }; win.dirty = true; }
                    if let (Some(w), Some(h)) = (width, height) {
                        win.resize(w, h);
                    }
                    if let Some(v) = visible {
                        if v { win.show(); } else { win.hide(); }
                    }
                    if let Some(t) = title {
                        win.set_title(t);
                    }
                    if let Some(z) = z_index {
                        win.z_index = z;
                    }
                    Response::Ok
                } else {
                    Response::Error { message: format!("Window not found: {}", id) }
                }
            }

            Command::SetCell { window, x, y, char, fg, bg } => {
                if let Some(win) = self.windows.get_mut(&window) {
                    win.set(x, y, char, Color::from(fg), Some(Color::from(bg)));
                    Response::Ok
                } else {
                    Response::Error { message: format!("Window not found: {}", window) }
                }
            }

            Command::Print { window, x, y, text, fg, bg } => {
                if let Some(win) = self.windows.get_mut(&window) {
                    win.print(x, y, &text, Color::from(fg), Some(Color::from(bg)));
                    Response::Ok
                } else {
                    Response::Error { message: format!("Window not found: {}", window) }
                }
            }

            Command::ClearWindow { id } => {
                if let Some(win) = self.windows.get_mut(&id) {
                    win.clear();
                    Response::Ok
                } else {
                    Response::Error { message: format!("Window not found: {}", id) }
                }
            }

            Command::Fill { window, x, y, width, height, char, fg, bg } => {
                if let Some(win) = self.windows.get_mut(&window) {
                    win.fill(x, y, width, height, char, Color::from(fg), Some(Color::from(bg)));
                    Response::Ok
                } else {
                    Response::Error { message: format!("Window not found: {}", window) }
                }
            }

            Command::SetDirect { x, y, char, fg, bg } => {
                self.windows.background.set(x, y, char, Color::from(fg), Color::from(bg), Attrs::default());
                Response::Ok
            }

            Command::PrintDirect { x, y, text, fg, bg } => {
                self.windows.background.write_str(x, y, &text, Color::from(fg), Color::from(bg), Attrs::default());
                Response::Ok
            }

            Command::Batch { cells } => {
                for cell in cells {
                    if let Some(ref window_id) = cell.window {
                        if let Some(win) = self.windows.get_mut(window_id) {
                            win.set(cell.x, cell.y, cell.char, Color::from(cell.fg), Some(Color::from(cell.bg)));
                        }
                    } else {
                        self.windows.background.set(cell.x, cell.y, cell.char, Color::from(cell.fg), Color::from(cell.bg), Attrs::default());
                    }
                }
                Response::Ok
            }

            Command::Flush { force_full } => {
                // Sync any terminal content to their windows
                self.sync_terminals_to_windows().await;
                // Composite windows
                self.windows.composite();
                // Render
                let output = self.renderer.render(&self.windows.display, force_full);
                // Mark clean
                self.windows.display.mark_all_clean();
                self.windows.mark_all_clean();
                // Send output
                let _ = self.output_tx.send(output.clone()).await;
                Response::Output { data: output }
            }

            Command::BringToFront { id } => {
                self.windows.bring_to_front(&id);
                Response::Ok
            }

            Command::SendToBack { id } => {
                self.windows.send_to_back(&id);
                Response::Ok
            }

            Command::EnableMouse { mode } => {
                let mouse_mode = MouseMode::from_str(&mode);
                let output = self.renderer.enable_mouse(mouse_mode);
                let _ = self.output_tx.send(output).await;
                Response::Ok
            }

            Command::DisableMouse => {
                let output = self.renderer.disable_mouse();
                let _ = self.output_tx.send(output).await;
                Response::Ok
            }

            // Session management commands are handled at server level, not session level
            // These return errors if they somehow get to process_command
            Command::ListSessions => {
                Response::Error { message: "ListSessions should be handled at server level".to_string() }
            }

            Command::ShareDisplay { .. } => {
                Response::Error { message: "ShareDisplay should be handled at server level".to_string() }
            }

            Command::UnshareDisplay { .. } => {
                Response::Error { message: "UnshareDisplay should be handled at server level".to_string() }
            }

            Command::ShareWindow { .. } => {
                Response::Error { message: "ShareWindow should be handled at server level".to_string() }
            }

            Command::UnshareWindow { .. } => {
                Response::Error { message: "UnshareWindow should be handled at server level".to_string() }
            }

            // Terminal commands are handled at server level
            Command::CreateTerminal { .. } => {
                Response::Error { message: "CreateTerminal should be handled at server level".to_string() }
            }

            Command::CloseTerminal { .. } => {
                Response::Error { message: "CloseTerminal should be handled at server level".to_string() }
            }

            Command::TerminalInput { .. } => {
                Response::Error { message: "TerminalInput should be handled at server level".to_string() }
            }

            Command::TerminalConfig { .. } => {
                Response::Error { message: "TerminalConfig should be handled at server level".to_string() }
            }

            Command::ResizeTerminal { .. } => {
                Response::Error { message: "ResizeTerminal should be handled at server level".to_string() }
            }
        }
    }

    /// Sync all terminal screens to their corresponding windows
    pub async fn sync_terminals_to_windows(&mut self) {
        // Always sync terminal content to windows on every flush
        // This ensures terminal display is never lost when windows are redrawn
        for (window_id, handle) in &self.terminals {
            let terminal = handle.terminal.read().await;
            if let Some(win) = self.windows.get_mut(window_id) {
                // Copy terminal cells to window
                for y in 0..terminal.height.min(win.inner_height()) {
                    for x in 0..terminal.width.min(win.inner_width()) {
                        let cell = &terminal.screen[y][x];
                        win.set(x, y, cell.char, cell.fg, Some(cell.bg));
                    }
                }
            }
        }
        // Clear dirty flags after sync
        for (_, handle) in &self.terminals {
            let mut terminal = handle.terminal.write().await;
            terminal.dirty = false;
        }
    }

    /// Close a terminal connection
    pub fn close_terminal(&mut self, id: &str) {
        if let Some(handle) = self.terminals.remove(id) {
            handle.abort_handle.abort();
            // Also remove the window
            self.windows.remove(id);
        }
    }

    /// Send input to a terminal
    pub async fn send_terminal_input(&self, id: &str, data: &[u8]) -> bool {
        if let Some(handle) = self.terminals.get(id) {
            handle.input_tx.send(data.to_vec()).await.is_ok()
        } else {
            false
        }
    }
}

/// APU Server
pub struct Server {
    /// Game connection port (games connect here to send commands)
    pub game_port: u16,
    /// Client connection port (players connect here via telnet)
    pub client_port: u16,
    /// Game port bind address (127.0.0.1 for local, 0.0.0.0 for network)
    pub game_bind: String,
    /// Active sessions
    sessions: Arc<RwLock<HashMap<String, ClientSession>>>,
    /// Shutdown channels for disconnecting clients
    shutdown_channels: Arc<RwLock<HashMap<String, oneshot::Sender<()>>>>,
    /// Channel to broadcast events to game connections
    event_tx: broadcast::Sender<Response>,
}

impl Server {
    pub fn new(game_port: u16, client_port: u16, game_bind: String) -> Self {
        let (event_tx, _) = broadcast::channel(1000);
        Self {
            game_port,
            client_port,
            game_bind,
            sessions: Arc::new(RwLock::new(HashMap::new())),
            shutdown_channels: Arc::new(RwLock::new(HashMap::new())),
            event_tx,
        }
    }

    /// Run the server
    pub async fn run(&self) -> Result<(), Box<dyn std::error::Error>> {
        info!("Starting APU server...");
        info!("Game port: {} (bind: {})", self.game_port, self.game_bind);
        info!("Client port: {}", self.client_port);

        let game_listener = TcpListener::bind(format!("{}:{}", self.game_bind, self.game_port)).await?;
        let client_listener = TcpListener::bind(format!("0.0.0.0:{}", self.client_port)).await?;

        info!("APU server listening");

        let sessions = self.sessions.clone();
        let sessions2 = self.sessions.clone();
        let shutdown_channels = self.shutdown_channels.clone();
        let shutdown_channels2 = self.shutdown_channels.clone();
        let event_tx = self.event_tx.clone();
        let event_tx2 = self.event_tx.clone();

        // Handle game connections
        let game_handle = tokio::spawn(async move {
            loop {
                match game_listener.accept().await {
                    Ok((socket, addr)) => {
                        info!("Game connected from {}", addr);
                        let sessions = sessions.clone();
                        let shutdown_channels = shutdown_channels.clone();
                        let event_rx = event_tx.subscribe();
                        let event_tx_clone = event_tx.clone();
                        tokio::spawn(handle_game_connection(socket, sessions, shutdown_channels, event_rx, event_tx_clone));
                    }
                    Err(e) => {
                        error!("Game accept error: {}", e);
                    }
                }
            }
        });

        // Handle client connections
        let client_handle = tokio::spawn(async move {
            loop {
                match client_listener.accept().await {
                    Ok((socket, addr)) => {
                        info!("Client connected from {}", addr);
                        let sessions = sessions2.clone();
                        let shutdown_channels = shutdown_channels2.clone();
                        let event_tx = event_tx2.clone();
                        tokio::spawn(handle_client_connection(socket, addr.to_string(), sessions, shutdown_channels, event_tx));
                    }
                    Err(e) => {
                        error!("Client accept error: {}", e);
                    }
                }
            }
        });

        // Wait for both
        let _ = tokio::try_join!(game_handle, client_handle)?;

        Ok(())
    }
}

/// Handle a game connection (receives JSON commands, sends events)
async fn handle_game_connection(
    socket: TcpStream,
    sessions: Arc<RwLock<HashMap<String, ClientSession>>>,
    shutdown_channels: Arc<RwLock<HashMap<String, oneshot::Sender<()>>>>,
    mut event_rx: broadcast::Receiver<Response>,
    event_tx: broadcast::Sender<Response>,
) {
    let (reader, mut writer) = socket.into_split();
    let mut reader = BufReader::new(reader);
    let mut line = String::new();

    // Notify game about all existing sessions (for reconnection after game restart)
    {
        let sessions_read = sessions.read().await;
        for session_id in sessions_read.keys() {
            let connect_event = Response::ClientConnect { session: session_id.clone() };
            let json = serialize_response(&connect_event);
            if let Err(e) = writer.write_all(format!("{}\n", json).as_bytes()).await {
                error!("Failed to send existing session to game: {}", e);
            }
        }
        let _ = writer.flush().await;
        if !sessions_read.is_empty() {
            info!("Notified game about {} existing session(s)", sessions_read.len());
        }
    }

    // Task to send events to game
    let writer_handle = tokio::spawn(async move {
        loop {
            match event_rx.recv().await {
                Ok(event) => {
                    let json = serialize_response(&event);
                    if let Err(e) = writer.write_all(format!("{}\n", json).as_bytes()).await {
                        error!("Failed to send event to game: {}", e);
                        break;
                    }
                    let _ = writer.flush().await;
                }
                Err(broadcast::error::RecvError::Closed) => break,
                Err(broadcast::error::RecvError::Lagged(n)) => {
                    debug!("Game connection lagged by {} events", n);
                }
            }
        }
    });

    // Read commands from game
    loop {
        line.clear();
        match reader.read_line(&mut line).await {
            Ok(0) => {
                info!("Game disconnected");
                break;
            }
            Ok(_) => {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }

                debug!("Game command: {}", trimmed);

                // Parse command with session targeting
                match parse_targeted_command(trimmed) {
                    Ok(targeted) => {
                        let mut sessions = sessions.write().await;

                        // Handle server-level commands first
                        match &targeted.command {
                            Command::ListSessions => {
                                let session_list: Vec<SessionInfo> = sessions
                                    .values()
                                    .map(|s| s.info())
                                    .collect();
                                debug!("ListSessions: {} sessions", session_list.len());
                                // Send sessions list as response
                                let _ = event_tx.send(Response::Sessions { sessions: session_list });
                                continue;
                            }

                            Command::ShareDisplay { source, target } => {
                                // Mark that target should receive source's display updates
                                if let Some(target_session) = sessions.get_mut(target) {
                                    if !target_session.display_shares_from.contains(source) {
                                        target_session.display_shares_from.push(source.clone());
                                    }
                                }
                                if let Some(source_session) = sessions.get_mut(source) {
                                    if !source_session.display_shares_to.contains(target) {
                                        source_session.display_shares_to.push(target.clone());
                                    }
                                }
                                debug!("ShareDisplay: {} -> {}", source, target);
                                continue;
                            }

                            Command::UnshareDisplay { source, target } => {
                                if let Some(target_session) = sessions.get_mut(target) {
                                    target_session.display_shares_from.retain(|s| s != source);
                                }
                                if let Some(source_session) = sessions.get_mut(source) {
                                    source_session.display_shares_to.retain(|t| t != target);
                                }
                                debug!("UnshareDisplay: {} -> {}", source, target);
                                continue;
                            }

                            Command::ShareWindow { .. } | Command::UnshareWindow { .. } => {
                                // TODO: Implement window-level sharing
                                debug!("Window sharing not yet implemented");
                                continue;
                            }

                            // Handle Shutdown command specially to disconnect the session
                            Command::Shutdown => {
                                if let Some(session_id) = targeted.session.as_deref() {
                                    // First send the shutdown output to the session
                                    if let Some(session) = sessions.get_mut(session_id) {
                                        let _ = session.process_command(Command::Shutdown).await;
                                    }
                                    // Then trigger the shutdown signal to disconnect
                                    let mut channels = shutdown_channels.write().await;
                                    if let Some(tx) = channels.remove(session_id) {
                                        let _ = tx.send(());
                                        info!("Shutdown signal sent to session {}", session_id);
                                    }
                                }
                                continue;
                            }

                            // Handle CreateTerminal command
                            Command::CreateTerminal { ref id, ref host, port, x, y, width, height, ref terminal_type, ref border, ref title, closable, resizable } => {
                                if let Some(session_id) = targeted.session.as_deref() {
                                    if let Some(session) = sessions.get_mut(session_id) {
                                        let term_type = TerminalType::from_str(terminal_type);
                                        let border_style: crate::core::window::BorderStyle = match border.as_str() {
                                            "none" => crate::core::window::BorderStyle::None,
                                            "double" => crate::core::window::BorderStyle::Double,
                                            _ => crate::core::window::BorderStyle::Single,
                                        };

                                        // Content size depends on border style
                                        let (content_width, content_height) = if border_style == crate::core::window::BorderStyle::None {
                                            (*width, *height)  // No border, content is full size
                                        } else {
                                            ((*width).saturating_sub(2), (*height).saturating_sub(2))  // Border takes 2 chars
                                        };

                                        // Create terminal handle (spawns connection task in background)
                                        let handle = create_terminal_handle(
                                            id.clone(),
                                            host.clone(),
                                            *port,
                                            content_width,
                                            content_height,
                                            term_type,
                                            event_tx.clone(),
                                        );

                                        // Create window for terminal
                                        let win = session.windows.create_window(id.clone(), *x, (*y).max(1), *width, *height);
                                        win.set_border(border_style.into());
                                        if let Some(t) = title {
                                            win.set_title(t.clone());
                                        } else if border_style != crate::core::window::BorderStyle::None {
                                            win.set_title(format!("{}:{}", host, *port));
                                        }
                                        win.closable = *closable;
                                        win.resizable = *resizable;
                                        win.draggable = border_style != crate::core::window::BorderStyle::None;

                                        // Store terminal handle
                                        session.terminals.insert(id.clone(), handle);
                                        session.focused_window = Some(id.clone());
                                        info!("Terminal {} connecting to {}:{}", id, host, *port);
                                    }
                                }
                                continue;
                            }

                            // Handle CloseTerminal command
                            Command::CloseTerminal { id } => {
                                if let Some(session_id) = targeted.session.as_deref() {
                                    if let Some(session) = sessions.get_mut(session_id) {
                                        session.close_terminal(&id);
                                        info!("Terminal {} closed", id);
                                    }
                                }
                                continue;
                            }

                            // Handle TerminalInput command
                            Command::TerminalInput { id, data } => {
                                if let Some(session_id) = targeted.session.as_deref() {
                                    if let Some(session) = sessions.get(session_id) {
                                        let _ = session.send_terminal_input(&id, data.as_bytes()).await;
                                    }
                                }
                                continue;
                            }

                            // Handle TerminalConfig command
                            Command::TerminalConfig { id, local_echo, line_ending } => {
                                if let Some(session_id) = targeted.session.as_deref() {
                                    if let Some(session) = sessions.get_mut(session_id) {
                                        if let Some(handle) = session.terminals.get_mut(id) {
                                            if let Some(echo) = local_echo {
                                                handle.local_echo = *echo;
                                                debug!("Terminal {} local_echo set to {}", id, echo);
                                            }
                                            if let Some(ending) = line_ending {
                                                handle.line_ending = ending.clone();
                                                debug!("Terminal {} line_ending set to {}", id, ending);
                                            }
                                        }
                                    }
                                }
                                continue;
                            }

                            // Handle ResizeTerminal command
                            Command::ResizeTerminal { id, x, y, width, height, border, title, closable, resizable, draggable } => {
                                if let Some(session_id) = targeted.session.as_deref() {
                                    if let Some(session) = sessions.get_mut(session_id) {
                                        // Calculate content size (window size minus border)
                                        let border_style: crate::core::window::BorderStyle = match border.as_str() {
                                            "none" => crate::core::window::BorderStyle::None,
                                            "double" => crate::core::window::BorderStyle::Double,
                                            _ => crate::core::window::BorderStyle::Single,
                                        };
                                        let (content_width, content_height) = if border_style == crate::core::window::BorderStyle::None {
                                            (*width, *height)
                                        } else {
                                            (width.saturating_sub(2), height.saturating_sub(2))
                                        };

                                        // Resize the terminal emulator and send NAWS
                                        if let Some(handle) = session.terminals.get_mut(id) {
                                            // Resize terminal emulator buffer (use try_write to avoid blocking)
                                            if let Ok(mut terminal) = handle.terminal.try_write() {
                                                terminal.resize(content_width, content_height);
                                                debug!("Terminal {} resized to {}x{}", id, content_width, content_height);
                                            }

                                            // Send NAWS (window size) to remote
                                            let w = content_width as u16;
                                            let h = content_height as u16;
                                            let naws = vec![
                                                255, 250, 31,  // IAC SB NAWS
                                                (w >> 8) as u8, (w & 0xff) as u8,
                                                (h >> 8) as u8, (h & 0xff) as u8,
                                                255, 240  // IAC SE
                                            ];
                                            let _ = handle.input_tx.try_send(naws);
                                        }

                                        // Update the window
                                        if let Some(win) = session.windows.get_mut(id) {
                                            win.x = *x;
                                            win.y = (*y).max(1);  // Protect menu bar
                                            win.resize(*width, *height);
                                            win.set_border(border_style);
                                            if let Some(t) = title {
                                                win.set_title(t.clone());
                                            } else if border_style != crate::core::window::BorderStyle::None {
                                                // Keep existing title for bordered windows
                                            } else {
                                                win.set_title(String::new());
                                            }
                                            win.closable = *closable;
                                            win.resizable = *resizable;
                                            win.draggable = *draggable;
                                            win.dirty = true;
                                        }
                                        info!("Terminal {} resized to {}x{} at ({},{})", id, width, height, x, y);
                                    }
                                }
                                continue;
                            }

                            _ => {} // Other commands handled below
                        }

                        // Route command based on session field
                        let target_session = targeted.session.as_deref();

                        match target_session {
                            // Broadcast to all sessions (None or "*")
                            None | Some("*") => {
                                for (_, session) in sessions.iter_mut() {
                                    let _response = session.process_command(targeted.command.clone()).await;
                                }
                            }

                            // Send to specific session only
                            Some(session_id) => {
                                if let Some(session) = sessions.get_mut(session_id) {
                                    let _response = session.process_command(targeted.command.clone()).await;
                                } else {
                                    debug!("Target session not found: {}", session_id);
                                }
                            }
                        }
                    }
                    Err(e) => {
                        error!("Parse error: {}", e);
                    }
                }
            }
            Err(e) => {
                error!("Game read error: {}", e);
                break;
            }
        }
    }

    // Game disconnected - don't disable mouse mode for clients
    // They'll keep working and the next game that connects will pick them up
    info!("Game disconnected - clients remain connected, waiting for new game");

    writer_handle.abort();
}

/// Handle a client connection (telnet player)
async fn handle_client_connection(
    socket: TcpStream,
    addr: String,
    sessions: Arc<RwLock<HashMap<String, ClientSession>>>,
    shutdown_channels: Arc<RwLock<HashMap<String, oneshot::Sender<()>>>>,
    event_tx: broadcast::Sender<Response>,
) {
    let session_id = format!("session_{}", addr.replace(":", "_").replace(".", "_"));

    // Create shutdown channel for this session
    let (shutdown_tx, mut shutdown_rx) = oneshot::channel::<()>();
    {
        let mut channels = shutdown_channels.write().await;
        channels.insert(session_id.clone(), shutdown_tx);
    }

    // Create output channel
    let (output_tx, mut output_rx) = mpsc::channel::<String>(100);

    // Notify games of new client
    let _ = event_tx.send(Response::ClientConnect { session: session_id.clone() });

    // Create session
    {
        let session = ClientSession::new(session_id.clone(), addr.clone(), output_tx, 80, 24);
        let mut sessions = sessions.write().await;
        sessions.insert(session_id.clone(), session);
    }

    let (reader, mut writer) = socket.into_split();

    // Send telnet negotiation to enable raw mode (suppress local echo)
    if let Err(e) = writer.write_all(&telnet_raw_mode()).await {
        error!("Failed to send telnet negotiation: {}", e);
        return;
    }
    let _ = writer.flush().await;

    // Initialize display
    {
        let mut sessions = sessions.write().await;
        if let Some(session) = sessions.get_mut(&session_id) {
            let _ = session.init().await;
        }
    }

    // Task to send output to client
    let write_handle = tokio::spawn(async move {
        while let Some(output) = output_rx.recv().await {
            if let Err(e) = writer.write_all(output.as_bytes()).await {
                error!("Client write error: {}", e);
                break;
            }
            if let Err(e) = writer.flush().await {
                error!("Client flush error: {}", e);
                break;
            }
        }
    });

    // Read input from client (byte-by-byte for escape sequences)
    let mut input_parser = InputParser::new();
    let mut buf = [0u8; 256];
    let mut reader = BufReader::new(reader);

    // Timer for auto-flushing terminal updates (30ms = ~33fps)
    let mut flush_interval = tokio::time::interval(std::time::Duration::from_millis(30));
    flush_interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

    loop {
        tokio::select! {
            // Check for shutdown signal
            _ = &mut shutdown_rx => {
                info!("Client {} shutdown requested", session_id);
                break;
            }
            // Auto-flush terminals periodically
            _ = flush_interval.tick() => {
                let mut sessions = sessions.write().await;
                if let Some(session) = sessions.get_mut(&session_id) {
                    // Only flush if there are terminals (avoid unnecessary work)
                    if !session.terminals.is_empty() {
                        session.sync_terminals_to_windows().await;
                        session.windows.composite();
                        let output = session.renderer.render(&session.windows.display, false);
                        session.windows.display.mark_all_clean();
                        session.windows.mark_all_clean();
                        let _ = session.output_tx.send(output).await;
                    }
                }
            }
            // Read from socket
            result = reader.read(&mut buf) => {
                match result {
                    Ok(0) => {
                        info!("Client {} disconnected", session_id);
                        break;
                    }
                    Ok(n) => {
                        // Filter out telnet protocol commands
                        let filtered = filter_telnet_commands(&buf[..n]);
                        if filtered.is_empty() {
                            continue;
                        }

                        // Parse input bytes into events
                        let events = input_parser.parse(&filtered);

                        // Process each event (mouse events may be intercepted by window chrome)
                        for event in events {
                            debug!("Input from {}: {:?}", session_id, event);

                            // Check for console toggle (Ctrl+\ or F10)
                            let is_console_toggle = match &event {
                                InputEvent::Char { char: ch } => ClientSession::is_console_toggle_char(*ch),
                                InputEvent::Key { key } => *key == crate::input::Key::F10,
                                _ => false,
                            };
                            if is_console_toggle {
                                let mut sessions = sessions.write().await;
                                if let Some(session) = sessions.get_mut(&session_id) {
                                    session.toggle_console();
                                    session.draw_console().await;
                                    if !session.console_open {
                                        // Redraw screen when closing console
                                        let _ = event_tx.send(Response::RefreshRequested {
                                            session: session_id.clone(),
                                        });
                                    }
                                }
                                continue;
                            }

                            // If console is open, handle console input
                            {
                                let mut sessions = sessions.write().await;
                                if let Some(session) = sessions.get_mut(&session_id) {
                                    if session.console_open {
                                        match &event {
                                            InputEvent::Char { char: ch } => {
                                                if *ch >= ' ' && *ch != '\x7f' {
                                                    session.console_input.push(*ch);
                                                    session.draw_console().await;
                                                }
                                            }
                                            InputEvent::Key { key } => {
                                                match key {
                                                    crate::input::Key::Enter => {
                                                        let (should_reset, should_close) = session.process_console_command();
                                                        session.console_open = false;

                                                        if should_reset {
                                                            // Request game to refresh everything
                                                            let _ = event_tx.send(Response::RefreshRequested {
                                                                session: session_id.clone(),
                                                            });
                                                        }
                                                        if should_close {
                                                            // Trigger shutdown for this session
                                                            drop(sessions);
                                                            let mut channels = shutdown_channels.write().await;
                                                            if let Some(tx) = channels.remove(&session_id) {
                                                                let _ = tx.send(());
                                                                info!("Console close command - disconnecting session {}", session_id);
                                                            }
                                                            continue;
                                                        }
                                                        // Redraw screen
                                                        let _ = event_tx.send(Response::RefreshRequested {
                                                            session: session_id.clone(),
                                                        });
                                                    }
                                                    crate::input::Key::Backspace => {
                                                        session.console_input.pop();
                                                        session.draw_console().await;
                                                    }
                                                    crate::input::Key::Escape => {
                                                        session.console_open = false;
                                                        session.console_input.clear();
                                                        let _ = event_tx.send(Response::RefreshRequested {
                                                            session: session_id.clone(),
                                                        });
                                                    }
                                                    _ => {}
                                                }
                                            }
                                            _ => {}
                                        }
                                        continue; // Don't forward to game when console is open
                                    }
                                }
                            }

                            // Check if this is a mouse event that might interact with window chrome
                            if let InputEvent::Mouse { x, y, button, event: mouse_event_type, .. } = &event {
                                let mut sessions = sessions.write().await;
                                if let Some(session) = sessions.get_mut(&session_id) {
                                    let (window_events, forward_to_game) = session.handle_mouse_event(
                                        *x as usize,
                                        *y as usize,
                                        *button,
                                        *mouse_event_type,
                                    );

                                    // Emit any window events (WindowMoved, WindowResized, etc.)
                                    for window_event in window_events {
                                        let _ = event_tx.send(window_event);
                                    }

                                    // Auto-flush for live drag/resize feedback
                                    session.auto_flush().await;

                                    // Only forward to game if not consumed by window chrome
                                    if forward_to_game {
                                        let _ = event_tx.send(Response::Input {
                                            session: session_id.clone(),
                                            event,
                                        });
                                    }
                                }
                            } else {
                                // Check if there's a focused terminal to route input to
                                let mut sent_to_terminal = false;
                                {
                                    let mut sessions_write = sessions.write().await;
                                    if let Some(session) = sessions_write.get_mut(&session_id) {
                                        if let Some(ref focused_id) = session.focused_window.clone() {
                                            if let Some(handle) = session.terminals.get(focused_id) {
                                                // Convert input event to bytes for terminal
                                                let bytes = input_event_to_bytes(&event, &handle.line_ending);
                                                if !bytes.is_empty() {
                                                    // Handle local echo if enabled
                                                    if handle.local_echo {
                                                        // Feed the input to terminal emulator for local echo
                                                        let echo_bytes = match &event {
                                                            InputEvent::Char { char } => {
                                                                let mut buf = [0u8; 4];
                                                                let s = char.encode_utf8(&mut buf);
                                                                s.as_bytes().to_vec()
                                                            }
                                                            InputEvent::Key { key } => {
                                                                use crate::input::Key;
                                                                match key {
                                                                    Key::Enter => b"\r\n".to_vec(),
                                                                    Key::Backspace => b"\x08 \x08".to_vec(), // backspace, space, backspace
                                                                    _ => Vec::new(),
                                                                }
                                                            }
                                                            _ => Vec::new(),
                                                        };
                                                        if !echo_bytes.is_empty() {
                                                            let mut terminal = handle.terminal.write().await;
                                                            terminal.process_data(&echo_bytes);
                                                        }
                                                    }

                                                    let _ = handle.input_tx.send(bytes).await;
                                                    sent_to_terminal = true;
                                                }
                                            }
                                        }
                                    }
                                }

                                // If not sent to terminal, forward to game
                                if !sent_to_terminal {
                                    let _ = event_tx.send(Response::Input {
                                        session: session_id.clone(),
                                        event,
                                    });
                                }
                            }
                        }
                    }
                    Err(e) => {
                        error!("Client read error: {}", e);
                        break;
                    }
                }
            }
        }
    }

    // Notify games of disconnect
    let _ = event_tx.send(Response::ClientDisconnect { session: session_id.clone() });

    // Cleanup
    {
        let mut sessions = sessions.write().await;
        sessions.remove(&session_id);
    }
    {
        let mut channels = shutdown_channels.write().await;
        channels.remove(&session_id);
    }

    write_handle.abort();
}

/// Convert an input event to bytes for sending to a terminal
/// line_ending: "cr" (default) sends CR only, "crlf" sends CR+LF, "lf" sends LF only (Ctrl+J)
fn input_event_to_bytes(event: &InputEvent, line_ending: &str) -> Vec<u8> {
    match event {
        InputEvent::Char { char } => {
            let mut buf = [0u8; 4];
            let s = char.encode_utf8(&mut buf);
            s.as_bytes().to_vec()
        }
        InputEvent::Key { key } => {
            use crate::input::Key;
            match key {
                Key::Up => b"\x1b[A".to_vec(),
                Key::Down => b"\x1b[B".to_vec(),
                Key::Right => b"\x1b[C".to_vec(),
                Key::Left => b"\x1b[D".to_vec(),
                Key::Home => b"\x1b[H".to_vec(),
                Key::End => b"\x1b[F".to_vec(),
                Key::PageUp => b"\x1b[5~".to_vec(),
                Key::PageDown => b"\x1b[6~".to_vec(),
                Key::Insert => b"\x1b[2~".to_vec(),
                Key::Delete => b"\x1b[3~".to_vec(),
                Key::Backspace => vec![0x08],  // BS (Ctrl+H) - more compatible than DEL (0x7f)
                Key::Enter => {
                    match line_ending {
                        "crlf" => vec![0x0d, 0x0a],  // CR + LF
                        "lf" => vec![0x0a],          // LF only (Ctrl+J)
                        _ => vec![0x0d],             // CR only (default)
                    }
                }
                Key::Tab => vec![0x09],
                Key::Escape => vec![0x1b],
                Key::F1 => b"\x1bOP".to_vec(),
                Key::F2 => b"\x1bOQ".to_vec(),
                Key::F3 => b"\x1bOR".to_vec(),
                Key::F4 => b"\x1bOS".to_vec(),
                Key::F5 => b"\x1b[15~".to_vec(),
                Key::F6 => b"\x1b[17~".to_vec(),
                Key::F7 => b"\x1b[18~".to_vec(),
                Key::F8 => b"\x1b[19~".to_vec(),
                Key::F9 => b"\x1b[20~".to_vec(),
                Key::F10 => b"\x1b[21~".to_vec(),
                Key::F11 => b"\x1b[23~".to_vec(),
                Key::F12 => b"\x1b[24~".to_vec(),
            }
        }
        // Mouse events are not sent to terminal
        InputEvent::Mouse { .. } => Vec::new(),
    }
}

/// Create a terminal handle and spawn connection task
/// The connection happens in the background; events are sent on success/failure
fn create_terminal_handle(
    id: String,
    host: String,
    port: u16,
    width: usize,
    height: usize,
    terminal_type: TerminalType,
    event_tx: broadcast::Sender<Response>,
) -> TerminalHandle {
    // Create terminal emulator
    let terminal = Arc::new(RwLock::new(Terminal::new(id.clone(), width, height, terminal_type)));

    // Create channel for sending input to remote
    let (input_tx, mut input_rx) = mpsc::channel::<Vec<u8>>(100);

    // Spawn connection task (connects in background)
    let terminal_clone = terminal.clone();
    let event_tx_clone = event_tx.clone();
    let id_clone = id.clone();
    let host_clone = host.clone();

    let task = tokio::spawn(async move {
        // Try to connect
        let connect_result = TcpStream::connect(format!("{}:{}", host_clone, port)).await;
        let stream = match connect_result {
            Ok(s) => s,
            Err(e) => {
                let _ = event_tx_clone.send(Response::TerminalError {
                    id: id_clone,
                    error: format!("Connection failed: {}", e),
                });
                return;
            }
        };

        let (mut reader, mut writer) = stream.into_split();

        // Send connected event
        let _ = event_tx_clone.send(Response::TerminalConnected {
            id: id_clone.clone(),
            host: host_clone.clone(),
            port,
        });

        // Send proactive telnet negotiation to announce our capabilities
        // IAC WILL TERMINAL-TYPE (255 251 24) - we can send terminal type
        // IAC WILL NAWS (255 251 31) - we can send window size
        let telnet_init: &[u8] = &[
            255, 251, 24,  // IAC WILL TERMINAL-TYPE
            255, 251, 31,  // IAC WILL NAWS (window size)
        ];
        let _ = writer.write_all(telnet_init).await;
        let _ = writer.flush().await;

        // Task to send input to remote (and handle telnet responses)
        let id_for_writer = id_clone.clone();
        let (telnet_tx, mut telnet_rx) = mpsc::channel::<Vec<u8>>(100);

        let writer_handle = tokio::spawn(async move {
            loop {
                tokio::select! {
                    Some(data) = input_rx.recv() => {
                        if let Err(e) = writer.write_all(&data).await {
                            error!("Terminal {} write error: {}", id_for_writer, e);
                            break;
                        }
                        let _ = writer.flush().await;
                    }
                    Some(data) = telnet_rx.recv() => {
                        // Telnet protocol responses
                        if let Err(e) = writer.write_all(&data).await {
                            error!("Terminal {} telnet write error: {}", id_for_writer, e);
                            break;
                        }
                        let _ = writer.flush().await;
                    }
                    else => break,
                }
            }
        });

        // Read from remote and update terminal
        let mut buf = [0u8; 4096];
        let mut telnet_state = TelnetState::Normal;
        let mut telnet_cmd: u8 = 0;
        let mut subneg_buffer: Vec<u8> = Vec::new();

        loop {
            match reader.read(&mut buf).await {
                Ok(0) => {
                    // Connection closed
                    let _ = event_tx_clone.send(Response::TerminalDisconnected {
                        id: id_clone.clone(),
                        reason: "Connection closed".to_string(),
                    });
                    break;
                }
                Ok(n) => {
                    // Filter telnet commands and process terminal data
                    let mut filtered_data: Vec<u8> = Vec::new();

                    for &byte in &buf[..n] {
                        match telnet_state {
                            TelnetState::Normal => {
                                if byte == 255 {  // IAC
                                    telnet_state = TelnetState::Iac;
                                } else {
                                    filtered_data.push(byte);
                                }
                            }
                            TelnetState::Iac => {
                                match byte {
                                    255 => {
                                        // Escaped IAC
                                        filtered_data.push(255);
                                        telnet_state = TelnetState::Normal;
                                    }
                                    250 => {
                                        // SB - Subnegotiation Begin
                                        telnet_state = TelnetState::Subneg;
                                        subneg_buffer.clear();
                                    }
                                    251..=254 => {
                                        // WILL/WONT/DO/DONT
                                        telnet_cmd = byte;
                                        telnet_state = TelnetState::Option;
                                    }
                                    _ => {
                                        telnet_state = TelnetState::Normal;
                                    }
                                }
                            }
                            TelnetState::Option => {
                                // Handle telnet option negotiation
                                let option = byte;
                                match (telnet_cmd, option) {
                                    (253, 24) => {
                                        // DO TERMINAL-TYPE - respond with WILL
                                        let _ = telnet_tx.send(vec![255, 251, 24]).await;
                                    }
                                    (253, 31) => {
                                        // DO NAWS - respond with WILL and send window size
                                        let _ = telnet_tx.send(vec![255, 251, 31]).await;
                                        // Send window size: IAC SB NAWS width_hi width_lo height_hi height_lo IAC SE
                                        let w = width as u16;
                                        let h = height as u16;
                                        let _ = telnet_tx.send(vec![
                                            255, 250, 31,  // IAC SB NAWS
                                            (w >> 8) as u8, (w & 0xff) as u8,
                                            (h >> 8) as u8, (h & 0xff) as u8,
                                            255, 240  // IAC SE
                                        ]).await;
                                    }
                                    _ => {}
                                }
                                telnet_state = TelnetState::Normal;
                            }
                            TelnetState::Subneg => {
                                if byte == 255 {
                                    telnet_state = TelnetState::SubnegIac;
                                } else {
                                    subneg_buffer.push(byte);
                                }
                            }
                            TelnetState::SubnegIac => {
                                if byte == 240 {  // SE - Subnegotiation End
                                    // Process subnegotiation
                                    if !subneg_buffer.is_empty() {
                                        let option = subneg_buffer[0];
                                        if option == 24 && subneg_buffer.len() > 1 && subneg_buffer[1] == 1 {
                                            // TERMINAL-TYPE SEND - respond with terminal type
                                            // IAC SB TERMINAL-TYPE IS ANSI IAC SE
                                            let mut response = vec![255, 250, 24, 0];  // IAC SB TERMINAL-TYPE IS
                                            response.extend_from_slice(b"ANSI");
                                            response.extend_from_slice(&[255, 240]);  // IAC SE
                                            let _ = telnet_tx.send(response).await;
                                        }
                                    }
                                    telnet_state = TelnetState::Normal;
                                } else if byte == 255 {
                                    subneg_buffer.push(255);
                                } else {
                                    subneg_buffer.push(byte);
                                    telnet_state = TelnetState::Subneg;
                                }
                            }
                        }
                    }

                    // Process filtered data through terminal emulator
                    if !filtered_data.is_empty() {
                        let mut terminal = terminal_clone.write().await;
                        terminal.process_data(&filtered_data);

                        // Drain response queue (e.g., cursor position reports for ANSI detection)
                        while let Some(response) = terminal.response_queue.pop_front() {
                            let _ = telnet_tx.send(response).await;
                        }
                    }
                }
                Err(e) => {
                    let _ = event_tx_clone.send(Response::TerminalDisconnected {
                        id: id_clone.clone(),
                        reason: format!("Read error: {}", e),
                    });
                    break;
                }
            }
        }

        writer_handle.abort();
    });

    TerminalHandle {
        terminal,
        input_tx,
        abort_handle: task.abort_handle(),
        host,
        port,
        local_echo: false,
        line_ending: "cr".to_string(),
    }
}
