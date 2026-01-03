# Creation of the APU GUI Framework

## Overview

This document chronicles the creation of a modular graphical user interface framework built on top of the APU (ASCII Processing Unit). The system transforms a monolithic Mac 1984 Finder demo into a general-purpose desktop environment capable of running JavaScript applets over telnet/terminal connections.

**Date:** January 2026
**Previous State:** Monolithic `mac1984-finder.cjs` demo with hardcoded apps
**Final State:** Modular GUI framework with pluggable JavaScript apps, virtual filesystem, and session management

---

## Phase 1: Preservation of Original Work

### 1.1 Freezing the Mac 1984 Demo

Before any modifications, the original Mac 1984 demo was preserved to prevent accidental loss or corruption.

**Local backup created:**
```
/Users/redwolf/projects/objectmud/frozen/mac1984-demo/
```

**Server backup created:**
```
/mush/frozen/mac1984-demo/
```

This included:
- The complete `apu-rust/` directory with the Rust APU server
- All demo files in their working state
- Configuration and documentation

### 1.2 Creating New Development Directory

A new directory was created for GUI development:
```
/Users/redwolf/projects/objectmud/apu-gui/
```

APU architecture documentation was copied to the new directory:
- `APU-DESIGN.md` - Core APU design principles
- `APU-README.md` - APU usage documentation
- `WEB_TELNET_CLIENT.md` - Web client documentation

---

## Phase 2: Architecture Design

### 2.1 ARCHITECTURE.md Creation

A comprehensive architecture document was created defining:

**App Structure:**
```
apps/
└── appname/
    ├── manifest.json    # App metadata, menus, permissions
    ├── app.cjs          # App class implementation
    └── icon.txt         # ASCII art icon (optional)
```

**Manifest Format:**
```json
{
  "id": "unique-app-id",
  "name": "Display Name",
  "version": "1.0.0",
  "description": "What this app does",
  "author": "Author Name",
  "window": {
    "defaultWidth": 40,
    "defaultHeight": 20,
    "minWidth": 20,
    "minHeight": 10,
    "resizable": true,
    "closable": true
  },
  "menu": [
    {
      "label": "File",
      "items": ["New", "Open", "Save", "-", "Quit"]
    }
  ],
  "icon": {
    "char": "◆",
    "fg": 0,
    "bg": 7
  },
  "fileTypes": [".txt", ".doc"],
  "permissions": ["filesystem.read", "filesystem.write", "network.connect"]
}
```

**App API:**
```javascript
class MyApp {
  constructor(context) {
    this.window = context.window;   // Window management
    this.apu = context.apu;         // APU commands
    this.fs = context.fs;           // Virtual filesystem
    this.session = context.session; // Session info
  }

  // Lifecycle hooks
  onInit() {}           // Called after window created
  onFocus() {}          // Window gained focus
  onBlur() {}           // Window lost focus
  onResize(w, h) {}     // Window resized
  onClose() {}          // Return false to prevent close
  onDestroy() {}        // Final cleanup

  // Input handlers
  onKeyPress(key, modifiers) {}
  onMouseClick(x, y, button) {}
  onMouseDrag(x, y) {}

  // Drawing
  draw(isFocused) {}    // Render app content
}
```

**Virtual Filesystem Design:**
- Root `/` maps to virtual directory structure
- `/System/Applications` populated from app loader
- `/Documents`, `/Desktop`, etc. map to `data/vfs/users/{ip}/`
- Real files on disk, sandboxed per user by IP address

---

## Phase 3: App Extraction

Five applications were extracted from the monolithic `mac1984-finder.cjs` into independent modules.

### 3.1 Terminal App

**Location:** `apps/terminal/`

**Files Created:**

`manifest.json`:
```json
{
  "id": "terminal",
  "name": "Terminal",
  "version": "1.0.0",
  "description": "Telnet terminal client",
  "window": {
    "defaultWidth": 62,
    "defaultHeight": 22,
    "minWidth": 40,
    "minHeight": 10,
    "resizable": true
  },
  "menu": [
    {
      "label": "Connection",
      "items": ["Connect...", "Disconnect", "-", "Close"]
    },
    {
      "label": "Settings",
      "items": ["Font Size", "Colors", "-", "Fullscreen"]
    }
  ],
  "icon": {
    "char": ">",
    "fg": 2,
    "bg": 0
  },
  "permissions": ["network.connect"]
}
```

