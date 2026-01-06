# APU: ASCII Processing Unit

## Design Document v1.0

---

## Vision

**APU is a universal character-cell display engine that lets developers build terminal applications once and run them everywhere—from 1978 VT-100 terminals to modern web browsers to mobile phones.**

The game developer focuses on *what* to display. APU figures out *how* to display it on each platform.

---

## Philosophy

### Graceful Fallback

Every feature has a degradation path. Nothing breaks—it just adapts:

```
BEST AVAILABLE ──────────────────────────────────► MINIMUM VIABLE

True Color ──► 256 Color ──► 16 Color ──► 8 Color ──► Bold/Dim ──► Plain
   ╔══╗    ──►    ╔══╗    ──►   +==+   ──►   +--+   ──►   +--+
 (Unicode)      (CP437)       (ASCII+)     (ASCII)      (TTY)
   Mouse   ──► Arrow Keys ──►   HJKL   ──►  Number Keys ──► None
  80×50    ──►    80×24   ──►   40×24  ──►    22×23    ──► 20×10
```

### Native Feel, Not Compromise

Each platform ideally will get its **optimal** experience, not a degraded one:
- Apple II (40 cols): Full-screen map with popup panels
- VT-100 (80 cols): Split panels, ASCII borders
- Modern web: Responsive layout, true color, mouse/touch
- Mobile: Touch controls, swipe gestures, tabs

The user on each platform feels like the app was designed *for* their system.

APU translates to the appropriate representation for each platform.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                     GAME / APPLICATION                               │
│            (ObjectMUD in JavaScript, or any language)                │
│         Works with: windows, sprites, semantic colors                │
├─────────────────────────────────────────────────────────────────────┤
│                          APU API                                     │
│   window()  box()  text()  sprite()  effect()  input()  layout()    │
├─────────────────────────────────────────────────────────────────────┤
│                      APU CORE (C/Rust)                               │
│  ┌──────────────┬──────────────┬──────────────┬──────────────────┐  │
│  │   Layout     │   Window     │    Color     │   Capability     │  │
│  │   Engine     │   Manager    │    Mapper    │   Detector       │  │
│  └──────────────┴──────────────┴──────────────┴──────────────────┘  │
│  ┌──────────────┬──────────────┬──────────────┬──────────────────┐  │
│  │  Cell Grid   │   Window     │   Effects    │   Dirty Rect     │  │
│  │  (objects)   │  Compositor  │   Engine     │   Optimizer      │  │
│  └──────────────┴──────────────┴──────────────┴──────────────────┘  │
├─────────────────────────────────────────────────────────────────────┤
│                  RENDERER MODULE SYSTEM (Plugins)                    │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐  │
│  │ ansi_ibm │ │ ansi_vt  │ │  xterm   │ │  web_ws  │ │  c64     │  │
│  │  80×24   │ │  80×24   │ │ dynamic  │ │ dynamic  │ │  40×25   │  │
│  │  CP437   │ │  ASCII   │ │ Unicode  │ │ Unicode  │ │ PETSCII  │  │
│  │ 16 color │ │ 2 color  │ │ 256/true │ │ true     │ │ 16 color │  │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Modular Renderer System

### Philosophy

Renderers are **plugins** that can be added over time without modifying the core. Each renderer module tells APU how to output to a specific platform. The core never touches platform-specific code directly.

### Renderer Module Interface

```rust
// Every renderer implements this trait
pub trait Renderer {
    /// Module identity
    fn name(&self) -> &str;                    // "ansi_ibm_80x24"
    fn description(&self) -> &str;             // "IBM PC ANSI 80×24"

    /// Display capabilities
    fn dimensions(&self) -> (u16, u16);        // (80, 24)
    fn resizable(&self) -> bool;               // false for fixed
    fn color_depth(&self) -> ColorDepth;       // Color16, Color256, TrueColor
    fn charset(&self) -> Charset;              // ASCII, CP437, Unicode, PETSCII

    /// Character mapping
    fn map_char(&self, glyph: &Glyph) -> Vec<u8>;
    fn map_color(&self, color: &SemanticColor) -> Vec<u8>;

    /// Output generation
    fn render_cell(&self, cell: &Cell) -> Vec<u8>;
    fn render_frame(&self, grid: &CellGrid, dirty: &DirtyRects) -> Vec<u8>;
    fn clear_screen(&self) -> Vec<u8>;
    fn move_cursor(&self, x: u16, y: u16) -> Vec<u8>;
    fn hide_cursor(&self) -> Vec<u8>;
    fn show_cursor(&self) -> Vec<u8>;

    /// Input parsing
    fn parse_input(&self, bytes: &[u8]) -> Option<InputEvent>;

    /// Feature support
    fn supports(&self, feature: Feature) -> bool;
    fn init_sequence(&self) -> Vec<u8>;        // Sent on connect
    fn shutdown_sequence(&self) -> Vec<u8>;    // Sent on disconnect
}
```

### Standard Renderer Modules

#### `ansi_ibm_80x24` (Starting Point)

