# ASCII Processing Unit (APU)

A universal character-cell display engine for building terminal applications, text-based games, MUSHes, and windowed ASCII interfaces.

**APU lets you build terminal apps once and run them everywhere** - from classic telnet clients to modern web browsers.

## Features

- **Cell Grid Display** - 80x24 (or dynamic) character buffer with 16 ANSI colors
- **Window Manager** - Overlapping windows with borders, titles, z-ordering, drag, resize
- **Multi-Session** - Multiple telnet clients with independent or shared displays
- **Mouse Support** - Full mouse tracking with click, drag, and scroll events
- **JSON Protocol** - Simple JSON-over-TCP protocol for any language
- **Embedded Terminals** - Spawn PTY processes inside windows (SSH, shells, etc.)
- **Efficient Rendering** - Dirty rectangle optimization, minimal ANSI output

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Your Game     │────▶│       APU        │────▶│  Telnet Client  │
│  (any language) │     │   (Rust server)  │     │  (any terminal) │
└─────────────────┘     └──────────────────┘     └─────────────────┘
        ▲                        │
        │    Input Events        │
        └────────────────────────┘
```

- **Game Port (default 6121)**: Your application connects here, sends JSON commands
- **Client Port (default 6123)**: Players connect via telnet, see rendered output

## Quick Start

### 1. Build APU

```bash
cargo build --release
```

### 2. Run the Server

```bash
./target/release/apu-server 6121 6123
```

Or with logging:
```bash
RUST_LOG=info ./target/release/apu-server 6121 6123
```

### 3. Connect Your Application

```javascript
const net = require('net');
const socket = net.createConnection(6121, 'localhost');

function send(cmd) {
    socket.write(JSON.stringify(cmd) + '\n');
}

// Initialize 80x24 display
send({ cmd: 'init', cols: 80, rows: 24 });

// Draw directly to screen
send({ cmd: 'print_direct', x: 10, y: 5, text: 'Hello APU!', fg: 10 });

// Or create a window
send({
    cmd: 'create_window',
    id: 'main',
    x: 5, y: 3,
    width: 40, height: 12,
    border: 'double',
    title: 'My Window'
});

send({ cmd: 'print', window: 'main', x: 2, y: 2, text: 'Inside window!', fg: 14 });

// Render to clients
send({ cmd: 'flush' });
```

### 4. Connect a Telnet Client

```bash
telnet localhost 6123
```

## Protocol Reference

APU uses a JSON-over-TCP protocol. Each command is a JSON object followed by newline.

### Display Commands

| Command | Description |
|---------|-------------|
| `init` | Initialize display with cols/rows |
| `clear` | Clear background layer |
| `reset` | Clear everything including windows |
| `flush` | Render to clients |

### Drawing Commands

| Command | Description |
|---------|-------------|
| `set_direct` | Set single cell on background |
| `print_direct` | Print text on background |
| `set_cell` | Set cell in window |
| `print` | Print text in window |
| `fill` | Fill rectangle with character |
| `batch` | Multiple operations in one call |

### Window Commands

| Command | Description |
|---------|-------------|
| `create_window` | Create new window |
| `remove_window` | Destroy window |
| `update_window` | Modify window properties |
| `clear_window` | Clear window contents |
| `bring_to_front` | Raise window z-order |
| `send_to_back` | Lower window z-order |

### Input/Mouse

| Command | Description |
|---------|-------------|
| `enable_mouse` | Enable mouse tracking |

### Events (APU → Game)

| Event | Description |
|-------|-------------|
| `client_connect` | New telnet client connected |
| `client_disconnect` | Client disconnected |
| `input` | Keyboard/mouse input from client |
| `window_moved` | Window was dragged |
| `window_resized` | Window was resized |
| `window_close_requested` | Close button clicked |

See [APU-PROTOCOL.md](APU-PROTOCOL.md) for complete documentation.

## Colors

APU uses standard 16-color ANSI palette:

| Index | Color | Index | Color |
|-------|-------|-------|-------|
| 0 | Black | 8 | Bright Black (Gray) |
| 1 | Red | 9 | Bright Red |
| 2 | Green | 10 | Bright Green |
| 3 | Yellow | 11 | Bright Yellow |
| 4 | Blue | 12 | Bright Blue |
| 5 | Magenta | 13 | Bright Magenta |
| 6 | Cyan | 14 | Bright Cyan |
| 7 | White | 15 | Bright White |

## Border Styles

Windows support multiple border styles:

- `none` - No border
- `single` - Single line (`┌─┐│└┘`)
- `double` - Double line (`╔═╗║╚╝`)
- `rounded` - Rounded corners (`╭─╮│╰╯`)
- `heavy` - Heavy line (`┏━┓┃┗┛`)
- `ascii` - ASCII only (`+-+|`)

## Examples

### Simple Hello World

```javascript
send({ cmd: 'init', cols: 80, rows: 24 });
send({ cmd: 'print_direct', x: 35, y: 12, text: 'Hello World!', fg: 11 });
send({ cmd: 'flush' });
```

### Window with Content

```javascript
send({
    cmd: 'create_window',
    id: 'dialog',
    x: 20, y: 8,
    width: 40, height: 8,
    border: 'double',
    title: 'Welcome',
    closable: true,
    draggable: true
});