`icon.txt`:
```
>_
```

`app.cjs` - Full terminal implementation including:
- TCP socket connection via `net` module
- Telnet protocol negotiation (IAC sequences)
- VT100 escape sequence parsing
- Fullscreen mode toggle
- Scrollback buffer
- Window chrome with title bar showing connection status

**Key Features:**
- Connects to any telnet server
- Handles raw mode input
- Parses ANSI color codes
- Supports window resizing
- Fullscreen mode hides window chrome

### 3.2 MacWrite App

**Location:** `apps/macwrite/`

**Files Created:**

`manifest.json`:
```json
{
  "id": "macwrite",
  "name": "MacWrite",
  "version": "1.0.0",
  "description": "Simple text editor",
  "window": {
    "defaultWidth": 50,
    "defaultHeight": 18,
    "minWidth": 30,
    "minHeight": 10,
    "resizable": true
  },
  "menu": [
    {
      "label": "File",
      "items": ["New", "Open...", "Close", "-", "Save", "Save As..."]
    },
    {
      "label": "Edit",
      "items": ["Undo", "-", "Cut", "Copy", "Paste", "Clear", "-", "Select All"]
    }
  ],
  "icon": {
    "char": "W",
    "fg": 0,
    "bg": 7
  },
  "fileTypes": [".txt", ".doc"],
  "permissions": ["filesystem.read", "filesystem.write", "clipboard"]
}
```

`icon.txt`:
```
═══
───
───
```

`app.cjs` - Full text editor implementation including:
- Multi-line text editing with cursor navigation
- Text selection (shift+arrow keys)
- Cut, copy, paste operations
- Word wrapping with configurable width
- Scroll support for long documents
- Dirty flag tracking for unsaved changes

**Key Methods:**
- `buildWrappedContent()` - Wraps text to window width
- `deleteSelection()` - Removes selected text
- `copy()` / `cut()` / `paste()` - Clipboard operations
- `handleKey()` - Processes all keyboard input
- `draw()` - Renders editor with selection highlighting

### 3.3 MacPaint App

**Location:** `apps/macpaint/`

**Files Created:**

`manifest.json`:
```json
{
  "id": "macpaint",
  "name": "MacPaint",
  "version": "1.0.0",
  "description": "ASCII art drawing program",
  "window": {
    "defaultWidth": 60,
    "defaultHeight": 20,
    "minWidth": 40,
    "minHeight": 15,
    "resizable": true
  },
  "menu": [
    {
      "label": "File",
      "items": ["New", "Open...", "Close", "-", "Save", "Save As...", "-", "Export"]
    },
    {
      "label": "Edit",
      "items": ["Undo", "-", "Cut", "Copy", "Paste", "Clear"]
    },
    {
      "label": "Goodies",
      "items": ["Flip Horizontal", "Flip Vertical", "-", "Invert", "-", "Fill Pattern"]
    }
  ],
  "icon": {
    "char": "✎",
    "fg": 0,
    "bg": 7
  },
  "fileTypes": [".txt", ".asc", ".art"],
  "permissions": ["filesystem.read", "filesystem.write", "clipboard"]
}
```

`icon.txt`:
```
┌─╮
│▓│
╰─┘
```

`app.cjs` - Full drawing program including:
- 2D canvas with character and color per cell
- Tool palette (pencil, line, rectangle, fill, text, eraser)
- Pattern selector for fill operations
- Color picker (16 ANSI colors)
- Character picker from CP437 set
- Undo support (last 20 operations)

**Tools:**
1. **Pencil** - Freehand drawing
2. **Line** - Click-drag line drawing
3. **Rectangle** - Outlined or filled rectangles
4. **Fill** - Flood fill with pattern
5. **Text** - Type characters directly
6. **Eraser** - Clear cells to space