```rust
// The first renderer we implement - IBM PC ANSI standard
pub struct AnsiIbm80x24;

impl Renderer for AnsiIbm80x24 {
    fn name(&self) -> &str { "ansi_ibm_80x24" }
    fn dimensions(&self) -> (u16, u16) { (80, 24) }
    fn resizable(&self) -> bool { false }
    fn color_depth(&self) -> ColorDepth { ColorDepth::Color16 }
    fn charset(&self) -> Charset { Charset::CP437 }

    fn map_char(&self, glyph: &Glyph) -> Vec<u8> {
        // Return CP437 byte for the glyph
        vec![glyph.cp437.unwrap_or(b'?')]
    }

    fn map_color(&self, color: &SemanticColor) -> Vec<u8> {
        // Standard ANSI SGR codes
        format!("\x1b[{}m", color.to_ansi_16()).into_bytes()
    }

    fn render_cell(&self, cell: &Cell) -> Vec<u8> {
        let mut out = Vec::new();
        out.extend(self.map_color(&cell.fg));
        if let Some(bg) = &cell.bg {
            out.extend(format!("\x1b[{}m", bg.to_ansi_16_bg()).as_bytes());
        }
        out.extend(self.map_char(&cell.glyph));
        out
    }

    fn init_sequence(&self) -> Vec<u8> {
        b"\x1b[2J\x1b[H\x1b[?25l".to_vec()  // Clear, home, hide cursor
    }
}
```

#### `ansi_vt100_80x24` (Maximum Compatibility)

```rust
// Pure VT-100 - works on original 1978 hardware
pub struct AnsiVt100;

impl Renderer for AnsiVt100 {
    fn name(&self) -> &str { "ansi_vt100_80x24" }
    fn dimensions(&self) -> (u16, u16) { (80, 24) }
    fn color_depth(&self) -> ColorDepth { ColorDepth::Mono }  // Bold/dim only
    fn charset(&self) -> Charset { Charset::ASCII }

    fn map_char(&self, glyph: &Glyph) -> Vec<u8> {
        // ASCII fallback only
        glyph.ascii.as_bytes().to_vec()
    }

    fn map_color(&self, color: &SemanticColor) -> Vec<u8> {
        // VT-100: bold, dim, reverse, underline only
        match color.intensity() {
            Intensity::Bright => b"\x1b[1m".to_vec(),  // Bold
            Intensity::Dim => b"\x1b[2m".to_vec(),     // Dim
            Intensity::Normal => b"\x1b[0m".to_vec(),  // Reset
        }
    }
}
```

#### `xterm_dynamic` (Modern Terminals)

```rust
// Modern xterm-compatible with dynamic sizing
pub struct XtermDynamic {
    cols: u16,
    rows: u16,
    true_color: bool,
}

impl Renderer for XtermDynamic {
    fn name(&self) -> &str { "xterm_dynamic" }
    fn dimensions(&self) -> (u16, u16) { (self.cols, self.rows) }
    fn resizable(&self) -> bool { true }
    fn color_depth(&self) -> ColorDepth {
        if self.true_color { ColorDepth::TrueColor } else { ColorDepth::Color256 }
    }
    fn charset(&self) -> Charset { Charset::Unicode }

    fn map_color(&self, color: &SemanticColor) -> Vec<u8> {
        if self.true_color {
            let (r, g, b) = color.to_rgb();
            format!("\x1b[38;2;{};{};{}m", r, g, b).into_bytes()
        } else {
            let idx = color.to_256();
            format!("\x1b[38;5;{}m", idx).into_bytes()
        }
    }
}
```

#### `web_canvas` (Browser)

```javascript
// Web renderer using Canvas API
class WebCanvasRenderer {
    constructor(canvas, options = {}) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.cellWidth = options.cellWidth || 10;
        this.cellHeight = options.cellHeight || 18;
        this.font = options.font || '16px monospace';
    }

    get dimensions() {
        return [
            Math.floor(this.canvas.width / this.cellWidth),
            Math.floor(this.canvas.height / this.cellHeight)
        ];
    }

    renderCell(x, y, cell) {
        const px = x * this.cellWidth;
        const py = y * this.cellHeight;

        // Background
        if (cell.bg) {
            this.ctx.fillStyle = cell.bg;
            this.ctx.fillRect(px, py, this.cellWidth, this.cellHeight);
        }

        // Foreground
        this.ctx.fillStyle = cell.fg || '#ffffff';
        this.ctx.font = this.font;
        this.ctx.fillText(cell.char, px, py + this.cellHeight - 2);
    }
}
```

### Adding New Renderers

Renderers are discovered at runtime from the `renderers/` directory:

```
apu/
└── renderers/
    ├── ansi_ibm.so        # Compiled module
    ├── ansi_vt100.so
    ├── xterm.so
    ├── web_canvas.js      # JavaScript for browser
    ├── c64_petscii.so     # Commodore 64!
    ├── apple2_40col.so    # Apple II
    └── custom/            # User-added renderers
        └── my_renderer.so
```

```rust
// Loading renderers at startup
fn load_renderers() -> Vec<Box<dyn Renderer>> {
    let mut renderers = Vec::new();

    for entry in fs::read_dir("renderers/")? {
        let path = entry?.path();
        if path.extension() == Some("so") {
            let lib = Library::new(&path)?;
            let create: Symbol<fn() -> Box<dyn Renderer>> = lib.get(b"create_renderer")?;
            renderers.push(create());
        }
    }

    renderers
}
```

---

## Core Concepts

### 1. The Cell Grid

The display is an 80×24 (or dynamic) grid of cell objects:

