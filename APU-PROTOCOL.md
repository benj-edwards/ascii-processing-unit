# APU - ASCII Processing Unit Protocol

## Overview

APU is a **universal character-cell display engine** for building text-based games, MUSHes, terminal UIs, and windowed ASCII applications. Games connect to APU via TCP and send JSON commands; APU renders to connected telnet clients and forwards input events back to games.

### Design Philosophy

APU is designed to support **every type of text display and game**:

- **IRC/Chat clients** - Scrolling text, line-based input
- **MUSHes/MUDs** - Room descriptions, exits, player lists
- **BBS games** - ANSI art, menus, door games
- **ZZT-style games** - Tile-based, real-time action
- **Roguelikes** - ASCII dungeons, inventory screens
- **Text adventures** - Zork-style parser games
- **Windowed UIs** - Mac/Windows-style desktop with overlapping windows

The windowing system is an **optional layer** on top of the core display buffer. Non-windowed apps work exactly like a traditional terminal - draw to the background, clear when needed, handle input. Windowed apps add overlays on top. APU doesn't impose any paradigm - it's a universal slate.

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Your Game     │────▶│       APU        │────▶│  Telnet Client  │
│  (JSON commands)│     │   (Port 6122)    │     │   (Port 6123)   │
└─────────────────┘     └──────────────────┘     └─────────────────┘
        ▲                        │
        │                        │
        └────────────────────────┘
              Input Events
```

- **Game Port (6122)**: Your game connects here, sends JSON commands, receives events
- **Client Port (6123)**: Players connect via telnet, see rendered output, send input

## Quick Start

### 1. Start APU Server

```bash
cargo run -- 6122 6123
```

### 2. Connect Your Game

```javascript
const net = require('net');
const socket = net.createConnection(6122, 'localhost');

// Send commands as JSON lines
function send(cmd) {
    socket.write(JSON.stringify(cmd) + '\n');
}

// Initialize display
send({ cmd: 'init', cols: 80, rows: 24 });

// Draw something
send({ cmd: 'print_direct', x: 10, y: 5, text: 'Hello World!', fg: 10 });

// Flush to render
send({ cmd: 'flush', force_full: true });
```

### 3. Handle Events

```javascript
socket.on('data', (data) => {
    const lines = data.toString().split('\n');
    for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line);

        if (event.type === 'client_connect') {
            console.log('Player connected:', event.session);
        }
        else if (event.type === 'input') {
            handleInput(event.session, event.event);
        }
    }
});
```

---

## Display Architecture

APU uses a two-layer compositing system:

1. **Background Layer**: Direct draws (desktop, static content)
2. **Windows Layer**: Z-ordered windows composited on top

When you call `flush`, APU:
1. Copies background to display buffer
2. Renders windows in z-order
3. Sends ANSI output to clients

---

## Commands Reference

All commands are JSON objects with a `cmd` field. Send one command per line.

### Display Setup

#### `init` - Initialize Display

```json
{"cmd": "init", "cols": 80, "rows": 24}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| cols | int | 80 | Display width |
| rows | int | 24 | Display height |

#### `shutdown` - Cleanup Display

```json
{"cmd": "shutdown"}
```

Restores terminal state (shows cursor, resets colors).

#### `clear` - Clear Background Layer

```json
{"cmd": "clear"}
```

Clears the background layer to black. **Windows are preserved.**

- For **non-windowed apps** (IRC, MUSH, Zork): This clears the entire visible screen
- For **windowed apps**: Only the background/desktop is cleared; windows remain with their content

#### `clear_background` - Explicit Alias for Clear

```json
{"cmd": "clear_background"}
```

Same as `clear`. Provided for clarity in windowed applications where you want to explicitly indicate you're only clearing the background layer.

#### `reset` - Complete Slate Reset

```json
{"cmd": "reset"}
```

**Nuclear option**: Destroys ALL windows AND clears the background. Use when:
- Switching between game modes (e.g., menu → gameplay)
- Completely resetting the display state
- Transitioning from windowed to non-windowed mode

---

### Direct Drawing (Background Layer)

These draw directly to the background, behind all windows.

#### `set_direct` - Set Single Cell

```json
{"cmd": "set_direct", "x": 10, "y": 5, "char": "@", "fg": 10, "bg": 0}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| x | int | required | X coordinate (0-based) |
| y | int | required | Y coordinate (0-based) |
| char | char | required | Character to display |
| fg | int | 7 | Foreground color (0-15) |
| bg | int | 0 | Background color (0-15) |

#### `print_direct` - Print Text

```json
{"cmd": "print_direct", "x": 5, "y": 10, "text": "Hello!", "fg": 14, "bg": 1}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| x | int | required | Starting X coordinate |
| y | int | required | Y coordinate |
| text | string | required | Text to print |
| fg | int | 7 | Foreground color |
| bg | int | 0 | Background color |