**Drawing Characters:**
```javascript
const CHARS = [
  ' ', '░', '▒', '▓', '█',
  '─', '│', '┌', '┐', '└', '┘', '├', '┤', '┬', '┴', '┼',
  '═', '║', '╔', '╗', '╚', '╝', '╠', '╣', '╦', '╩', '╬',
  '●', '○', '◆', '◇', '■', '□', '▲', '△', '▼', '▽',
  '★', '☆', '♠', '♣', '♥', '♦', '♪', '♫', '☺', '☻'
];
```

### 3.4 Calculator App

**Location:** `apps/calculator/`

**Files Created:**

`manifest.json`:
```json
{
  "id": "calculator",
  "name": "Calculator",
  "version": "1.0.0",
  "description": "Simple desk calculator",
  "window": {
    "defaultWidth": 18,
    "defaultHeight": 14,
    "minWidth": 18,
    "minHeight": 14,
    "resizable": false
  },
  "menu": [
    {
      "label": "Edit",
      "items": ["Copy", "Paste"]
    }
  ],
  "icon": {
    "char": "#",
    "fg": 0,
    "bg": 7
  },
  "permissions": ["clipboard"]
}
```

`icon.txt`:
```
┌─┐
│=│
└─┘
```

`app.cjs` - Calculator implementation including:
- Standard four-function calculator
- Display with current value and pending operation
- Mouse-clickable buttons
- Keyboard input support
- Memory functions (future)

**Button Layout:**
```
┌────────────────┐
│          0.00  │
├───┬───┬───┬───┤
│ C │ ± │ % │ ÷ │
├───┼───┼───┼───┤
│ 7 │ 8 │ 9 │ × │
├───┼───┼───┼───┤
│ 4 │ 5 │ 6 │ - │
├───┼───┼───┼───┤
│ 1 │ 2 │ 3 │ + │
├───┼───┴───┼───┤
│ 0 │   .   │ = │
└───┴───────┴───┘
```

**Key Methods:**
- `handleButtonClick(label)` - Process button presses
- `calculate()` - Perform pending operation
- `draw()` - Render calculator face

### 3.5 Puzzle App

**Location:** `apps/puzzle/`

**Files Created:**

`manifest.json`:
```json
{
  "id": "puzzle",
  "name": "Puzzle",
  "version": "1.0.0",
  "description": "15-tile sliding puzzle game",
  "window": {
    "defaultWidth": 22,
    "defaultHeight": 12,
    "minWidth": 22,
    "minHeight": 12,
    "resizable": false
  },
  "menu": [
    {
      "label": "Game",
      "items": ["New Game", "-", "Best Times"]
    }
  ],
  "icon": {
    "char": "▦",
    "fg": 0,
    "bg": 7
  },
  "permissions": []
}
```

`icon.txt`:
```
┌┬┐
├┼┤
└┴┘
```

`app.cjs` - Puzzle game implementation including:
- 4x4 grid of numbered tiles (1-15 plus empty)
- Click-to-slide mechanics
- Guaranteed solvable shuffle algorithm
- Move counter
- Win detection

**Shuffle Algorithm:**
The puzzle uses a "guaranteed solvable" approach by making random valid moves from the solved state rather than randomly placing tiles (which has a 50% chance of being unsolvable):

```javascript
createShuffledPuzzle() {
  // Start with solved state
  let tiles = [
    [1, 2, 3, 4],
    [5, 6, 7, 8],
    [9, 10, 11, 12],
    [13, 14, 15, 0]  // 0 = empty
  ];
  let emptyRow = 3, emptyCol = 3;

  // Make 100 random valid moves
  const directions = [[-1,0], [1,0], [0,-1], [0,1]];
  for (let i = 0; i < 100; i++) {
    const validMoves = directions.filter(([dr, dc]) => {
      const nr = emptyRow + dr;
      const nc = emptyCol + dc;
      return nr >= 0 && nr < 4 && nc >= 0 && nc < 4;
    });
    const [dr, dc] = validMoves[Math.floor(Math.random() * validMoves.length)];
    const nr = emptyRow + dr;
    const nc = emptyCol + dc;
    tiles[emptyRow][emptyCol] = tiles[nr][nc];
    tiles[nr][nc] = 0;
    emptyRow = nr;
    emptyCol = nc;
  }
  return { tiles, emptyRow, emptyCol };
}
```

---

## Phase 4: GUI Server Core

### 4.1 App Loader (`gui-server/app-loader.cjs`)