```javascript
cell = {
  id: "cell_23_5",
  x: 23,
  y: 5,

  // Appearance (can be static or expression)
  char: '#',                          // Static
  char: "tick % 2 ? '*' : '·'",       // Expression (compiled)

  fg: 'gold',                         // Semantic color
  bg: null,                           // Transparent

  // State
  state: { hot: false, energy: 100 },

  // Behavior flags (native speed)
  flags: {
    blink: 500,                       // Blink at 500ms
    cycle: ['a', 'b', 'c'],           // Cycle characters
  },

  // Ownership
  owner: 'god',                       // System owns UI cells
}
```

### 2. Windows as Objects (Full Windowing System)

APU provides a **complete windowing system** capable of running ANY character-cell application—from Microsoft Works for DOS to BBS door games to MUDs and MUSHes. Windows can be any size, any position, with or without borders.

#### Window Properties

```javascript
window = {
  id: 'main',

  // Positioning (absolute OR semantic)
  x: 0,                               // Absolute: column position
  y: 0,                               // Absolute: row position
  // OR
  position: 'beside:map',             // Semantic: relationship-based

  // Sizing (absolute OR percentage OR auto)
  width: 40,                          // Absolute: character cells
  height: 12,                         // Absolute: character cells
  // OR
  width: '50%',                       // Percentage of screen
  height: '100%',
  // OR
  width: 'auto',                      // Size to content
  height: 'auto',

  // Constraints
  minWidth: 10,
  minHeight: 5,
  maxWidth: 80,
  maxHeight: 24,

  // Appearance
  border: 'double',                   // 'none', 'single', 'double', 'rounded', 'heavy', 'ascii'
  borderColor: 'white',
  title: 'My Window',
  titleAlign: 'center',               // 'left', 'center', 'right'
  background: 'black',                // Fill color (null = transparent)
  shadow: true,                       // Drop shadow effect

  // Behavior
  visible: true,
  zIndex: 0,                          // Stacking order (higher = on top)
  focusable: true,
  scrollable: true,                   // Enable scrolling
  resizable: true,                    // User can resize (if platform supports)
  draggable: true,                    // User can drag (if platform supports)
  modal: false,                       // Block input to other windows

  // Content region (inside borders)
  padding: { top: 0, right: 0, bottom: 0, left: 0 },

  // Ownership
  owner: 'god',                       // System window
  // OR
  owner: 'player_123',                // Player-owned (customizable)
}
```

#### Window Types

```javascript
// FULLSCREEN - No borders, fills entire screen (like MS-DOS apps)
apu.window({
  id: 'fullscreen',
  x: 0, y: 0,
  width: '100%', height: '100%',
  border: 'none',
});

// BORDERLESS REGION - Specific area, no chrome
apu.window({
  id: 'map_area',
  x: 0, y: 1,
  width: 40, height: 20,
  border: 'none',
  background: null,                   // Transparent
});

// CLASSIC DIALOG - Centered modal with border
apu.window({
  id: 'dialog',
  width: 40, height: 10,
  position: 'center',
  border: 'double',
  modal: true,
  title: 'Confirm',
});

// FLOATING POPUP - Appears at cursor/position
apu.window({
  id: 'tooltip',
  x: 15, y: 8,
  width: 'auto', height: 'auto',
  border: 'single',
  shadow: true,
  zIndex: 100,
});

// SPLIT PANE - Multiple windows sharing space
apu.window({ id: 'left', x: 0, width: '50%', height: '100%', border: 'single' });
apu.window({ id: 'right', x: '50%', width: '50%', height: '100%', border: 'single' });

// BBS-STYLE STATUS LINE - Fixed at bottom
apu.window({
  id: 'status',
  x: 0, y: 23,
  width: '100%', height: 1,
  border: 'none',
  background: 'blue',
});
```

#### Semantic Positioning (Auto-Layout)

For games like ObjectMUD, semantic positioning lets APU figure out the best layout:

```javascript
apu.window('map', {
  role: 'primary',                    // Gets most space
  minSize: { w: 20, h: 10 },          // Minimum to be usable
  scalable: true,                     // Can grow/shrink
});

apu.window('info', {
  role: 'secondary',
  position: 'beside:map',             // To the right of map
  fallback: 'tab',                    // Become tab if no room
});

apu.window('chat', {
  role: 'tertiary',
  position: 'below:info',
  fallback: 'popup',                  // Become popup if no room
  collapsible: true,
});
```

#### Scrollable Regions

```javascript
const win = apu.window({
  id: 'scrollable',
  width: 40, height: 10,
  scrollable: true,
  scrollHeight: 100,                  // Virtual height (scrolls 100 lines)
});

win.scroll(10);                       // Scroll down 10 lines
win.scrollTo(0);                      // Scroll to top
win.scrollEnd();                      // Scroll to bottom

// Get scroll info
win.scrollPosition;                   // Current line at top
win.scrollHeight;                     // Total virtual height
win.viewportHeight;                   // Visible lines
```

#### Window Events

```javascript
win.on('focus', () => {});
win.on('blur', () => {});
win.on('resize', (w, h) => {});
win.on('move', (x, y) => {});
win.on('scroll', (pos) => {});
win.on('close', () => {});
```

### 3. Relationship Types

```
beside:target     Same row, to the right of target
below:target      Same column, underneath target
inside:target     Nested within target (for HUD elements)
overlay:target    Floating on top (modal/popup)
dock:edge         Anchored to screen edge (top/bottom/left/right)
tab:target        Shares space with target as tabbed interface
```

### 4. Layout Strategies

APU selects the optimal strategy based on screen size:

```javascript
strategies = {

  'fullscreen_primary': {
    // Tiny screens: Apple II, C64, mobile portrait
    // Primary gets all space, secondaries are popups
    primary: { x: 0, y: 0, w: '100%', h: '100% - statusLines' },
    secondaries: 'popup',
    navigation: 'hotkeys',
  },

  'split_horizontal': {
    // Standard: 80-column terminals
    // Primary left, secondaries stacked right
    primary: { x: 0, w: '60%', h: '100%' },
    secondaries: { x: '60%', w: '40%', stack: 'vertical' },
  },

  'stacked_with_tabs': {
    // Mobile landscape, narrow windows
    // Primary top, tabbed secondaries below
    primary: { y: 0, h: '60%', w: '100%' },
    secondaries: { y: '60%', h: '40%', mode: 'tabbed' },
    gestures: true,
  },

  'responsive': {
    // Modern terminals: adapt dynamically
    breakpoints: {
      wide:   { minCols: 120, use: 'everything_visible' },
      normal: { minCols: 80,  use: 'split_horizontal' },
      narrow: { minCols: 60,  use: 'stacked_with_tabs' },
      tiny:   { minCols: 40,  use: 'fullscreen_primary' },
    }
  },
};
```

### 5. Player Layout Configuration Mode

Players can enter **layout mode** to customize their window arrangement. This lets each user create their preferred interface while the application provides sensible defaults.

#### Entering Layout Mode

```javascript
// Application enables layout customization
apu.allowLayoutMode(true);

// Player triggers layout mode (e.g., pressing F10 or @layout command)
apu.enterLayoutMode();
```

#### Layout Mode UI

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ LAYOUT MODE - Arrow keys: select window, Enter: move/resize, ESC: done      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   ┌──────────────────────[MAP]──────────────────────┐  ┌────[INFO]────┐    │
│   │                                                 │  │              │    │
│   │                                                 │  │              │    │
│   │            ◄─── Selected Window ────►           │  │              │    │
│   │                                                 │  │              │    │
│   │                                                 │  ├────[CHAT]────┤    │
│   │                                                 │  │              │    │
│   └─────────────────────────────────────────────────┘  └──────────────┘    │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│ [R]esize  [M]ove  [B]order  [H]ide  [D]efault  [S]ave  [L]oad preset       │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### Layout Mode Operations

```javascript
// In layout mode, player can:
'select'     // Arrow keys cycle through windows
'move'       // M then arrow keys to reposition
'resize'     // R then arrow keys to resize
'border'     // B to cycle border styles (none, single, double)
'hide'       // H to toggle window visibility
'fullscreen' // F to toggle fullscreen (removes all other windows)
'default'    // D to reset to application defaults
'save'       // S to save current layout
'load'       // L to load a saved preset
```

#### Saving Player Layouts

```javascript
// Layout is saved per-player, per-application
const layout = apu.saveLayout();
// Returns:
{
  version: 1,
  app: 'objectmud',
  player: 'player_123',
  windows: [
    { id: 'map', x: 0, y: 0, width: 45, height: 22, border: 'single', visible: true },
    { id: 'info', x: 45, y: 0, width: 35, height: 11, border: 'double', visible: true },
    { id: 'chat', x: 45, y: 11, width: 35, height: 11, border: 'single', visible: true },
  ]
}

// Load player's saved layout
apu.loadLayout(playerId);

// Built-in presets
apu.loadPreset('classic');      // Traditional MUD layout
apu.loadPreset('minimal');      // Just the essentials
apu.loadPreset('fullscreen');   // Map only, everything else as popups
apu.loadPreset('wide');         // For 120+ column terminals
```

#### Layout Constraints

Applications can enforce constraints:

```javascript
// Prevent players from hiding critical windows
apu.window('map', {
  layoutLocked: false,          // Can move/resize
  hideable: false,              // Cannot hide
  minWidth: 20,                 // Minimum dimensions
  minHeight: 10,
});

// Some windows are completely locked
apu.window('status', {
  layoutLocked: true,           // Cannot move, resize, or hide
});
```

---

## Universal Application Support

APU is designed to run **any character-cell application**—not just games. The windowing system and input handling support:

### Application Types

| Type | Examples | APU Features Used |
|------|----------|-------------------|
| **Text Editors** | vi, emacs, nano | Fullscreen, scrolling, cursor, key capture |
| **Productivity** | MS Works, WordPerfect | Multi-window, menus, dialogs, forms |
| **BBS Software** | WWIV, Renegade, Mystic | ANSI art, door games, file transfers |
| **Door Games** | LORD, TradeWars, Usurper | Full ANSI, real-time input, sound |
| **MUDs** | DikuMUD, ROM, MUSH | Scrolling text, input line, split panes |
| **Roguelikes** | Nethack, ADOM, Angband | Tile display, inventory, status |
| **Dashboards** | htop, btop, lazygit | Live updates, graphs, process lists |
| **File Managers** | mc, ranger, nnn | Dual-pane, directory trees, previews |

### Full-Application Mode

For applications that need complete control (like a BBS or DOS program):

```javascript
// Take over the entire screen with no APU chrome
const app = apu.fullApplication({
  id: 'bbs',
  passthrough: true,              // Raw ANSI passthrough
});

// Application sends raw ANSI sequences
app.write('\x1b[2J\x1b[H');       // Clear screen
app.write('\x1b[31mHello!\x1b[0m'); // Red text

// APU handles only:
// - Terminal capability negotiation
// - Input routing
// - Connection management
```

