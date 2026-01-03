# APU GUI - Architecture Design

## Overview

APU GUI is a graphical operating system that runs over telnet/terminal connections, powered by the APU (ASCII Processing Unit) display engine. It runs JavaScript applets in a windowed environment, providing a complete desktop experience over text-based connections.

## Core Components

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CLIENT (Telnet/Web)                          │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    APU SERVER (Rust)                                 │
│  - Window management, rendering, mouse/keyboard input               │
│  - Protocol: JSON commands in, ANSI output                          │
│  - Remains general-purpose, knows nothing about apps                 │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    GUI SERVER (Node.js)                              │
│  - Desktop environment, app launcher, file manager                   │
│  - Loads and manages app lifecycle                                   │
│  - Virtual filesystem layer                                          │
│  - Session management (per-user state)                               │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
              ┌──────────┐   ┌──────────┐   ┌──────────┐
              │ Terminal │   │ MacWrite │   │ MacPaint │  ... more apps
              │   .cjs   │   │   .cjs   │   │   .cjs   │
              └──────────┘   └──────────┘   └──────────┘
```

## App System

### App Structure

Each app is a CommonJS module in the `apps/` directory:

```
apps/
├── terminal/
│   ├── app.cjs          # Main app code
│   ├── manifest.json    # App metadata
│   └── icon.txt         # ASCII art icon (3x3 or custom)
├── macwrite/
│   ├── app.cjs
│   ├── manifest.json
│   └── icon.txt
├── macpaint/
│   ├── app.cjs
│   ├── manifest.json
│   └── icon.txt
└── calculator/
    ├── app.cjs
    ├── manifest.json
    └── icon.txt
```

### App Manifest (manifest.json)

```json
{
  "name": "Terminal",
  "id": "terminal",
  "version": "1.0.0",
  "author": "System",
  "description": "Command-line terminal emulator",
  "icon": {
    "char": ">_",
    "fg": 2,
    "bg": 0
  },
  "window": {
    "defaultWidth": 60,
    "defaultHeight": 20,
    "minWidth": 20,
    "minHeight": 5,
    "resizable": true,
    "closable": true
  },
  "menu": [
    {
      "label": "File",
      "items": [
        { "label": "New Window", "action": "newWindow" },
        { "label": "Close", "action": "close", "shortcut": "Cmd+W" }
      ]
    },
    {
      "label": "Edit",
      "items": [
        { "label": "Copy", "action": "copy", "shortcut": "Cmd+C" },
        { "label": "Paste", "action": "paste", "shortcut": "Cmd+V" },
        { "label": "Clear", "action": "clear" }
      ]
    }
  ],
  "fileTypes": [],
  "permissions": ["filesystem.read", "filesystem.write", "shell.execute"]
}
```

### App API

Each app exports a class or factory that implements the App interface:

```javascript
// apps/terminal/app.cjs
class TerminalApp {
  constructor(context) {
    // context provides:
    // - window: Window API (draw, resize, close)
    // - fs: Virtual filesystem API
    // - session: User session info
    // - apu: Direct APU commands (for advanced apps)
    // - events: Event emitter for app communication
  }

  // Lifecycle
  onInit() {}           // Called when app starts
  onFocus() {}          // Window gained focus
  onBlur() {}           // Window lost focus
  onResize(w, h) {}     // Window resized
  onClose() {}          // Window closing (can cancel)
  onDestroy() {}        // App being terminated

  // Input
  onKeyPress(key, modifiers) {}
  onMouseClick(x, y, button) {}
  onMouseMove(x, y) {}
  onMouseDrag(x, y, button) {}

  // Menu actions
  onMenuAction(action) {}

  // File handling (if registered for file types)
  onOpenFile(path, content) {}

  // Drawing
  draw() {}             // Called to render content
}