**Purpose:** Discovers and loads apps from the `apps/` directory at startup.

**Features:**
- Scans `apps/` directory for subdirectories
- Validates each app has `manifest.json` and `app.cjs`
- Parses manifest and loads app class
- Provides app lookup by ID
- Supports hot-reloading during development
- Returns app list for filesystem display

**Key Methods:**

```javascript
class AppLoader {
  constructor(appsDir) {
    this.appsDir = appsDir;
    this.apps = new Map();  // id -> { manifest, AppClass, iconPath, appDir }
  }

  discover() {
    // Scan apps directory, load all valid apps
    // Called at startup and can be called again to reload
  }

  getApp(id) {
    // Returns { manifest, AppClass, iconPath, appDir }
  }

  getManifest(id) {
    // Returns just the manifest object
  }

  getAppsForFilesystem() {
    // Returns array for display in Applications folder:
    // [{ name: "App Name", type: "app", appId: "id", icon: {...} }, ...]
  }

  createInstance(id, context) {
    // Creates new instance of app class with context
    return new app.AppClass(context);
  }

  getAppForFileType(extension) {
    // Returns app ID that handles this file type, or null
  }

  reloadApp(id) {
    // Clear require cache and reload single app
  }

  reloadAll() {
    // Re-discover all apps
  }
}
```

### 4.2 Virtual Filesystem (`gui-server/vfs.cjs`)

**Purpose:** Provides sandboxed filesystem for the GUI, backed by real files on disk.

**Directory Structure:**
```
data/
└── vfs/
    ├── .meta/           # Metadata storage
    ├── users/           # Per-user home directories
    │   ├── 192.168.1.1/ # User identified by IP
    │   │   ├── Documents/
    │   │   ├── Desktop/
    │   │   └── My Artwork/
    │   └── 10.0.0.5/
    └── system/          # System-wide files
        └── Applications/
```

**Path Resolution:**

| Virtual Path | Maps To |
|--------------|---------|
| `/` or `/Macintosh HD` | Virtual root (returns standard folders) |
| `/System/Applications` | App loader (dynamic, not on disk) |
| `/System/*` | `data/vfs/system/*` |
| `/Documents/*` | `data/vfs/users/{ip}/Documents/*` |
| `/Desktop/*` | `data/vfs/users/{ip}/Desktop/*` |
| `/*` | `data/vfs/users/{ip}/*` |

**Key Methods:**

```javascript
class VirtualFilesystem {
  constructor(dataDir, appLoader) {
    this.dataDir = dataDir;
    this.appLoader = appLoader;
    this.vfsRoot = path.join(dataDir, 'vfs');
    // ... initialize directories
  }

  resolvePath(userId, virtualPath) {
    // Returns { type: 'virtual'|'apps'|'real', path: '...' }
  }

  readDir(userId, virtualPath) {
    // Returns [{ name, type: 'folder'|'file'|'app' }, ...]
  }

  readFile(userId, virtualPath) {
    // Returns file contents as string
  }

  writeFile(userId, virtualPath, content) {
    // Writes file, creates parent directories as needed
  }

  mkdir(userId, virtualPath) {
    // Creates directory
  }

  delete(userId, virtualPath) {
    // Deletes file or directory (recursive)
  }

  rename(userId, fromPath, toPath) {
    // Moves/renames file or directory
  }

  copy(userId, fromPath, toPath) {
    // Copies file or directory
  }

  stat(userId, virtualPath) {
    // Returns { name, type, size, mtime }
  }

  exists(userId, virtualPath) {
    // Returns boolean
  }

  isDirectory(userId, virtualPath) {
    // Returns boolean
  }

  isFile(userId, virtualPath) {
    // Returns boolean
  }

  getRealPath(userId, virtualPath) {
    // Returns actual filesystem path (for advanced operations)
  }
}
```

### 4.3 Session Manager (`gui-server/session.cjs`)

**Purpose:** Manages per-client session state including windows, apps, and preferences.