### Menus and Forms (TUI Toolkit)

APU includes standard TUI widgets:

```javascript
// Dropdown menu
const menu = apu.menu({
  items: [
    { label: 'File', items: ['New', 'Open', 'Save', 'Exit'] },
    { label: 'Edit', items: ['Cut', 'Copy', 'Paste'] },
    { label: 'Help', items: ['About'] },
  ],
  style: 'dos',                   // DOS-style menu bar
});

// Input form
const form = apu.form({
  fields: [
    { name: 'username', label: 'Username:', type: 'text', maxLength: 20 },
    { name: 'password', label: 'Password:', type: 'password' },
    { name: 'color', label: 'Color:', type: 'select', options: ['Red', 'Green', 'Blue'] },
    { name: 'agree', label: 'I agree to terms', type: 'checkbox' },
  ],
  buttons: ['OK', 'Cancel'],
});

form.on('submit', data => {
  console.log(data.username, data.password);
});

// List box
const list = apu.listbox({
  items: ['Item 1', 'Item 2', 'Item 3'],
  multiSelect: true,
  scrollable: true,
});

// Progress bar
const progress = apu.progress({
  value: 45,
  max: 100,
  style: 'block',                 // 'block', 'line', 'percentage'
});
```

### ANSI Art Support

```javascript
// Load and display ANSI art files
const art = apu.loadANSI('welcome.ans');
win.drawANSI(0, 0, art);

// Support for:
// - Standard ANSI escape sequences
// - PCBoard/Wildcat color codes (@X00-@XFF)
// - Renegade/Telegard codes (|00-|23)
// - SAUCE metadata
```

---

## Emulator Backend Plugins

APU can host **actual emulators** as backend plugins, allowing players to run real vintage software through telnet! The emulator output is translated through APU's character-cell system.

### Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           APU Core                                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                      Emulator Plugin System                                 │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐  │
│  │  DOSBox  │ │  VICE    │ │ AppleWin │ │  Z80emu  │ │ Custom emulators │  │
│  │  (DOS)   │ │ (C64)    │ │ (Apple)  │ │ (CP/M)   │ │                  │  │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘ └────────┬─────────┘  │
│       │            │            │            │                │            │
│       └────────────┴────────────┴────────────┴────────────────┘            │
│                                  │                                          │
│                    ┌─────────────▼─────────────┐                           │
│                    │   Character Translator    │                           │
│                    │  (PETSCII→CP437→ASCII)    │                           │
│                    └─────────────┬─────────────┘                           │
│                                  │                                          │
│                    ┌─────────────▼─────────────┐                           │
│                    │    Renderer Modules       │                           │
│                    │   (output to client)      │                           │
│                    └───────────────────────────┘                           │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Emulator Plugin Interface

```rust
pub trait EmulatorBackend {
    /// Identity
    fn name(&self) -> &str;                      // "dosbox"
    fn platform(&self) -> &str;                  // "MS-DOS"
    fn screen_size(&self) -> (u16, u16);         // (80, 25)
    fn charset(&self) -> Charset;                // CP437

    /// Lifecycle
    fn start(&mut self, config: &EmulatorConfig) -> Result<()>;
    fn stop(&mut self);
    fn is_running(&self) -> bool;

    /// Load software
    fn load_disk(&mut self, path: &Path) -> Result<()>;
    fn load_rom(&mut self, path: &Path) -> Result<()>;
    fn run_command(&mut self, cmd: &str) -> Result<()>;

    /// Display capture
    fn get_screen(&self) -> &CharacterScreen;    // Current screen state
    fn on_screen_update(&mut self, callback: Box<dyn Fn(&DirtyRegion)>);

    /// Input injection
    fn send_key(&mut self, key: Key);
    fn send_text(&mut self, text: &str);
    fn send_mouse(&mut self, x: u16, y: u16, buttons: u8);

    /// State
    fn save_state(&self) -> Vec<u8>;
    fn load_state(&mut self, state: &[u8]) -> Result<()>;
}
```

### Supported Emulators

#### DOSBox (MS-DOS)

```javascript
// Run MS-DOS programs through telnet!
const dos = apu.emulator('dosbox', {
  screen: { cols: 80, rows: 25 },
  charset: 'cp437',
});

// Mount a disk image
dos.mount('C:', '/path/to/games');
dos.run('C:\\DOOM\\DOOM.EXE');

// Or run directly
dos.run('/path/to/program.exe');

// Player sees DOS output through their terminal
// APU translates CP437 → their charset
```

#### VICE (Commodore 64/128/VIC-20)

```javascript
// Run C64 games in character mode!
const c64 = apu.emulator('vice', {
  machine: 'c64',                    // 'c64', 'c128', 'vic20', 'pet'
  screen: { cols: 40, rows: 25 },
  charset: 'petscii',
});

// Load a program
c64.load('/path/to/game.prg');
c64.run();

// PETSCII characters translated to user's terminal charset
// Supports text adventures, BBS software, GEOS (!)
```

#### AppleWin (Apple II)

```javascript
// Apple II text mode games
const apple = apu.emulator('applewin', {
  model: 'iie',                      // 'ii', 'iie', 'iic', 'iigs'
  screen: { cols: 40, rows: 24 },    // Or 80 cols with card
  charset: 'apple2',
});

apple.load('/path/to/game.dsk');
apple.boot();

// Text adventures like Zork, educational software, BBS...
```

