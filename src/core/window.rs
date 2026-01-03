//! APU Window Manager
//!
//! Windows are rectangular regions on screen with optional borders.
//! The WindowManager handles z-ordering and compositing.

use std::collections::HashMap;
use super::cell::{Attrs, Color};
use super::grid::{box_styles, BoxChars, Grid};

/// Border style for windows
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BorderStyle {
    None,
    Single,
    Double,
    Rounded,
    Heavy,
    Ascii,
}

impl BorderStyle {
    /// Get box characters for this style
    pub fn chars(&self) -> Option<&'static BoxChars> {
        match self {
            BorderStyle::None => None,
            BorderStyle::Single => Some(&box_styles::SINGLE),
            BorderStyle::Double => Some(&box_styles::DOUBLE),
            BorderStyle::Rounded => Some(&box_styles::ROUNDED),
            BorderStyle::Heavy => Some(&box_styles::HEAVY),
            BorderStyle::Ascii => Some(&box_styles::ASCII),
        }
    }

    /// Check if this style has a border
    pub fn has_border(&self) -> bool {
        *self != BorderStyle::None
    }
}

impl Default for BorderStyle {
    fn default() -> Self {
        BorderStyle::Single
    }
}

/// Title alignment
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum TitleAlign {
    Left,
    #[default]
    Center,
    Right,
}

/// A window on the display
pub struct Window {
    /// Unique identifier
    pub id: String,
    /// Position (top-left corner)
    pub x: usize,
    pub y: usize,
    /// Size (total, including border)
    pub width: usize,
    pub height: usize,
    /// Border style
    pub border: BorderStyle,
    pub border_color: Color,
    /// Window title
    pub title: Option<String>,
    pub title_align: TitleAlign,
    /// Background color
    pub background: Color,
    /// Visibility and z-order
    pub visible: bool,
    pub z_index: i32,
    /// Content buffer (inner area, without border)
    pub content: Grid,
    /// Whether window needs redraw
    pub dirty: bool,

    // Window chrome configuration
    /// Show close button in title bar
    pub closable: bool,
    /// Allow resizing via bottom-right handle
    pub resizable: bool,
    /// Allow dragging via title bar
    pub draggable: bool,
    /// Minimum width when resizing
    pub min_width: usize,
    /// Minimum height when resizing
    pub min_height: usize,

    // Blend mode
    /// If true, this window inverts the colors of whatever is underneath it
    pub invert: bool,
}

impl Window {
    /// Create a new window
    pub fn new(id: impl Into<String>, x: usize, y: usize, width: usize, height: usize) -> Self {
        let border = BorderStyle::Single;
        let (content_w, content_h) = Self::content_size(width, height, border);

        Self {
            id: id.into(),
            x,
            y,
            width,
            height,
            border,
            border_color: Color::White,
            title: None,
            title_align: TitleAlign::Center,
            background: Color::Black,
            visible: true,
            z_index: 0,
            content: Grid::new(content_w, content_h),
            dirty: true,
            // Chrome defaults
            closable: true,
            resizable: true,
            draggable: true,
            min_width: 10,
            min_height: 5,
            // Blend mode
            invert: false,
        }
    }

    /// Calculate content size based on total size and border
    fn content_size(width: usize, height: usize, border: BorderStyle) -> (usize, usize) {
        if border.has_border() {
            (width.saturating_sub(2), height.saturating_sub(2))
        } else {
            (width, height)
        }
    }

    /// Get inner content dimensions
    pub fn inner_width(&self) -> usize {
        self.content.cols
    }

    pub fn inner_height(&self) -> usize {
        self.content.rows
    }

    /// Get content offset (where content starts relative to window)
    pub fn content_offset(&self) -> (usize, usize) {
        if self.border.has_border() { (1, 1) } else { (0, 0) }
    }

    /// Set border style and resize content accordingly
    pub fn set_border(&mut self, border: BorderStyle) {
        if self.border != border {
            self.border = border;
            let (content_w, content_h) = Self::content_size(self.width, self.height, border);
            self.content.resize(content_w, content_h);
            self.dirty = true;
        }
    }

    /// Set title
    pub fn set_title(&mut self, title: impl Into<String>) {
        self.title = Some(title.into());
        self.dirty = true;
    }

    /// Clear title
    pub fn clear_title(&mut self) {
        self.title = None;
        self.dirty = true;
    }

    /// Clear content
    pub fn clear(&mut self) {
        self.content.clear_with(' ', Color::White, self.background);
        self.dirty = true;
    }

