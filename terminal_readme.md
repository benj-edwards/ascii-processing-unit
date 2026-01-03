# APU Terminal Emulator

The APU Terminal Emulator provides built-in support for connecting to remote telnet servers with full ANSI color and escape sequence parsing. This allows APU-based applications to embed terminal windows that can connect to BBSes, MUDs, or any telnet-accessible service.

## How It Works

The terminal emulator is built directly into APU. The game doesn't need to do any terminal emulation - APU handles everything internally:

```
┌──────────────┐                    ┌─────────────────────────────────┐
│     Game     │  JSON commands     │              APU                │
│  (Node.js)   │ ─────────────────► │                                 │
│              │                    │  ┌─────────────────────────────┐│
│              │                    │  │ Terminal Window             ││
│              │                    │  │  ┌───────────────────────┐  ││
│              │                    │  │  │ ANSI Terminal Emulator│  ││
│              │                    │  │  │ (parses escape codes) │  ││
│              │                    │  │  └───────────┬───────────┘  ││
│              │                    │  └──────────────┼──────────────┘│
│              │                    │                 │ TCP           │
│              │ ◄───────────────── │                 ▼               │
│              │  events            │          ┌────────────┐         │
└──────────────┘  (connected,       │          │ Remote BBS │         │
                   disconnected)    │          │ or Server  │         │
                                    └──────────┴────────────┴─────────┘
```

**From the game's perspective, you just:**

1. Send `create_terminal` command with host/port
2. Receive `terminal_connected` or `terminal_error` event
3. APU automatically:
   - Connects to the remote server
   - Parses all ANSI escape sequences
   - Renders colored output to the window
   - Routes keyboard input when window is focused
4. Optionally send `close_terminal` when done

## Features

- **Full ANSI/VT100 escape sequence parsing**
- **16-color and 256-color support**
- **Cursor positioning and movement**
- **Screen clearing and scrolling**
- **Text attributes** (bold, dim, italic, underline, blink, reverse)
- **Automatic input routing** to focused terminal windows
- **Multiple terminal types** (ANSI, VT100, XTerm, Raw)

## Protocol Commands

### CreateTerminal

Creates a terminal window and connects to a remote server.