#### Z80/CP/M

```javascript
// Run CP/M software!
const cpm = apu.emulator('z80', {
  screen: { cols: 80, rows: 24 },
  charset: 'ascii',
});

cpm.mount('A:', '/path/to/cpm.img');
cpm.run('ZORK.COM');

// WordStar, dBASE, Turbo Pascal...
```

### Character Set Translation

APU automatically translates between character sets:

```
┌────────────────────────────────────────────────────────────────────────────┐
│                     CHARACTER TRANSLATION MATRIX                           │
├────────────┬─────────────┬─────────────┬─────────────┬─────────────────────┤
│   FROM ▼   │    ASCII    │    CP437    │   PETSCII   │       Unicode       │
├────────────┼─────────────┼─────────────┼─────────────┼─────────────────────┤
│  PETSCII   │  approx     │  closest    │  identity   │  exact              │
│  CP437     │  approx     │  identity   │  closest    │  exact              │
│  Apple II  │  approx     │  closest    │  closest    │  exact              │
│  Unicode   │  fallback   │  closest    │  closest    │  identity           │
└────────────┴─────────────┴─────────────┴─────────────┴─────────────────────┘

Examples:
  PETSCII heart (♥) → CP437 0x03 → ASCII '<3' → Unicode U+2665
  CP437 box (╔) → PETSCII approx → ASCII '+' → Unicode U+2554
  Apple II inverse → Bold on terminals that support it
```

### Multiplayer Emulation Sessions

```javascript
// Host an emulator session for multiple players
const session = apu.emulatorSession({
  emulator: 'dosbox',
  maxPlayers: 4,
  shareScreen: true,                 // Everyone sees same screen
  inputMode: 'host-only',            // Or 'round-robin', 'all'
});

session.on('join', player => {
  console.log(`${player.name} is watching`);
});

// Players can take turns or watch together
session.setInputPlayer(playerId);
```

### BBS Door Game Support

```javascript
// Run actual BBS door games!
const door = apu.door({
  path: '/doors/lord',               // Legend of the Red Dragon
  dropfile: 'DOOR.SYS',              // BBS dropfile format
  node: 1,
});

// APU generates the dropfile with player info
door.start({
  playerName: 'RedWolf',
  timeLimit: 30,                     // Minutes
  ansiCapable: true,
});

// Popular doors: LORD, TradeWars 2002, Usurper, BRE, etc.
```

### Safety and Sandboxing

```javascript
// Emulators run in sandboxed environments
const sandbox = apu.sandbox({
  emulator: 'dosbox',
  limits: {
    cpu: '50%',                      // Max CPU usage
    memory: '64MB',                  // Max RAM
    disk: '100MB',                   // Max disk space
    network: false,                  // No network access
    timeout: 3600,                   // Auto-terminate after 1 hour
  },
});
```

---

## Platform Profiles

### Supported Display Spectrum

| Platform | Columns | Colors | Charset | Strategy |
|----------|---------|--------|---------|----------|
| Teletype | 80 | 1 (mono) | ASCII | fullscreen |
| VT-100 | 80 | 2 (bold) | ASCII | split |
| Apple II | 40 | 16 | ASCII | fullscreen+popup |
| C64 | 40 | 16 | PETSCII | fullscreen+popup |
| VT-220 | 80/132 | 8 | DEC Special | split |
| xterm | dynamic | 256 | Unicode | responsive |
| Modern term | dynamic | 16M | Unicode | responsive |
| Web desktop | dynamic | 16M | Unicode | responsive |
| Mobile | dynamic | 16M | Unicode | stacked+touch |
| Smartwatch | ~20 | varies | Unicode | fullscreen |

### Platform Detection

```javascript
apu.detect() → {
  cols: 80,
  rows: 24,
  colors: 256,              // 2, 8, 16, 256, 16777216
  charset: 'unicode',       // 'ascii', 'cp437', 'petscii', 'unicode'
  mouse: true,
  touch: false,
  resize: true,             // Can detect resize events
  unicode: true,
  truecolor: false,
  sixel: false,             // Sixel graphics
  kitty: false,             // Kitty graphics protocol
}
```

---

## Graceful Fallback System

### Color Fallback

```javascript
apu.color('gold', { r: 255, g: 215, b: 0 });

// APU translates per terminal:
// True color:  \e[38;2;255;215;0m    (exact)
// 256 color:   \e[38;5;220m          (closest match)
// 16 color:    \e[33m                (yellow)
// 8 color:     \e[1;33m              (bright yellow)
// Mono:        \e[1m                 (bold)
// Teletype:    (nothing)             (plain text)
```

### Character Fallback

```javascript
apu.glyph('box_double_h', {
  unicode: '═',
  cp437: 0xCD,
  ascii: '=',
  minimal: '-',
});

apu.glyph('player', {
  unicode: '☺',
  cp437: 0x01,
  ascii: '@',
  emoji: '🧑',
});

apu.glyph('heart', {
  unicode: '♥',
  cp437: 0x03,
  ascii: '<3',           // Multi-char fallback
  emoji: '❤️',
});
```

### Box Drawing Fallback

```
STYLE         UNICODE       CP437        ASCII
─────────────────────────────────────────────────
single        ┌─┐│└┘        ┌─┐│└┘       +-+||+-+
double        ╔═╗║╚╝        ╔═╗║╚╝       +==+||+==+
rounded       ╭─╮│╰╯        +-+|+-+      +-+||+-+
heavy         ┏━┓┃┗┛        +-+|+-+      +-+||+-+
```