#### `batch` - Batch Cell Updates

Efficiently update many cells at once:

```json
{
    "cmd": "batch",
    "cells": [
        {"x": 0, "y": 0, "char": "#", "fg": 7, "bg": 0},
        {"x": 1, "y": 0, "char": "#", "fg": 7, "bg": 0},
        {"x": 2, "y": 0, "char": "#", "fg": 7, "bg": 0}
    ]
}
```

Cells can optionally include `"window": "window_id"` to draw to a window instead.

---

### Window Management

Windows float above the background and can overlap. Each has a unique string ID.

#### `create_window` - Create or Update Window

```json
{
    "cmd": "create_window",
    "id": "main",
    "x": 5,
    "y": 3,
    "width": 40,
    "height": 15,
    "border": "single",
    "title": "My Window",
    "closable": true,
    "resizable": true,
    "draggable": true,
    "min_width": 20,
    "min_height": 10,
    "invert": false
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| id | string | required | Unique window identifier |
| x | int | required | Left edge position |
| y | int | required | Top edge position |
| width | int | required | Total width (including border) |
| height | int | required | Total height (including border) |
| border | string | "single" | Border style (see below) |
| title | string | null | Title in top border |
| closable | bool | true | Show close button `[]` in title bar |
| resizable | bool | true | Show resize handle `◢` in bottom-right |
| draggable | bool | true | Allow dragging by title bar |
| min_width | int | 10 | Minimum width when resizing |
| min_height | int | 5 | Minimum height when resizing |
| invert | bool | false | Invert colors of whatever is underneath |

**Idempotent Behavior**: If a window with the same `id` already exists:
- Position (x, y) is updated
- Dimensions are updated only if changed (triggers resize)
- **Content is preserved** - existing window content is NOT cleared
- Use `clear_window` explicitly if you want to clear content

**Window Chrome (Automatic):**
- Close button `[]` appears in top-left of title bar (if `closable: true`)
- Resize handle `◢` appears in bottom-right corner (if `resizable: true`)
- Clicking title bar and dragging moves window (if `draggable: true`)
- All interactions emit events to game - no manual hit-testing needed!

**Border Styles:**
- `"none"` - No border
- `"single"` - `┌─┐│└─┘`
- `"double"` - `╔═╗║╚═╝`
- `"rounded"` - `╭─╮│╰─╯`
- `"heavy"` - `┏━┓┃┗━┛`
- `"ascii"` - `+-+|+-+`

**Invert Mode:**

When `invert: true`, the window doesn't draw its own content. Instead, it inverts the colors (swaps foreground and background) of whatever is underneath it during compositing. This is perfect for:

- **Cursors** - A 1x1 invert window makes a perfect keyboard cursor that shows the inverted character beneath it
- **Selection highlights** - Invert a region to show it's selected
- **Focus indicators** - Highlight active elements

Example cursor:
```json
{
    "cmd": "create_window",
    "id": "cursor",
    "x": 40,
    "y": 12,
    "width": 1,
    "height": 1,
    "border": "none",
    "closable": false,
    "resizable": false,
    "draggable": false,
    "invert": true
}
```

The invert window works across all layers - it will invert the desktop background, window borders, or window content depending on what's at that position.

#### `remove_window` - Delete Window

```json
{"cmd": "remove_window", "id": "main"}
```

#### `update_window` - Modify Window Properties

```json
{
    "cmd": "update_window",
    "id": "main",
    "x": 10,
    "y": 5,
    "width": 50,
    "height": 20,
    "visible": true,
    "title": "New Title",
    "z_index": 100
}
```

All fields except `id` are optional - only specified fields are changed.

#### `clear_window` - Clear Window Content

```json
{"cmd": "clear_window", "id": "main"}
```

#### `bring_to_front` - Raise Window

```json
{"cmd": "bring_to_front", "id": "main"}
```

#### `send_to_back` - Lower Window

```json
{"cmd": "send_to_back", "id": "main"}
```

---

### Window Drawing

Draw inside windows using content-relative coordinates (0,0 is top-left of content area, inside border).

#### `set_cell` - Set Cell in Window

```json
{"cmd": "set_cell", "window": "main", "x": 0, "y": 0, "char": "@", "fg": 10}
```

#### `print` - Print Text in Window

```json
{"cmd": "print", "window": "main", "x": 2, "y": 1, "text": "Hello", "fg": 15, "bg": 4}
```

#### `fill` - Fill Rectangle in Window

```json
{
    "cmd": "fill",
    "window": "main",
    "x": 0,
    "y": 0,
    "width": 38,
    "height": 13,
    "char": " ",
    "fg": 0,
    "bg": 7
}
```

---

### Rendering

#### `flush` - Render to Clients

```json
{"cmd": "flush", "force_full": true}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| force_full | bool | false | If true, redraws entire screen; if false, only changed cells |