```json
{
  "cmd": "create_terminal",
  "session": "session_123",
  "id": "my_terminal",
  "host": "bbs.example.com",
  "port": 23,
  "x": 5,
  "y": 2,
  "width": 80,
  "height": 25,
  "terminal_type": "ansi",
  "title": "My BBS Connection",
  "closable": true,
  "resizable": true
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `id` | string | yes | - | Unique window/terminal ID |
| `host` | string | yes | - | Remote hostname or IP |
| `port` | number | yes | - | Remote port (typically 23 for telnet) |
| `x` | number | yes | - | Window X position |
| `y` | number | yes | - | Window Y position (minimum 1, protects menu bar) |
| `width` | number | yes | - | Window width (includes border) |
| `height` | number | yes | - | Window height (includes border) |
| `terminal_type` | string | no | "ansi" | Terminal emulation type |
| `title` | string | no | "host:port" | Window title |
| `closable` | boolean | no | true | Show close button |
| `resizable` | boolean | no | true | Allow window resizing |

**Terminal Types:**
- `ansi` - Full ANSI color support (16 colors, default)
- `vt100` - VT100 compatible (limited features)
- `xterm` - XTerm extended (256 colors)
- `raw` - No parsing, display raw characters

### CloseTerminal

Closes a terminal connection and removes the window.

```json
{
  "cmd": "close_terminal",
  "session": "session_123",
  "id": "my_terminal"
}
```

### TerminalInput

Sends input data to a terminal (optional - keyboard input is automatically routed to focused terminals).

```json
{
  "cmd": "terminal_input",
  "session": "session_123",
  "id": "my_terminal",
  "data": "hello\r"
}
```

### TerminalConfig

Configure terminal emulation settings.

```json
{
  "cmd": "terminal_config",
  "session": "session_123",
  "id": "my_terminal",
  "local_echo": true,
  "line_ending": "crlf"
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `id` | string | yes | - | Terminal window ID |
| `local_echo` | boolean | no | false | Echo typed characters locally |
| `line_ending` | string | no | "cr" | Line ending on Enter: "cr" or "crlf" |

**Local Echo**: When enabled, characters are echoed to the terminal display as you type. Useful for servers that don't echo input (like MUSHes).

**Line Ending**: Some servers require CR+LF (`\r\n`) instead of just CR (`\r`) for Enter to work properly.

### ResizeTerminal

Resize a terminal window without disconnecting. Updates window dimensions and sends NAWS (Negotiate About Window Size) to the remote server.

```json
{
  "cmd": "resize_terminal",
  "session": "session_123",
  "id": "my_terminal",
  "x": 5,
  "y": 2,
  "width": 80,
  "height": 24,
  "border": "single",
  "title": "BBS",
  "closable": true,
  "resizable": true,
  "draggable": true
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `id` | string | yes | - | Terminal window ID |
| `x` | number | yes | - | New window X position |
| `y` | number | yes | - | New window Y position (min 1) |
| `width` | number | yes | - | New window width |
| `height` | number | yes | - | New window height |
| `border` | string | no | "single" | Border style: "none", "single", "double" |
| `title` | string | no | null | Window title |
| `closable` | boolean | no | true | Show close button |
| `resizable` | boolean | no | true | Allow resizing |
| `draggable` | boolean | no | true | Allow dragging |

This command is useful for implementing fullscreen mode or responding to window resize events without losing the connection to the remote server.

## Response Events

### TerminalConnected

Sent when a terminal successfully connects to the remote server.

```json
{
  "type": "terminal_connected",
  "id": "my_terminal",
  "host": "bbs.example.com",
  "port": 23
}
```

### TerminalDisconnected

Sent when a terminal connection is closed or lost.

```json
{
  "type": "terminal_disconnected",
  "id": "my_terminal",
  "reason": "Connection closed"
}
```

### TerminalError

Sent when a terminal connection fails.

```json
{
  "type": "terminal_error",
  "id": "my_terminal",
  "error": "Connection failed: Connection refused"
}
```

## Automatic Input Routing

When a terminal window is focused (clicked on), keyboard input is automatically routed to that terminal instead of being forwarded to the game. This includes:

- **Printable characters** - Sent as-is (UTF-8)
- **Arrow keys** - Converted to ANSI escape sequences
- **Function keys** (F1-F12) - Converted to escape sequences
- **Special keys** - Enter, Tab, Backspace, Escape, etc.

To stop routing input to the terminal, the user can click on a non-terminal window or the background.

## Supported ANSI Sequences

### Cursor Movement
| Sequence | Description |
|----------|-------------|
| `ESC[nA` | Cursor up n lines |
| `ESC[nB` | Cursor down n lines |
| `ESC[nC` | Cursor forward n columns |
| `ESC[nD` | Cursor back n columns |
| `ESC[nE` | Cursor to beginning of line n lines down |
| `ESC[nF` | Cursor to beginning of line n lines up |
| `ESC[nG` | Cursor to column n |
| `ESC[r;cH` | Cursor to row r, column c |
| `ESC[r;cf` | Cursor to row r, column c |
| `ESC 7` | Save cursor position |
| `ESC 8` | Restore cursor position |
| `ESC[s` | Save cursor position (alternative) |
| `ESC[u` | Restore cursor position (alternative) |

### Erase Functions
| Sequence | Description |
|----------|-------------|
| `ESC[0J` | Erase from cursor to end of screen |
| `ESC[1J` | Erase from start of screen to cursor |
| `ESC[2J` | Erase entire screen |
| `ESC[0K` | Erase from cursor to end of line |
| `ESC[1K` | Erase from start of line to cursor |
| `ESC[2K` | Erase entire line |

### Scrolling
| Sequence | Description |
|----------|-------------|
| `ESC[nS` | Scroll up n lines |
| `ESC[nT` | Scroll down n lines |
| `ESC D` | Index (move down, scroll if at bottom) |
| `ESC M` | Reverse index (move up, scroll if at top) |

### Colors and Attributes (SGR)

Format: `ESC[n;n;...m`

**Attributes:**
| Code | Description |
|------|-------------|
| 0 | Reset all attributes |
| 1 | Bold |
| 2 | Dim |
| 3 | Italic |
| 4 | Underline |
| 5 | Blink |
| 7 | Reverse video |
| 21 | Bold off |
| 22 | Normal intensity |
| 23 | Italic off |
| 24 | Underline off |
| 25 | Blink off |
| 27 | Reverse off |

**Foreground Colors:**
| Code | Color |
|------|-------|
| 30 | Black |
| 31 | Red |
| 32 | Green |
| 33 | Yellow |
| 34 | Blue |
| 35 | Magenta |
| 36 | Cyan |
| 37 | White |
| 38;5;n | 256-color (n = 0-255) |
| 39 | Default |
| 90-97 | Bright colors |

**Background Colors:**
| Code | Color |
|------|-------|
| 40 | Black |
| 41 | Red |
| 42 | Green |
| 43 | Yellow |
| 44 | Blue |
| 45 | Magenta |
| 46 | Cyan |
| 47 | White |
| 48;5;n | 256-color (n = 0-255) |
| 49 | Default |
| 100-107 | Bright colors |

## Example: BBS Terminal App

Here's how a game might implement a Terminal app in a Mac-style finder:

```javascript
// When user opens Terminal app
function openTerminal(sessionId) {
  sendToAPU({
    cmd: 'create_terminal',
    session: sessionId,
    id: 'terminal_' + Date.now(),
    host: 'cavebbs.homeip.net',
    port: 23,
    x: 10,
    y: 3,
    width: 80,
    height: 24,
    terminal_type: 'ansi',
    title: 'Cave BBS'
  });
}

// Handle terminal events
function handleAPUEvent(event) {
  switch (event.type) {
    case 'terminal_connected':
      console.log(`Connected to ${event.host}:${event.port}`);
      break;
    case 'terminal_disconnected':
      console.log(`Disconnected: ${event.reason}`);
      // Optionally remove the window or show a message
      break;
    case 'terminal_error':
      console.log(`Connection error: ${event.error}`);
      // Show error dialog to user
      break;
    case 'window_close_requested':
      // User clicked close button
      if (event.id.startsWith('terminal_')) {
        sendToAPU({
          cmd: 'close_terminal',
          session: sessionId,
          id: event.id
        });
      }
      break;
  }
}
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        APU Server                           │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐     │
│  │   Session   │    │   Session   │    │   Session   │     │
│  │             │    │             │    │             │     │
│  │ ┌─────────┐ │    │ ┌─────────┐ │    │             │     │
│  │ │Terminal │ │    │ │Terminal │ │    │  (no term)  │     │
│  │ │ Window  │ │    │ │ Window  │ │    │             │     │
│  │ └────┬────┘ │    │ └────┬────┘ │    │             │     │
│  └──────┼──────┘    └──────┼──────┘    └─────────────┘     │
│         │                  │                                │
│         ▼                  ▼                                │
│  ┌─────────────┐    ┌─────────────┐                        │
│  │ TCP Client  │    │ TCP Client  │                        │
│  │ Connection  │    │ Connection  │                        │
│  └──────┬──────┘    └──────┬──────┘                        │
└─────────┼──────────────────┼────────────────────────────────┘
          │                  │
          ▼                  ▼
    ┌───────────┐      ┌───────────┐
    │  Remote   │      │  Remote   │
    │  Server   │      │  Server   │
    │ (BBS/MUD) │      │ (BBS/MUD) │
    └───────────┘      └───────────┘
```

## Data Flow

1. **Incoming data** from remote server:
   - TCP client reads data
   - Data passed to Terminal emulator
   - Terminal parses ANSI sequences, updates screen buffer
   - On Flush command, terminal screen copied to APU window
   - Window rendered to connected clients

2. **Outgoing input** from user:
   - User types in terminal window
   - APU detects focused window is a terminal
   - Input converted to bytes (with escape sequences for special keys)
   - Bytes sent to TCP client
   - TCP client writes to remote server

## Notes

- Terminal windows respect the menu bar protection (Y minimum is 1)
- The connection happens asynchronously - the window appears immediately, connection happens in background
- If connection fails, a `terminal_error` event is sent but the window remains (game can decide to close it)
- The terminal emulator supports scrollback (1000 lines by default) but scrollback viewing is not yet implemented

## Architecture: Why Terminals Need Auto-Flush

**Key Insight: Terminals are asynchronous data sources.**

Unlike normal APU windows where the game sends commands and controls when to flush, terminal data arrives independently from a remote server. The game has no way to know when data arrives.

### The Problem

```
Normal APU flow (synchronous):
  Game sends commands → APU updates buffers → Game sends Flush → Client sees update

Terminal flow (asynchronous):
  BBS sends data → Terminal buffer updated → ??? → Nothing triggers render!
```

Without intervention, terminal content sits in the buffer but never reaches the client until something else (like a mouse click) happens to trigger a redraw.

### The Solution

APU implements a **30ms auto-flush timer** for sessions with active terminals:

```rust
// In client connection handler
let mut flush_interval = tokio::time::interval(Duration::from_millis(30));

loop {
    tokio::select! {
        _ = flush_interval.tick() => {
            if !session.terminals.is_empty() {
                session.sync_terminals_to_windows().await;
                session.windows.composite();
                let output = session.renderer.render(&session.windows.display, false);
                session.output_tx.send(output).await;
            }
        }
        // ... other select branches
    }
}
```

This gives ~33fps rendering for terminal content without requiring any game involvement.

### Design Principles

1. **Terminals are fire-and-forget** - Game creates terminal, APU handles everything
2. **No polling needed** - APU automatically renders terminal updates
3. **Input routing is automatic** - When terminal window is focused, keystrokes go to remote
4. **Game only handles events** - connected, disconnected, error notifications
