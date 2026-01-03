# APU Mouse Protocol

This document describes the mouse protocol used by APU (ASCII Processing Unit) for terminal-based applications.

## Overview

APU handles mouse input from terminals and delivers it to game clients as structured JSON events. The protocol works in two stages:

1. **Terminal → APU**: Raw terminal escape sequences (X10 or SGR format)
2. **APU → Game**: Parsed JSON events

## Enabling Mouse Tracking

### From Game to APU

Send this command to enable mouse tracking for a session:

```json
{"cmd": "enable_mouse", "mode": "sgr"}
```

Available modes:

| Mode | Description | Terminal Escape |
|------|-------------|-----------------|
| `"normal"` | Button press/release only | `CSI ?1000h` |
| `"button"` | Press/release + button drag | `CSI ?1002h` |
| `"any"` | All mouse motion (even without button) | `CSI ?1003h` |
| `"sgr"` | SGR extended mode (recommended) | `CSI ?1002h` + `CSI ?1006h` |

**Recommendation**: Always use `"sgr"` mode. It supports coordinates beyond 223 and distinguishes press from release.

To disable mouse tracking:

```json
{"cmd": "disable_mouse"}
```

### What APU Sends to Terminal

When you send `enable_mouse`, APU writes these escape sequences to the terminal:

```
SGR mode: ESC[?1002h ESC[?1006h
Normal:   ESC[?1000h
Button:   ESC[?1002h
Any:      ESC[?1003h
```

Disable sends:
```
ESC[?1000l ESC[?1002l ESC[?1003l ESC[?1006l
```

---

## Terminal Mouse Escape Sequences

Terminals report mouse events using escape sequences. APU parses two formats:

### X10 Format (Legacy)

```
ESC [ M Cb Cx Cy
```

- 6 bytes total
- Coordinates encoded as `value + 32` (limited to 0-222)
- Button byte `Cb` encodes button, modifiers, and motion

**Cb byte breakdown** (after subtracting 32):

| Bits | Meaning |
|------|---------|
| 0-1 | Button: 0=left, 1=middle, 2=right, 3=release |
| 2 | Shift held |
| 3 | Alt held |
| 4 | Ctrl held |
| 5 | Motion (drag) |
| 6 | Wheel event (if set: bit0=wheel up, bit1=wheel down) |

### SGR Format (Extended)

```
ESC [ < Pb ; Px ; Py M    (press)
ESC [ < Pb ; Px ; Py m    (release)
```

- Variable length, semicolon-separated decimal numbers
- Coordinates are 1-based (APU converts to 0-based)
- `M` = press, `m` = release
- No coordinate limits

**Pb byte breakdown:**

| Bits | Meaning |
|------|---------|
| 0-1 | Button: 0=left, 1=middle, 2=right |
| 2 | Shift held |
| 3 | Alt held |
| 4 | Ctrl held |
| 5 | Motion (drag/move) |
| 6 | Wheel event |

---

## Events: APU to Game

APU sends parsed mouse events as JSON:

### Mouse Event Structure

```json
{
    "type": "input",
    "session": "session_127_0_0_1_12345",
    "event": {
        "type": "mouse",
        "x": 25,
        "y": 10,
        "button": "left",
        "event": "press",
        "modifiers": {
            "shift": false,
            "ctrl": false,
            "alt": false
        }
    }
}
```

### Fields

| Field | Type | Values |
|-------|------|--------|
| `x` | integer | 0-based column (0 = leftmost) |
| `y` | integer | 0-based row (0 = topmost) |
| `button` | string | `"left"`, `"middle"`, `"right"`, `"wheel_up"`, `"wheel_down"`, `"none"` |
| `event` | string | `"press"`, `"release"`, `"drag"`, `"move"` |
| `modifiers.shift` | boolean | Shift key held |
| `modifiers.ctrl` | boolean | Control key held |
| `modifiers.alt` | boolean | Alt/Option key held |

### Event Types

| Event | Description |
|-------|-------------|
| `press` | Button pressed down |
| `release` | Button released (SGR mode only reliably detects this) |
| `drag` | Mouse moved with button held |
| `move` | Mouse moved without button (requires `"any"` mode) |