**Always call `flush` after drawing to send output to clients!**

---

### Mouse Support

#### `enable_mouse` - Enable Mouse Tracking

```json
{"cmd": "enable_mouse", "mode": "sgr"}
```

| Mode | Description |
|------|-------------|
| `"normal"` | Button press/release only |
| `"button"` | Press/release + drag |
| `"any"` | All mouse motion |
| `"sgr"` | SGR extended mode (recommended) |

#### `disable_mouse` - Disable Mouse Tracking

```json
{"cmd": "disable_mouse"}
```

---

## Events (APU → Game)

Events are sent as JSON lines from APU to your game.

### `client_connect` - Player Connected

```json
{"type": "client_connect", "session": "session_127_0_0_1_12345"}
```

### `client_disconnect` - Player Disconnected

```json
{"type": "client_disconnect", "session": "session_127_0_0_1_12345"}
```

### `input` - User Input

```json
{
    "type": "input",
    "session": "session_127_0_0_1_12345",
    "event": { ... }
}
```

The `event` field contains one of:

#### Character Input

```json
{"type": "char", "char": "a"}
```

#### Key Press

```json
{"type": "key", "key": "up"}
```

**Keys:** `up`, `down`, `left`, `right`, `home`, `end`, `page_up`, `page_down`, `insert`, `delete`, `escape`, `enter`, `tab`, `backspace`, `f1`-`f12`

#### Mouse Event

```json
{
    "type": "mouse",
    "x": 25,
    "y": 10,
    "button": "left",
    "event": "press",
    "modifiers": {"shift": false, "ctrl": false, "alt": false}
}
```

**Buttons:** `left`, `middle`, `right`, `wheel_up`, `wheel_down`, `none`

**Events:** `press`, `release`, `drag`, `move`

### Window Events (Automatic)

APU automatically handles window chrome (close button, drag, resize) and emits high-level events:

#### `window_close_requested` - Close Button Clicked

```json
{"type": "window_close_requested", "id": "main"}
```

The game should handle this by removing the window (or prompting for confirmation).

#### `window_moved` - Window Was Dragged

```json
{"type": "window_moved", "id": "main", "x": 15, "y": 8}
```

Sent when the user finishes dragging a window by its title bar.

#### `window_resized` - Window Was Resized

```json
{"type": "window_resized", "id": "main", "width": 50, "height": 25}
```

Sent when the user finishes resizing a window via the resize handle.

#### `window_focused` - Window Was Clicked

```json
{"type": "window_focused", "id": "main"}
```

Sent when a window is brought to front by clicking on it.

---

## Color Reference

APU uses 4-bit colors (0-15):

| Code | Color | Code | Color |
|------|-------|------|-------|
| 0 | Black | 8 | Dark Gray |
| 1 | Red | 9 | Light Red |
| 2 | Green | 10 | Light Green |
| 3 | Yellow/Brown | 11 | Light Yellow |
| 4 | Blue | 12 | Light Blue |
| 5 | Magenta | 13 | Light Magenta |
| 6 | Cyan | 14 | Light Cyan |
| 7 | White/Gray | 15 | Bright White |

---

## Example: Simple Chat Window

```javascript
const net = require('net');
const socket = net.createConnection(6122, 'localhost');

function send(cmd) {
    socket.write(JSON.stringify(cmd) + '\n');
}

// On connect
socket.on('connect', () => {
    // Initialize
    send({ cmd: 'init', cols: 80, rows: 24 });
    send({ cmd: 'enable_mouse', mode: 'sgr' });

    // Create chat window
    send({
        cmd: 'create_window',
        id: 'chat',
        x: 2, y: 1,
        width: 76, height: 20,
        border: 'double',
        title: 'Chat Room'
    });

    // Fill with background
    send({
        cmd: 'fill',
        window: 'chat',
        x: 0, y: 0,
        width: 74, height: 18,
        char: ' ', fg: 7, bg: 0
    });

    // Welcome message
    send({
        cmd: 'print',
        window: 'chat',
        x: 1, y: 0,
        text: 'Welcome to the chat!',
        fg: 10, bg: 0
    });

    // Input prompt at bottom
    send({
        cmd: 'print_direct',
        x: 2, y: 22,
        text: '> ',
        fg: 14, bg: 0
    });

    send({ cmd: 'flush', force_full: true });
});

// Handle events
let inputBuffer = '';
socket.on('data', (data) => {
    for (const line of data.toString().split('\n')) {
        if (!line.trim()) continue;
        const event = JSON.parse(line);

        if (event.type === 'input' && event.event.type === 'char') {
            inputBuffer += event.event.char;
            send({ cmd: 'print_direct', x: 4, y: 22, text: inputBuffer, fg: 15 });
            send({ cmd: 'flush' });
        }
    }
});
```