**Session State Structure:**
```javascript
{
  id: 'session_192_168_1_1_12345',
  ip: '192.168.1.1',
  connectedAt: '2026-01-03T...',
  lastActivity: 1704307200000,

  // Window management
  windows: [],           // Array of window objects
  activeWindow: null,    // Currently focused window ID
  nextWindowId: 1,       // Counter for unique window IDs

  // Running apps
  apps: new Map(),       // windowId -> AppInstance

  // Desktop state
  clipboard: '',         // Copy/paste buffer
  menuBarApp: 'finder',  // Current app controlling menu bar

  // Preferences
  prefs: {
    desktopPattern: 0,
    cursorOffsetX: 0,
    cursorOffsetY: 0
  },

  // Drag state
  dragging: null,        // { type: 'window'|'icon', ... }

  // Selection state
  selectedIcons: []      // Selected desktop/window icons
}
```

**Key Methods:**

```javascript
class SessionManager {
  // Session lifecycle
  getSession(sessionId)     // Create or get session
  hasSession(sessionId)     // Check existence
  removeSession(sessionId)  // Clean up session
  touch(sessionId)          // Update last activity

  // Window management
  createWindow(sessionId, options)   // Create new window
  getWindow(sessionId, windowId)     // Get window by ID
  removeWindow(sessionId, windowId)  // Close window
  bringToFront(sessionId, windowId)  // Focus window
  getWindowAt(sessionId, x, y)       // Find window at coordinates
  getActiveWindow(sessionId)         // Get focused window

  // App management
  registerApp(sessionId, windowId, appInstance)
  getApp(sessionId, windowId)
  getActiveApp(sessionId)

  // Clipboard
  setClipboard(sessionId, content)
  getClipboard(sessionId)

  // Stats
  getSessionCount()
  getSessionInfo(sessionId)
  getAllSessionsInfo()
}
```

### 4.4 Desktop Environment (`gui-server/desktop.cjs`)

**Purpose:** Manages desktop rendering, menu bar, window chrome, file manager, and app launching.

**Components:**

1. **Desktop Background** - Configurable pattern fill
2. **Menu Bar** - Dynamic menus based on active app
3. **Window Chrome** - Mac-style title bar, close button, resize handle
4. **Finder Windows** - File/folder icon view
5. **App Windows** - Delegates drawing to app instances

**Key Methods:**

```javascript
class Desktop {
  constructor(sessionManager, appLoader, vfs, apuConnection) {
    // Store references to all subsystems
  }

  // Initialization
  initSession(sessionId)    // Set up display for new session
  redrawSession(sessionId)  // Full screen redraw

  // Drawing
  drawDesktopBackground(sessionId)
  drawMenuBar(sessionId)
  drawWindowChrome(sessionId, windowId, x, y, w, h, title, options)
  drawWindow(sessionId, win, isFocused)
  drawFinderWindow(sessionId, win, isFocused)
  drawIcon(sessionId, windowId, x, y, file, isSelected)

  // Menu system
  getMenusForApp(appId)  // Returns menu structure for app

  // Finder
  createFinderWindow(sessionId, title, virtualPath)

  // App launching
  launchApp(sessionId, appId, options)
  createAppContext(sessionId, win, appId)  // Build context object for app

  // Window operations
  closeWindow(sessionId, windowId)
  focusWindow(sessionId, windowId)

  // Input handling
  handleInput(sessionId, event)
  handleKeyPress(sessionId, event)
  handleMouse(sessionId, event)
}
```

**App Context Object:**

When an app is launched, it receives a context object:

```javascript
{
  window: {
    id: 'win_1',
    title: 'App Name',
    x: 10, y: 5,
    width: 40, height: 20,
    setTitle(title),
    close()
  },

  apu: {
    send(cmd)  // Send APU command to this window
  },

  fs: {
    readFile(path),
    writeFile(path, content),
    readDir(path),
    exists(path),
    mkdir(path),
    delete(path)
  },

  session: {
    id: 'session_...',
    ip: '192.168.1.1',
    clipboard  // Get/set clipboard content
  },

  drawWindowChrome(id, x, y, w, h, title, opts),
  launchApp(appId, opts)
}
```

### 4.5 Main Server (`gui-server/server.cjs`)

**Purpose:** Entry point that connects to APU and orchestrates all components.

**Startup Sequence:**