---

## Complete Example: Writing a Client

### 1. Connect to APU

Connect to the APU game port (not the telnet port). APU listens on two ports:
- **Telnet port** (e.g., 1984): For terminal connections
- **Game port** (e.g., 6121): For game client connections

```javascript
const net = require('net');
const client = net.createConnection(6121, 'localhost');
```

### 2. Handle Client Connect Event

```javascript
client.on('data', (data) => {
    const lines = data.toString().split('\n').filter(l => l.trim());
    for (const line of lines) {
        const event = JSON.parse(line);

        if (event.type === 'client_connect') {
            // New telnet user connected
            const sessionId = event.session;

            // Enable mouse for this session
            client.write(JSON.stringify({
                cmd: 'enable_mouse',
                session: sessionId,
                mode: 'sgr'
            }) + '\n');
        }
    }
});
```

### 3. Handle Mouse Events

```javascript
if (event.type === 'input' && event.event.type === 'mouse') {
    const { x, y, button, event: mouseEvent, modifiers } = event.event;
    const sessionId = event.session;

    if (button === 'left' && mouseEvent === 'press') {
        console.log(`Click at (${x}, ${y})`);
    }

    if (button === 'left' && mouseEvent === 'drag') {
        console.log(`Dragging at (${x}, ${y})`);
    }

    if (button === 'left' && mouseEvent === 'release') {
        console.log(`Released at (${x}, ${y})`);
    }

    if (button === 'wheel_up') {
        console.log('Scroll up');
    }

    if (button === 'wheel_down') {
        console.log('Scroll down');
    }
}
```

### 4. Draw Response

```javascript
// Draw a marker at the click position
client.write(JSON.stringify({
    cmd: 'print',
    session: sessionId,
    x: x,
    y: y,
    text: 'X',
    fg: 14  // Light cyan
}) + '\n');

// Flush to send to terminal
client.write(JSON.stringify({
    cmd: 'flush',
    session: sessionId
}) + '\n');
```

---

## Window Chrome Events

APU automatically handles window decorations (title bar, close button, resize handle). When using windows, some mouse events become high-level window events instead:

```json
{"type": "window_close_requested", "session": "...", "id": "main"}
{"type": "window_moved", "session": "...", "id": "main", "x": 15, "y": 8}
{"type": "window_resized", "session": "...", "id": "main", "width": 50, "height": 25}
{"type": "window_focused", "session": "...", "id": "main"}
```

Mouse events inside window content area are still sent as regular `input` events, but with coordinates relative to the window's content area.

---

## Testing Mouse Input

### From Terminal

Connect via telnet and move/click the mouse:
```bash
telnet localhost 1984
```

### Raw Escape Sequences

To manually send mouse events for testing, use these formats:

**SGR left click at (10, 5):**
```
printf '\e[<0;10;5M'   # Press
printf '\e[<0;10;5m'   # Release
```

**SGR right click at (20, 10):**
```
printf '\e[<2;20;10M'  # Press
printf '\e[<2;20;10m'  # Release
```

**SGR drag from (5,5) to (10,10):**
```
printf '\e[<0;5;5M'     # Press left at start
printf '\e[<32;6;6M'    # Drag (32 = button 0 + motion bit)
printf '\e[<32;10;10M'  # Drag
printf '\e[<0;10;10m'   # Release
```

---

## Coordinate System

```
(0,0)───────────────────────────► X
  │
  │    Terminal Screen
  │
  │    (10,5) means column 10, row 5
  │
  ▼
  Y
```

- X increases left to right
- Y increases top to bottom
- 0-indexed (top-left corner is 0,0)

---

## Common Issues

### Mouse not working?

1. Ensure you called `enable_mouse` after client connected
2. Check terminal supports mouse (most modern terminals do)
3. Some terminals need mouse reporting enabled in preferences

### Release events not detected?

Use `"sgr"` mode. X10 mode cannot reliably distinguish release from motion.

### Coordinates wrong?

SGR coordinates are 1-based from terminal but APU converts to 0-based. Ensure you're not double-converting.

### Only getting presses, no drags?

Use `"button"` or `"sgr"` mode. `"normal"` mode only reports press/release.