---

## Example: MUSH-Style Room Display

```javascript
// Draw room with exits
function drawRoom(room) {
    send({ cmd: 'clear' });

    // Room name header
    send({ cmd: 'print_direct', x: 0, y: 0, text: '═'.repeat(80), fg: 6 });
    send({ cmd: 'print_direct', x: 2, y: 0, text: ` ${room.name} `, fg: 14, bg: 0 });

    // Description
    let y = 2;
    for (const line of wrapText(room.description, 78)) {
        send({ cmd: 'print_direct', x: 1, y: y++, text: line, fg: 7 });
    }

    // Exits
    y++;
    send({ cmd: 'print_direct', x: 1, y: y++, text: 'Exits:', fg: 10 });
    for (const exit of room.exits) {
        send({ cmd: 'print_direct', x: 3, y: y++, text: `[${exit.key}] ${exit.name}`, fg: 11 });
    }

    // Players present
    if (room.players.length > 0) {
        y++;
        send({ cmd: 'print_direct', x: 1, y: y++, text: 'Also here:', fg: 13 });
        send({ cmd: 'print_direct', x: 3, y: y++, text: room.players.join(', '), fg: 7 });
    }

    send({ cmd: 'flush', force_full: true });
}
```

---

## Example: ZZT-Style Game Board

```javascript
const COLS = 60, ROWS = 20;
const board = []; // 2D array of tiles

function drawBoard() {
    // Draw border
    send({ cmd: 'print_direct', x: 0, y: 0, text: '╔' + '═'.repeat(COLS) + '╗', fg: 6 });
    for (let y = 1; y <= ROWS; y++) {
        send({ cmd: 'set_direct', x: 0, y: y, char: '║', fg: 6 });
        send({ cmd: 'set_direct', x: COLS + 1, y: y, char: '║', fg: 6 });
    }
    send({ cmd: 'print_direct', x: 0, y: ROWS + 1, text: '╚' + '═'.repeat(COLS) + '╝', fg: 6 });

    // Draw tiles
    const cells = [];
    for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
            const tile = board[y][x];
            cells.push({
                x: x + 1,
                y: y + 1,
                char: tile.char,
                fg: tile.fg,
                bg: tile.bg
            });
        }
    }
    send({ cmd: 'batch', cells: cells });

    // Draw player
    send({ cmd: 'set_direct', x: player.x + 1, y: player.y + 1, char: '☺', fg: 14 });

    // Stats sidebar
    send({ cmd: 'print_direct', x: 65, y: 2, text: `HP: ${player.hp}`, fg: 10 });
    send({ cmd: 'print_direct', x: 65, y: 3, text: `Score: ${player.score}`, fg: 11 });

    send({ cmd: 'flush', force_full: true });
}

// Handle input
function handleInput(event) {
    if (event.type === 'key') {
        switch (event.key) {
            case 'up':    movePlayer(0, -1); break;
            case 'down':  movePlayer(0, 1); break;
            case 'left':  movePlayer(-1, 0); break;
            case 'right': movePlayer(1, 0); break;
        }
    }
}
```

---

## Clearing Commands Quick Reference

| Command | Clears Background | Destroys Windows | Use Case |
|---------|-------------------|------------------|----------|
| `clear` | ✓ | ✗ | Refresh desktop, preserve windows |
| `clear_background` | ✓ | ✗ | Same as clear (explicit name) |
| `clear_window {id}` | ✗ | ✗ (clears content) | Reset single window content |
| `reset` | ✓ | ✓ | Complete slate, mode switch |
| `remove_window {id}` | ✗ | ✓ (one window) | Close specific window |

---

## Tips for AI Agents

1. **Always flush after drawing** - Nothing appears until you call `flush`

2. **Use batch for large updates** - Much faster than individual `set_direct` calls

3. **Track window positions** - If you enable dragging, maintain window state in your game

4. **Handle client_connect** - Redraw the screen when a new client connects

5. **Buffer input** - Collect characters until Enter for text input

6. **Use windows for overlays** - Dialogs, menus, popups should be separate windows

7. **Z-order matters** - Higher z_index windows appear on top

8. **Coordinates are 0-based** - (0,0) is top-left corner

9. **Window content is relative** - (0,0) in a window is inside the border

10. **Colors are 4-bit** - 0-15, with 8-15 being bright versions

---

## Running APU

```bash
# Build
cd apu-rust
cargo build --release

# Run (game_port client_port)
./target/release/apu-server 6122 6123
```

Players connect via:
```bash
telnet localhost 6123
```