1. Load configuration from environment variables
2. Create data directories if needed
3. Initialize AppLoader and discover apps
4. Initialize SessionManager
5. Initialize VirtualFilesystem
6. Connect to APU server
7. Create Desktop environment
8. Begin handling events

**APU Communication:**

The server connects to APU via TCP socket and exchanges JSON messages:

**Incoming from APU:**
```javascript
{ type: 'client_connect', session: 'session_...' }
{ type: 'client_disconnect', session: 'session_...' }
{ type: 'input', session: '...', key: 'a', ctrl: false, alt: false, shift: false }
{ type: 'input', session: '...', mouse_x: 10, mouse_y: 5, button: 'left', event: 'press' }
{ type: 'window_event', session: '...', window: 'win_1', event: 'close' }
{ type: 'window_event', session: '...', window: 'win_1', event: 'resize', width: 50, height: 25 }
```

**Outgoing to APU:**
```javascript
{ session: '...', cmd: 'init', cols: 80, rows: 24 }
{ session: '...', cmd: 'enable_mouse', mode: 'any' }
{ session: '...', cmd: 'fill', x: 0, y: 0, width: 80, height: 24, char: '░', fg: 8, bg: 7 }
{ session: '...', cmd: 'print', x: 10, y: 5, text: 'Hello', fg: 0, bg: 7 }
{ session: '...', cmd: 'create_window', id: 'win_1', x: 5, y: 3, width: 40, height: 20, ... }
{ session: '...', cmd: 'flush' }
```

**Logging:**

Clean, structured logging format:
```
[HH:MM:SS] [LEVEL] [CATEGORY] message key=value key=value
```

Examples:
```
[14:23:45] [INFO] [SERVER] GUI Server starting...
[14:23:45] [INFO] [APU] Connected to APU server
[14:23:50] [INFO] [CLIENT] Connected session=session_192_168_1_1_12345 ip=192.168.1.1
[14:23:51] [DEBUG] [INPUT] Key: Enter session=_1_12345 app=finder
[14:24:30] [INFO] [CLIENT] Disconnected session=session_192_168_1_1_12345 ip=192.168.1.1
```

**Signal Handling:**

Graceful shutdown on SIGINT/SIGTERM:
- Clean up all session app instances
- Close APU connection
- Exit cleanly

---

## Phase 5: Project Configuration

### 5.1 Package.json

```json
{
  "name": "apu-gui",
  "version": "1.0.0",
  "description": "APU-based graphical user interface with JavaScript applets",
  "main": "gui-server/server.cjs",
  "scripts": {
    "start": "node gui-server/server.cjs",
    "dev": "APU_HOST=localhost APU_PORT=6121 node gui-server/server.cjs"
  },
  "keywords": ["apu", "gui", "terminal", "ascii"],
  "license": "MIT"
}
```

### 5.2 Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `APU_HOST` | `localhost` | APU server hostname |
| `APU_PORT` | `6121` | APU server port |
| `DATA_DIR` | `../data` | Data storage directory |
| `APPS_DIR` | `../apps` | Apps directory |

---

## Final Directory Structure

```
apu-gui/
├── package.json
├── ARCHITECTURE.md
├── creation_of_GUI.md          # This document
│
├── apps/
│   ├── terminal/
│   │   ├── manifest.json
│   │   ├── app.cjs
│   │   └── icon.txt
│   │
│   ├── macwrite/
│   │   ├── manifest.json
│   │   ├── app.cjs
│   │   └── icon.txt
│   │
│   ├── macpaint/
│   │   ├── manifest.json
│   │   ├── app.cjs
│   │   └── icon.txt
│   │
│   ├── calculator/
│   │   ├── manifest.json
│   │   ├── app.cjs
│   │   └── icon.txt
│   │
│   └── puzzle/
│       ├── manifest.json
│       ├── app.cjs
│       └── icon.txt
│
├── gui-server/
│   ├── server.cjs              # Main entry point
│   ├── desktop.cjs             # Desktop environment
│   ├── session.cjs             # Session management
│   ├── vfs.cjs                 # Virtual filesystem
│   └── app-loader.cjs          # App discovery
│
├── data/                        # Created at runtime
│   └── vfs/
│       ├── .meta/
│       ├── users/
│       │   └── {ip}/
│       │       ├── Documents/
│       │       ├── Desktop/
│       │       └── My Artwork/
│       └── system/
│           └── Applications/
│
└── demos/                       # Original demos (preserved)
    ├── mac1984-finder.cjs
    ├── mac1984-stable.cjs
    └── win31.cjs
```