module.exports = TerminalApp;
```

### Window API (provided to apps)

```javascript
window = {
  id: 'win_123',
  title: 'Terminal',
  x: 10, y: 5,
  width: 60, height: 20,

  // Drawing
  print(x, y, text, fg, bg) {},
  fill(x, y, w, h, char, fg, bg) {},
  clear() {},
  flush() {},

  // Window control
  setTitle(title) {},
  resize(w, h) {},
  move(x, y) {},
  bringToFront() {},
  close() {},

  // Cursor
  showCursor(x, y) {},
  hideCursor() {},

  // Scrolling
  scroll(lines) {},
  setScrollRegion(top, bottom) {},
}
```

## Virtual Filesystem

### Design Goals

1. **Safety**: Sandbox by default, no access to host filesystem
2. **Persistence**: User data survives restarts
3. **Transparency**: Feels like a real filesystem to apps
4. **Future-proof**: Can be extended to access real files for admin use

### Implementation Strategy

Store virtual files as real files in a hidden structure:

```
data/
├── vfs/                          # Virtual filesystem root
│   ├── .meta/                    # Metadata (hidden from VFS)
│   │   ├── index.json            # File index, permissions, etc.
│   │   └── trash/                # Deleted files (recoverable)
│   ├── system/                   # System files (read-only to users)
│   │   └── Applications/         # Symlinks to installed apps
│   └── users/
│       └── {ip_or_user}/         # Per-user home directories
│           ├── Desktop/
│           ├── Documents/
│           ├── My Artwork/
│           └── .config/          # App preferences
└── apps/                         # Real app installations
```

### VFS API

```javascript
const vfs = {
  // Path operations (all paths are virtual)
  resolve(path) {},              // Resolve relative paths
  exists(path) {},
  isFile(path) {},
  isDirectory(path) {},

  // Reading
  readFile(path) {},             // Returns string content
  readDir(path) {},              // Returns array of entries
  stat(path) {},                 // Returns { name, type, size, mtime, ... }

  // Writing
  writeFile(path, content) {},
  mkdir(path) {},

  // Modification
  rename(from, to) {},
  copy(from, to) {},
  delete(path) {},               // Moves to trash

  // Special
  getAppPath(appId) {},          // Get app's installation directory
  getUserHome() {},              // Get current user's home directory

  // Permissions (future)
  canRead(path) {},
  canWrite(path) {},
  setPermissions(path, perms) {},
};
```

### Real Filesystem Access (Future)

For admin mode, mount real paths into VFS:

```javascript
// Admin configuration
vfs.mount('/real/home', '/mnt/home', { readOnly: false });
vfs.mount('/var/log', '/mnt/logs', { readOnly: true });
```

This keeps the same VFS API but allows controlled access to real files.

## Session Management

Each connected client gets an isolated session:

```javascript
const session = {
  id: 'session_192_168_1_1_12345',
  ip: '192.168.1.1',
  user: null,                    // null = guest, or username if logged in

  // Desktop state
  windows: [],                   // Open windows
  activeWindow: null,            // Focused window
  clipboard: '',                 // Copy/paste buffer

  // Preferences
  prefs: {
    theme: 'classic',
    mouseSpeed: 1.0,
    // ...
  },

  // Running apps
  apps: Map<windowId, AppInstance>,
};
```

## GUI Server Structure

```
gui-server/
├── server.cjs              # Main entry point
├── desktop.cjs             # Desktop environment (icons, menus, wallpaper)
├── window-manager.cjs      # Window lifecycle, focus, z-order
├── app-loader.cjs          # Discovers and loads apps from apps/
├── vfs.cjs                 # Virtual filesystem implementation
├── session.cjs             # Session management
├── menu-bar.cjs            # Top menu bar rendering
├── file-manager.cjs        # Finder-like file browser (built-in app)
└── utils/
    ├── drawing.cjs         # Common drawing utilities
    ├── dialog.cjs          # Alert, confirm, file picker dialogs
    └── icons.cjs           # Icon rendering
```

## App Discovery & Loading

On startup, the GUI server:

1. Scans `apps/` directory for subdirectories
2. Reads each `manifest.json`
3. Validates required fields
4. Registers app in the system
5. Creates entry in `/System/Applications/` VFS

```javascript
// app-loader.cjs
function discoverApps(appsDir) {
  const apps = new Map();

  for (const dir of fs.readdirSync(appsDir)) {
    const manifestPath = path.join(appsDir, dir, 'manifest.json');
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath));
      const AppClass = require(path.join(appsDir, dir, 'app.cjs'));

      apps.set(manifest.id, {
        manifest,
        AppClass,
        iconPath: path.join(appsDir, dir, 'icon.txt'),
      });
    }
  }

  return apps;
}
```

## Pipe Interface (External Apps)

For running external processes (emulators, etc.) that output to APU:

```javascript
// App can spawn external process and pipe output to a window
const proc = spawn('vice', ['game.d64']);

// Pipe stdout to terminal window (raw mode)
proc.stdout.on('data', (data) => {
  window.writeRaw(data);  // Direct ANSI passthrough
});

// Send input from window to process
window.onInput((data) => {
  proc.stdin.write(data);
});
```

## Migration Path from Mac 1984 Demo

1. **Extract apps**: Pull Terminal, MacWrite, MacPaint, Calculator out of finder
2. **Create manifests**: Define metadata for each extracted app
3. **Refactor finder**: Becomes the desktop environment + file manager app
4. **Implement VFS**: Migrate from current per-IP JSON storage
5. **Test**: Ensure all existing functionality works
6. **Extend**: Add new apps, real filesystem access, etc.

## Security Considerations

1. **App sandboxing**: Apps cannot access host filesystem without explicit mount
2. **Permission system**: Apps declare required permissions in manifest
3. **Rate limiting**: Prevent apps from flooding APU with commands
4. **Resource limits**: Max windows, max file size, etc.
5. **Input validation**: Sanitize all paths, prevent directory traversal

## Future Enhancements

- **App Store**: Download apps from remote repository
- **Multi-user**: Login system, user accounts, permissions
- **Networking**: Apps can make HTTP requests, connect to services
- **Scripting**: Built-in scripting language for automation
- **Themes**: Customizable colors, fonts, window decorations
- **Plugins**: Extend GUI server itself (new window decorations, etc.)