send({ cmd: 'print', window: 'dialog', x: 2, y: 2, text: 'Press any key to continue...', fg: 7 });
send({ cmd: 'flush' });
```

### Handle Input

```javascript
socket.on('data', (data) => {
    for (const line of data.toString().split('\n')) {
        if (!line.trim()) continue;
        const event = JSON.parse(line);

        if (event.type === 'input') {
            const input = event.event;
            if (input.key) {
                console.log('Key pressed:', input.key);
            }
            if (input.mouse) {
                console.log('Mouse:', input.mouse.x, input.mouse.y, input.mouse.button);
            }
        }
    }
});
```

## Demos

The `demos/` directory contains working examples:

- **mac1984-finder.cjs** - Complete Mac 1984 Finder recreation with working apps
- **win31.cjs** - Windows 3.1 Program Manager demo

Run a demo:
```bash
# Start APU server
./target/release/apu-server 6121 6123 &

# Run demo
node demos/mac1984-finder.cjs

# Connect with telnet
telnet localhost 6123
```

## Web Client

APU includes a web-based telnet client for browser access. See [WEB_TELNET_CLIENT.md](WEB_TELNET_CLIENT.md) for setup.

## Documentation

- [APU-PROTOCOL.md](APU-PROTOCOL.md) - Complete protocol reference
- [APU-DESIGN.md](APU-DESIGN.md) - Architecture and design philosophy
- [WEB_TELNET_CLIENT.md](WEB_TELNET_CLIENT.md) - Web client setup
- [mouse.md](mouse.md) - Mouse protocol details

## Building

### Requirements

- Rust 1.70+
- Cargo

### Build

```bash
# Debug build
cargo build

# Release build (recommended)
cargo build --release

# Run tests
cargo test
```

### Cross-compile for Linux

```bash
# Add target
rustup target add x86_64-unknown-linux-musl

# Build
cargo build --release --target x86_64-unknown-linux-musl
```

## Project Structure

```
apu/
├── src/
│   ├── main.rs          # Server entry point
│   ├── lib.rs           # Library exports
│   ├── server.rs        # TCP server & session management
│   ├── protocol.rs      # JSON protocol parsing
│   ├── input.rs         # Input event handling
│   ├── terminal.rs      # Embedded terminal support
│   ├── core/
│   │   ├── cell.rs      # Cell structure
│   │   ├── grid.rs      # Display grid
│   │   └── window.rs    # Window manager
│   └── renderer/
│       ├── mod.rs       # Renderer trait
│       └── ansi_ibm.rs  # ANSI IBM renderer
├── demos/               # Example applications
├── examples/            # Simple examples
├── Cargo.toml
└── README.md
```

## License

MIT License - see [LICENSE](LICENSE)

## Contributing

Contributions welcome! Please read the design docs before submitting PRs.

## Roadmap

- [ ] VT-100 pure ASCII renderer
- [ ] Web Canvas renderer
- [ ] Color degradation (256 → 16 → mono)
- [ ] Responsive layout engine
- [ ] Widget toolkit (menus, forms, dialogs)

---

*"The game is the idea. APU is the messenger."*