    /// Write text to content area
    pub fn print(&mut self, x: usize, y: usize, text: &str, fg: Color, bg: Option<Color>) {
        let bg = bg.unwrap_or(self.background);
        self.content.write_str(x, y, text, fg, bg, Attrs::default());
        self.dirty = true;
    }

    /// Set a single cell in content area
    pub fn set(&mut self, x: usize, y: usize, ch: char, fg: Color, bg: Option<Color>) {
        let bg = bg.unwrap_or(self.background);
        self.content.set(x, y, ch, fg, bg, Attrs::default());
        self.dirty = true;
    }

    /// Fill a rectangle in content area
    pub fn fill(&mut self, x: usize, y: usize, w: usize, h: usize, ch: char, fg: Color, bg: Option<Color>) {
        let bg = bg.unwrap_or(self.background);
        self.content.fill_rect(x, y, w, h, ch, fg, bg);
        self.dirty = true;
    }

    /// Move window
    pub fn move_to(&mut self, x: usize, y: usize) {
        self.x = x;
        self.y = y;
        self.dirty = true;
    }

    /// Resize window
    pub fn resize(&mut self, width: usize, height: usize) {
        self.width = width;
        self.height = height;
        let (content_w, content_h) = Self::content_size(width, height, self.border);
        self.content.resize(content_w, content_h);
        self.dirty = true;
    }

    /// Check if point is on close button
    pub fn hit_close_button(&self, x: usize, y: usize) -> bool {
        if !self.closable || !self.visible || !self.border.has_border() {
            return false;
        }
        // Close button is at positions (x+1, y) and (x+2, y) - the "[]"
        y == self.y && (x == self.x + 1 || x == self.x + 2)
    }

    /// Check if point is on title bar (draggable area)
    pub fn hit_title_bar(&self, x: usize, y: usize) -> bool {
        if !self.draggable || !self.visible || !self.border.has_border() {
            return false;
        }
        // Title bar is the top row, excluding close button area
        let title_start = if self.closable { self.x + 3 } else { self.x + 1 };
        y == self.y && x >= title_start && x < self.x + self.width - 1
    }

    /// Check if point is on resize handle
    pub fn hit_resize_handle(&self, x: usize, y: usize) -> bool {
        if !self.resizable || !self.visible || !self.border.has_border() {
            return false;
        }
        // Resize handle is at bottom-right corner (the ◢ character)
        x == self.x + self.width - 1 && y == self.y + self.height - 1
    }

    /// Check if point is inside window (including border)
    pub fn contains(&self, x: usize, y: usize) -> bool {
        self.visible &&
        x >= self.x && x < self.x + self.width &&
        y >= self.y && y < self.y + self.height
    }

    /// Show window
    pub fn show(&mut self) {
        self.visible = true;
        self.dirty = true;
    }

    /// Hide window
    pub fn hide(&mut self) {
        self.visible = false;
        self.dirty = true;
    }