---

## Usage

### Starting the Server

```bash
# Default configuration (connects to localhost:6121)
npm start

# Or with custom APU server
APU_HOST=192.168.1.100 APU_PORT=6121 npm start
```

### Adding New Apps

1. Create directory `apps/myapp/`
2. Create `manifest.json` with app metadata
3. Create `app.cjs` exporting app class
4. Optionally add `icon.txt` for Applications folder
5. Restart server (or call `appLoader.reloadAll()`)

### App Development

Apps receive a `context` object with:
- `window` - Window management (title, size, close)
- `apu` - Send APU commands
- `fs` - Virtual filesystem operations
- `session` - Session info and clipboard

Implement lifecycle hooks:
- `onInit()` - Setup when window opens
- `onFocus()` / `onBlur()` - Focus changes
- `onResize(w, h)` - Window resized
- `onClose()` - Return false to prevent close
- `onDestroy()` - Final cleanup

Implement input handlers:
- `onKeyPress(key, modifiers)` - Keyboard input
- `onMouseClick(x, y, button, event)` - Mouse clicks

Implement drawing:
- `draw(isFocused)` - Called when window needs redraw

---

## Key Design Decisions

### 1. CommonJS Modules (.cjs)

Used `.cjs` extension for explicit CommonJS compatibility, allowing:
- Dynamic `require()` for app loading
- Clearing require cache for hot reload
- Compatibility with existing APU demos

### 2. IP-Based User Identification

Users identified by IP address because:
- No login required for casual use
- Files persist across sessions from same IP
- Simple sandboxing without auth complexity
- Future: Add optional login for roaming profiles

### 3. Virtual Filesystem Backed by Real Files

Chose real file storage over in-memory because:
- Data persists across server restarts
- Can be backed up with standard tools
- Users can access files via SFTP if needed
- No serialization/deserialization complexity

### 4. App Manifest + Class Pattern

Separated metadata (manifest.json) from code (app.cjs) because:
- Manifests can be parsed without loading code
- Easier to validate app requirements
- Menu definitions in data, not code
- Future: Remote app installation

### 5. Context Object Injection

Apps receive capabilities through context rather than global imports because:
- Apps can't access arbitrary system resources
- Easy to mock for testing
- Clear API boundary
- Future: Permission-based capability filtering

---

## Future Enhancements

### Planned Features

1. **File Dialogs** - Open/Save dialogs for apps
2. **Menu Bar Interaction** - Click menus to open dropdowns
3. **Window Dragging** - Click-drag title bar
4. **Icon Dragging** - Rearrange desktop icons
5. **Trash Can** - Delete to trash, empty trash
6. **Control Panel** - System preferences app
7. **About Box** - Apple menu "About" item
8. **Desk Accessories** - Small utility apps
9. **Sound** - Terminal bell, alert sounds
10. **Multiple Desktops** - Virtual desktop switching

### App Ideas

1. **Calendar** - Date picker and events
2. **Clock** - Analog clock display
3. **Notepad** - Simpler than MacWrite
4. **Address Book** - Contact management
5. **File Viewer** - Read-only file display
6. **Image Viewer** - View ASCII art files
7. **Games** - Minesweeper, Solitaire, Snake
8. **System Monitor** - Show connected users, uptime
9. **IRC Client** - Multi-channel chat
10. **MUD Client** - Specialized for MUD games

---

## Conclusion

The APU GUI framework transforms a single-file demo into a modular, extensible desktop environment. Apps are self-contained units that can be developed independently, loaded dynamically, and run in sandboxed sessions. The virtual filesystem provides persistent storage while maintaining security through per-user isolation.

The architecture prioritizes:
- **Modularity** - Apps as independent units
- **Extensibility** - Easy to add new apps
- **Security** - Sandboxed filesystem and sessions
- **Persistence** - Real file storage
- **Simplicity** - Clean APIs and minimal dependencies

This foundation enables future development of additional apps, enhanced desktop features, and potentially multi-user collaboration features.