### Input Fallback

```javascript
apu.on('move', dir => {});    // Unified movement event

// Sources (in priority order):
// - Arrow keys
// - WASD
// - HJKL (vim)
// - Numpad
// - Touch swipe
// - D-pad buttons
// - Number keys (1-9 for directions)
```

---

## API Reference

### Connection

```javascript
const apu = require('apu');
const display = apu.connect('localhost:7000');

// Or for web
const display = apu.connect('wss://game.example.com/apu');
```

### Windows

```javascript
// Create a window
const win = display.window({
  id: 'map',
  role: 'primary',
  title: 'The Nexus',
});

// Window methods
win.clear();
win.print(x, y, text, { fg, bg, style });
win.box({ style: 'double' });
win.fill(char, { fg, bg });
win.scroll(lines);

// Window properties
win.width;    // Current width (computed by APU)
win.height;   // Current height
win.visible;  // true/false
win.focused;  // true/false
```

### Drawing

```javascript
// Low-level cell access
display.cell(x, y, {
  char: '█',
  fg: 'red',
  bg: 'black',
  blink: false,
});

// Batch update (efficient)
display.batch([
  { x: 0, y: 0, char: '╔', fg: 'white' },
  { x: 1, y: 0, char: '═', fg: 'white' },
  { x: 2, y: 0, char: '╗', fg: 'white' },
]);
display.flip();  // Commit changes

// Primitives
display.line(x1, y1, x2, y2, { char, fg, bg });
display.rect(x, y, w, h, { style, fg, bg, fill });
display.text(x, y, string, { fg, bg, wrap });
display.sprite(x, y, glyphName, { fg, bg });
```

### Effects

```javascript
// Cell effects (native speed)
display.effect(x, y, {
  blink: 500,           // Blink interval ms
  fade: 'in',           // Fade in/out
  shake: true,          // Shake effect
});

// Region effects
display.effectRegion(x, y, w, h, {
  wave: true,           // Wave animation
  rainbow: true,        // Cycle colors
  rain: 'matrix',       // Matrix-style rain
});
```

### Input

```javascript
// Semantic input events
display.on('move', dir => {
  // dir: 'up', 'down', 'left', 'right'
});

display.on('action', () => {
  // Space, Enter, touch tap, A button
});

display.on('cancel', () => {
  // Escape, B button, back swipe
});

display.on('menu', () => {
  // Tab, menu button
});

display.on('hotkey', key => {
  // Single key press
});

display.on('text', str => {
  // Text input mode
});

display.on('click', (x, y, button) => {
  // Mouse/touch (if available)
});
```

### Layout Queries

```javascript
// Current display info
display.width;      // Current columns
display.height;     // Current rows
display.colors;     // Color capability
display.charset;    // Character set

// Layout breakpoints
display.on('resize', (w, h) => {});
display.on('breakpoint', bp => {
  // 'wide', 'normal', 'narrow', 'tiny'
});
```

---

## Protocol

### Socket Protocol (TCP/Unix)

JSON messages, newline-delimited:

```json
{"cmd":"window","id":"map","role":"primary"}
{"cmd":"cell","x":10,"y":5,"char":"@","fg":"gold"}
{"cmd":"batch","cells":[{"x":0,"y":0,"char":"#"},...]}
{"cmd":"flip"}
{"cmd":"effect","x":10,"y":5,"blink":500}
```

### Binary Protocol (High Performance)

```
Byte 0:     Command ID
Bytes 1-2:  X position (uint16)
Bytes 3-4:  Y position (uint16)
Byte 5:     Character (or glyph ID)
Byte 6:     Foreground color (palette index)
Byte 7:     Background color (palette index)
Byte 8:     Flags (blink, bold, etc.)
```

### WebSocket Protocol

Same as socket protocol, over WebSocket for browser clients.

---

## Renderer Implementations

### ANSI Renderer (VT-100, xterm, modern terminals)

```
- Escape sequence generation
- Color mode detection and mapping
- Cursor optimization (move vs redraw)
- Dirty rectangle tracking
- Terminal resize handling
```

### Teletype Renderer (serial terminals, line printers)

```
- No cursor movement (full redraw only)
- No colors, no formatting
- CR/LF line endings
- Fixed 80×24 (or configured)
```

### Web Canvas Renderer

```
- HTML5 Canvas 2D
- Monospace font rendering
- True color support
- 60fps animation
- Mouse and touch events
```

### Web DOM Renderer

```
- <pre> or <table> based
- CSS styling
- Accessible (screen readers)
- Searchable text
- Slower than canvas, but semantic
```

### Mobile Renderer

```
- Touch event translation
- Virtual D-pad overlay
- Gesture recognition (swipe, pinch)
- Portrait/landscape adaptation
- On-screen keyboard handling
```

---

## Implementation Plan

### Phase 1: Core Engine (Week 1-2)

```
[ ] Cell grid data structure
[ ] Basic ANSI output
[ ] Window compositor
[ ] Simple layout engine
[ ] Socket server
[ ] Node.js client library
```

### Phase 2: Fallback System (Week 3)

```
[ ] Capability detection
[ ] Color mapping (true→256→16→8→mono)
[ ] Character set translation
[ ] Box drawing fallback
[ ] Platform profiles
```

### Phase 3: Layout Engine (Week 4)