    /// Render window to a target grid
    pub fn render_to(&self, target: &mut Grid) {
        if !self.visible {
            return;
        }

        // Handle invert mode - just invert the colors at this window's position
        if self.invert {
            for dy in 0..self.height {
                for dx in 0..self.width {
                    let tx = self.x + dx;
                    let ty = self.y + dy;
                    if tx < target.cols && ty < target.rows {
                        // Get current cell and swap fg/bg
                        if let Some(cell) = target.get(tx, ty) {
                            target.set(tx, ty, cell.char, cell.bg, cell.fg, cell.attrs);
                        }
                    }
                }
            }
            return;
        }

        // Draw border if present
        if let Some(box_chars) = self.border.chars() {
            // Corners
            target.set(self.x, self.y, box_chars.tl, self.border_color, self.background, Attrs::default());
            target.set(self.x + self.width - 1, self.y, box_chars.tr, self.border_color, self.background, Attrs::default());
            target.set(self.x, self.y + self.height - 1, box_chars.bl, self.border_color, self.background, Attrs::default());
            target.set(self.x + self.width - 1, self.y + self.height - 1, box_chars.br, self.border_color, self.background, Attrs::default());

            // Top border
            for dx in 1..self.width - 1 {
                target.set(self.x + dx, self.y, box_chars.h, self.border_color, self.background, Attrs::default());
            }

            // Bottom border
            for dx in 1..self.width - 1 {
                target.set(self.x + dx, self.y + self.height - 1, box_chars.h, self.border_color, self.background, Attrs::default());
            }

            // Side borders
            for dy in 1..self.height - 1 {
                target.set(self.x, self.y + dy, box_chars.v, self.border_color, self.background, Attrs::default());
                target.set(self.x + self.width - 1, self.y + dy, box_chars.v, self.border_color, self.background, Attrs::default());
            }

            // Close button (in top-left, inside border)
            if self.closable && self.width >= 4 {
                target.set(self.x + 1, self.y, '[', self.border_color, self.background, Attrs::default());
                target.set(self.x + 2, self.y, ']', self.border_color, self.background, Attrs::default());
            }

            // Title (account for close button if present)
            if let Some(ref title) = self.title {
                let title_start = if self.closable { 4 } else { 2 };
                let max_len = self.width.saturating_sub(title_start + 2);
                let display_title: String = if title.len() > max_len {
                    format!("{}…", &title[..max_len.saturating_sub(1)])
                } else {
                    title.clone()
                };

                let title_x = match self.title_align {
                    TitleAlign::Left => self.x + title_start,
                    TitleAlign::Right => self.x + self.width - 2 - display_title.len(),
                    TitleAlign::Center => {
                        let available_space = self.width.saturating_sub(title_start);
                        self.x + title_start + (available_space.saturating_sub(display_title.len() + 2)) / 2
                    }
                };

                // Draw title brackets and text
                if title_x > self.x {
                    target.set(title_x.saturating_sub(1), self.y, '[', self.border_color, self.background, Attrs::default());
                    target.write_str(title_x, self.y, &display_title, Color::BrightWhite, self.background, Attrs::new().bold());
                    target.set(title_x + display_title.len(), self.y, ']', self.border_color, self.background, Attrs::default());
                }
            }

            // Resize handle (replaces bottom-right corner)
            if self.resizable && self.width >= 2 && self.height >= 2 {
                target.set(self.x + self.width - 1, self.y + self.height - 1, '◢', self.border_color, self.background, Attrs::default());
            }
        }

        // Draw content
        let (offset_x, offset_y) = self.content_offset();
        let content_start_x = self.x + offset_x;
        let content_start_y = self.y + offset_y;

        for (cx, cy, cell) in self.content.iter() {
            target.set(
                content_start_x + cx,
                content_start_y + cy,
                cell.char,
                cell.fg,
                cell.bg,
                cell.attrs,
            );
        }
    }
}

/// Window manager - handles multiple windows with z-ordering
pub struct WindowManager {
    /// Display dimensions
    pub cols: usize,
    pub rows: usize,
    /// Windows by ID
    pub windows: HashMap<String, Window>,
    /// Z-order (back to front)
    z_order: Vec<String>,
    /// Background layer (direct draws go here)
    pub background: Grid,
    /// Composited display (background + windows)
    pub display: Grid,
}

impl WindowManager {
    /// Create a new window manager
    pub fn new(cols: usize, rows: usize) -> Self {
        Self {
            cols,
            rows,
            windows: HashMap::new(),
            z_order: Vec::new(),
            background: Grid::new(cols, rows),
            display: Grid::new(cols, rows),
        }
    }

    /// Create a window
    pub fn create_window(&mut self, id: impl Into<String>, x: usize, y: usize, width: usize, height: usize) -> &mut Window {
        let id = id.into();

        // If window already exists, just update position and return it (preserve content)
        if let Some(existing) = self.windows.get_mut(&id) {
            existing.x = x;
            existing.y = y;
            // Only resize if dimensions changed
            if existing.width != width || existing.height != height {
                existing.resize(width, height);
            }
            existing.dirty = true;
            return self.windows.get_mut(&id).unwrap();
        }

        // Create new window
        let window = Window::new(id.clone(), x, y, width, height);
        self.windows.insert(id.clone(), window);
        self.z_order.push(id.clone());
        self.windows.get_mut(&id).unwrap()
    }

    /// Get a window by ID
    pub fn get(&self, id: &str) -> Option<&Window> {
        self.windows.get(id)
    }

    /// Get a mutable window by ID
    pub fn get_mut(&mut self, id: &str) -> Option<&mut Window> {
        self.windows.get_mut(id)
    }

    /// Remove a window
    pub fn remove(&mut self, id: &str) {
        self.windows.remove(id);
        self.z_order.retain(|wid| wid != id);
    }

    /// Remove all windows (for reset command)
    pub fn clear_all_windows(&mut self) {
        self.windows.clear();
        self.z_order.clear();
    }

    /// Bring window to front
    pub fn bring_to_front(&mut self, id: &str) {
        // First calculate max z
        let max_z = self.windows.values().map(|w| w.z_index).max().unwrap_or(0);
        // Then update
        if let Some(window) = self.windows.get_mut(id) {
            window.z_index = max_z + 1;
        }
        self.update_z_order();
    }

    /// Send window to back
    pub fn send_to_back(&mut self, id: &str) {
        // First calculate min z
        let min_z = self.windows.values().map(|w| w.z_index).min().unwrap_or(0);
        // Then update
        if let Some(window) = self.windows.get_mut(id) {
            window.z_index = min_z - 1;
        }
        self.update_z_order();
    }

    /// Update z-order based on z_index values
    fn update_z_order(&mut self) {
        self.z_order.sort_by(|a, b| {
            let za = self.windows.get(a).map(|w| w.z_index).unwrap_or(0);
            let zb = self.windows.get(b).map(|w| w.z_index).unwrap_or(0);
            za.cmp(&zb)
        });
    }

    /// Composite all windows to display
    /// Copies background first, then renders windows on top
    pub fn composite(&mut self) {
        // Copy background to display
        self.display.copy_from(&self.background);

        // Render windows in z-order (on top of background)
        for id in &self.z_order {
            if let Some(window) = self.windows.get(id) {
                window.render_to(&mut self.display);
            }
        }
    }

    /// Check if any window is dirty
    pub fn is_dirty(&self) -> bool {
        self.windows.values().any(|w| w.dirty)
    }

    /// Mark all windows clean
    pub fn mark_all_clean(&mut self) {
        for window in self.windows.values_mut() {
            window.dirty = false;
        }
    }

    /// Resize display
    pub fn resize(&mut self, cols: usize, rows: usize) {
        self.cols = cols;
        self.rows = rows;
        self.background.resize(cols, rows);
        self.display.resize(cols, rows);
    }

    /// Find the topmost window at the given coordinates
    /// Returns the window ID if found
    pub fn window_at(&self, x: usize, y: usize) -> Option<&str> {
        // Check in reverse z-order (front to back)
        for id in self.z_order.iter().rev() {
            if let Some(window) = self.windows.get(id) {
                if window.contains(x, y) {
                    return Some(id);
                }
            }
        }
        None
    }

    /// Check if a click hit a close button and return window ID
    pub fn hit_close_button(&self, x: usize, y: usize) -> Option<&str> {
        for id in self.z_order.iter().rev() {
            if let Some(window) = self.windows.get(id) {
                // Debug: log window positions
                log::debug!("Checking window '{}' at ({},{}) size {}x{}, closable={}, close button at ({},{}) and ({},{})",
                    id, window.x, window.y, window.width, window.height, window.closable,
                    window.x + 1, window.y, window.x + 2, window.y);
                if window.hit_close_button(x, y) {
                    return Some(id);
                }
            }
        }
        None
    }

    /// Check if a click hit a title bar and return window ID
    pub fn hit_title_bar(&self, x: usize, y: usize) -> Option<&str> {
        for id in self.z_order.iter().rev() {
            if let Some(window) = self.windows.get(id) {
                if window.hit_title_bar(x, y) {
                    return Some(id);
                }
            }
        }
        None
    }

    /// Check if a click hit a resize handle and return window ID
    pub fn hit_resize_handle(&self, x: usize, y: usize) -> Option<&str> {
        for id in self.z_order.iter().rev() {
            if let Some(window) = self.windows.get(id) {
                if window.hit_resize_handle(x, y) {
                    return Some(id);
                }
            }
        }
        None
    }
}

/// Interaction state for window chrome handling
#[derive(Debug, Clone, Default)]
pub struct InteractionState {
    /// Currently dragging a window
    pub dragging: Option<DragState>,
    /// Currently resizing a window
    pub resizing: Option<ResizeState>,
    /// Last title bar click for double-click detection
    pub last_title_bar_click: Option<TitleBarClick>,
}

/// State for title bar double-click detection
#[derive(Debug, Clone)]
pub struct TitleBarClick {
    /// Window that was clicked
    pub window_id: String,
    /// Timestamp (ms since epoch)
    pub time_ms: u64,
}

/// State for window dragging
#[derive(Debug, Clone)]
pub struct DragState {
    /// Window being dragged
    pub window_id: String,
    /// Offset from mouse position to window origin
    pub offset_x: isize,
    pub offset_y: isize,
}

/// State for window resizing
#[derive(Debug, Clone)]
pub struct ResizeState {
    /// Window being resized
    pub window_id: String,
    /// Original window dimensions
    pub original_width: usize,
    pub original_height: usize,
    /// Mouse position when resize started
    pub start_x: usize,
    pub start_y: usize,
}