```
[ ] Responsive breakpoints
[ ] Relationship-based positioning
[ ] Tab/popup fallback
[ ] Status line system
[ ] Dynamic resize handling
```

### Phase 4: Effects & Polish (Week 5)

```
[ ] Blink/animation effects
[ ] Dirty rectangle optimization
[ ] Input abstraction
[ ] Error handling
[ ] Performance tuning
```

### Phase 5: Web & Mobile (Week 6)

```
[ ] Canvas renderer
[ ] DOM renderer
[ ] WebSocket transport
[ ] Touch controls
[ ] PWA support
```

### Phase 6: Documentation & Release (Week 7)

```
[ ] API documentation
[ ] Tutorial / getting started
[ ] Example applications
[ ] npm/pip/cargo packages
[ ] GitHub release
```

---

## File Structure

```
apu/
├── README.md
├── LICENSE
│
├── core/                     # C or Rust
│   ├── apu.h                 # Public API header
│   ├── cell.c                # Cell object system
│   ├── grid.c                # Cell grid management
│   ├── window.c              # Window objects
│   ├── compositor.c          # Window compositor
│   ├── layout.c              # Layout engine
│   ├── color.c               # Color mapping
│   ├── charset.c             # Character translation
│   ├── effects.c             # Animation/effects
│   ├── capability.c          # Terminal detection
│   └── protocol.c            # Wire protocol
│
├── renderers/
│   ├── ansi.c                # VT-100 / xterm / modern
│   ├── teletype.c            # Pure ASCII, no escapes
│   ├── web_canvas.js         # Browser canvas
│   ├── web_dom.js            # Browser DOM
│   └── mobile.js             # Touch overlay
│
├── server/
│   ├── tcp.c                 # TCP socket server
│   ├── unix.c                # Unix socket server
│   └── websocket.c           # WebSocket server
│
├── clients/
│   ├── node/                 # npm package
│   │   ├── package.json
│   │   ├── index.js
│   │   └── apu.d.ts          # TypeScript definitions
│   ├── python/               # pip package
│   │   ├── setup.py
│   │   └── apu.py
│   └── rust/                 # cargo crate
│       ├── Cargo.toml
│       └── src/lib.rs
│
├── web/
│   ├── apu-client.js         # Browser client
│   ├── apu-client.min.js     # Minified
│   ├── touch-controls.js     # Mobile controls
│   ├── pwa/                  # Progressive Web App
│   │   ├── manifest.json
│   │   └── service-worker.js
│   └── demo.html             # Interactive demo
│
├── examples/
│   ├── hello.js              # Hello world
│   ├── chat.js               # Simple chat app
│   ├── roguelike.js          # Game example
│   └── dashboard.js          # TUI dashboard
│
├── tests/
│   ├── test_layout.c
│   ├── test_color.c
│   ├── test_charset.c
│   └── test_protocol.c
│
└── docs/
    ├── getting-started.md
    ├── api-reference.md
    ├── platform-guide.md
    └── contributing.md
```

---

## Example Usage

### Hello World

```javascript
const apu = require('apu');
const display = apu.connect();

const win = display.window({
  id: 'main',
  role: 'primary',
  title: 'Hello APU'
});

win.box({ style: 'double' });
win.print(2, 2, 'Hello, World!', { fg: 'gold' });
win.print(2, 4, 'Press any key to exit...', { fg: 'gray' });

display.on('hotkey', () => {
  display.close();
});
```

### Game Layout

```javascript
const apu = require('apu');
const display = apu.connect();

// Define windows semantically
display.window({ id: 'map', role: 'primary' });
display.window({ id: 'info', role: 'secondary', position: 'beside:map' });
display.window({ id: 'chat', role: 'tertiary', position: 'below:info' });
display.window({ id: 'inventory', role: 'modal', trigger: 'i' });

// Get window references
const map = display.get('map');
const info = display.get('info');
const chat = display.get('chat');

// Draw game
map.box({ style: 'single' });
map.sprite(20, 10, 'player', { fg: 'gold' });
map.sprite(25, 8, 'enemy', { fg: 'red' });

info.title('Status');
info.print(1, 1, 'HP: 100/100', { fg: 'green' });
info.print(1, 2, 'MP: 50/50', { fg: 'blue' });

chat.title('Chat');
chat.print(1, 1, 'Welcome to the game!');

display.flip();

// Works on VT-100, xterm, web, mobile - automatically!
```

---

## Future Possibilities

### Sixel/Kitty Graphics

For terminals that support it, APU could render actual graphics:

```javascript
display.image(x, y, 'player.png', {
  width: 4,    // Character cells
  height: 2,
  fallback: 'sprite:player',  // Use glyph if no graphics
});
```

### Audio

```javascript
apu.sound('alert', {
  web: 'sounds/beep.mp3',
  terminal: '\x07',            // Bell character
});

apu.music('theme', {
  web: 'music/theme.mp3',
  terminal: null,              // No equivalent
});
```

### Accessibility

```javascript
display.announce('Player entered the room');  // Screen reader
display.describe('map', 'A 40x20 dungeon map showing...');
```

### Multiplayer

```javascript
// Server-side APU could multiplex multiple clients
apu.broadcast('chat', { text: 'Hello everyone!' });
apu.send(clientId, 'private', { text: 'Just for you' });
```

---

## License

MIT License - Free for all uses.

---

## Authors

Benj Edwards, 2025

---

*"The game is the idea. APU is the messenger."*
