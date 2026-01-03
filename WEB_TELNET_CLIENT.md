# How to Build a Web Telnet Client

A simple guide to creating a browser-based terminal that connects to a telnet/TCP server via WebSockets.

## Architecture

```
┌─────────────┐     WebSocket      ┌─────────────┐      TCP       ┌─────────────┐
│   Browser   │◄──────────────────►│  Node.js    │◄──────────────►│   Telnet    │
│   (HTML)    │   (JSON messages)  │   Bridge    │  (raw bytes)   │   Server    │
└─────────────┘                    └─────────────┘                └─────────────┘
```

Browsers can't open raw TCP sockets, so we need a WebSocket-to-TCP bridge server.

## Part 1: The Bridge Server (Node.js)

This server accepts WebSocket connections from browsers and forwards data to your TCP/telnet server.

```javascript
// web-bridge.js
import { WebSocketServer } from 'ws';
import net from 'net';
import http from 'http';
import fs from 'fs';

const WEB_PORT = 8080;        // Port for web clients
const TELNET_HOST = 'localhost';
const TELNET_PORT = 23;       // Your telnet server

// Track connected clients
const clients = new Map();

// Generate unique connection ID
function generateId() {
  return 'conn_' + Math.random().toString(36).substring(2, 15);
}

// Create HTTP server to serve the HTML page
const httpServer = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
    fs.readFile('index.html', (err, data) => {
      if (err) {
        res.writeHead(500);
        res.end('Error loading page');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    });
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

// Create WebSocket server attached to HTTP server
const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws, req) => {
  const connId = generateId();
  console.log(`[${connId}] Browser connected`);

  // Connect to the telnet server
  const telnet = net.createConnection(TELNET_PORT, TELNET_HOST, () => {
    console.log(`[${connId}] Connected to telnet server`);
  });

  // Store the connection pair
  clients.set(connId, { ws, telnet });

  // Forward telnet output to browser
  telnet.on('data', (data) => {
    if (ws.readyState === 1) { // WebSocket.OPEN
      ws.send(JSON.stringify({
        type: 'output',
        data: data.toString('binary') // Preserve raw bytes as string
      }));
    }
  });

  telnet.on('close', () => {
    console.log(`[${connId}] Telnet connection closed`);
    ws.close();
    clients.delete(connId);
  });

  telnet.on('error', (err) => {
    console.error(`[${connId}] Telnet error:`, err.message);
    ws.close();
  });

  // Forward browser input to telnet
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'input' && telnet.writable) {
        telnet.write(msg.data);
      }
    } catch (e) {
      console.error(`[${connId}] Invalid message:`, e.message);
    }
  });

  ws.on('close', () => {
    console.log(`[${connId}] Browser disconnected`);
    telnet.destroy();
    clients.delete(connId);
  });

  ws.on('error', (err) => {
    console.error(`[${connId}] WebSocket error:`, err.message);
  });
});

httpServer.listen(WEB_PORT, () => {
  console.log(`Web telnet client running at http://localhost:${WEB_PORT}`);
});
```

### Dependencies

```json
{
  "type": "module",
  "dependencies": {
    "ws": "^8.0.0"
  }
}
```

Install with: `npm install ws`

---

## Part 2: The Browser Client (HTML + JavaScript)

This is a single HTML file with embedded CSS and JavaScript.

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Web Telnet</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      background: #1a1a1a;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      font-family: monospace;
    }

    #terminal {
      background: #000;
      border: 2px solid #333;
      border-radius: 8px;
      padding: 10px;
    }

    #screen {
      font-family: 'Courier New', monospace;
      font-size: 14px;
      line-height: 1.2;
      white-space: pre;
      color: #aaa;
      min-width: 640px;
      min-height: 400px;
    }

    #status {
      color: #666;
      font-size: 12px;
      margin-top: 10px;
      text-align: center;
    }

    #status.connected { color: #0f0; }
    #status.disconnected { color: #f00; }

    /* ANSI color classes */
    .fg-black { color: #000; }
    .fg-red { color: #a00; }
    .fg-green { color: #0a0; }
    .fg-yellow { color: #a50; }
    .fg-blue { color: #00a; }
    .fg-magenta { color: #a0a; }
    .fg-cyan { color: #0aa; }
    .fg-white { color: #aaa; }
    .fg-bright-black { color: #555; }
    .fg-bright-red { color: #f55; }
    .fg-bright-green { color: #5f5; }
    .fg-bright-yellow { color: #ff5; }
    .fg-bright-blue { color: #55f; }
    .fg-bright-magenta { color: #f5f; }
    .fg-bright-cyan { color: #5ff; }
    .fg-bright-white { color: #fff; }

    .bg-black { background: #000; }
    .bg-red { background: #a00; }
    .bg-green { background: #0a0; }
    .bg-yellow { background: #a50; }
    .bg-blue { background: #00a; }
    .bg-magenta { background: #a0a; }
    .bg-cyan { background: #0aa; }
    .bg-white { background: #aaa; }

    .bold { font-weight: bold; }
    .reverse { filter: invert(1); }
  </style>
</head>
<body>
  <div id="container">
    <div id="terminal">
      <div id="screen">Connecting...</div>
    </div>
    <div id="status" class="disconnected">Disconnected</div>
  </div>

  <script>
    const screen = document.getElementById('screen');
    const status = document.getElementById('status');

    let ws = null;
    let connected = false;
    let buffer = '';

    // ANSI code to CSS class mappings
    const fgColors = {
      30: 'fg-black', 31: 'fg-red', 32: 'fg-green', 33: 'fg-yellow',
      34: 'fg-blue', 35: 'fg-magenta', 36: 'fg-cyan', 37: 'fg-white',
      90: 'fg-bright-black', 91: 'fg-bright-red', 92: 'fg-bright-green',
      93: 'fg-bright-yellow', 94: 'fg-bright-blue', 95: 'fg-bright-magenta',
      96: 'fg-bright-cyan', 97: 'fg-bright-white'
    };

    const bgColors = {
      40: 'bg-black', 41: 'bg-red', 42: 'bg-green', 43: 'bg-yellow',
      44: 'bg-blue', 45: 'bg-magenta', 46: 'bg-cyan', 47: 'bg-white'
    };

    // Convert ANSI escape codes to HTML with CSS classes
    function ansiToHtml(text) {
      let html = '';
      let fg = '', bg = '';
      let bold = false, reverse = false;
      let i = 0;

      while (i < text.length) {
        // Detect escape sequence: ESC[...m
        if (text[i] === '\x1b' && text[i + 1] === '[') {
          let j = i + 2;
          while (j < text.length && !/[mHJK?]/.test(text[j])) j++;

          const code = text.substring(i + 2, j);
          const terminator = text[j];

          if (terminator === 'm') {
            // Parse color/style codes
            for (const c of code.split(';').map(n => parseInt(n) || 0)) {
              if (c === 0) { fg = bg = ''; bold = reverse = false; }
              else if (c === 1) bold = true;
              else if (c === 7) reverse = true;
              else if (c === 27) reverse = false;
              else if (fgColors[c]) fg = fgColors[c];
              else if (bgColors[c]) bg = bgColors[c];
            }
          }

          // Skip cursor/screen control codes
          if (terminator === '?') {
            while (j < text.length && !/[lh]/.test(text[j])) j++;
          }

          i = j + 1;
          continue;
        }

        // Skip carriage return
        if (text[i] === '\r') { i++; continue; }

        // Newline
        if (text[i] === '\n') { html += '\n'; i++; continue; }

        // Regular character with styling
        let classes = [fg, bg, bold && 'bold', reverse && 'reverse']
          .filter(Boolean).join(' ');

        let char = text[i];
        if (char === '<') char = '&lt;';
        else if (char === '>') char = '&gt;';
        else if (char === '&') char = '&amp;';

        html += classes ? `<span class="${classes}">${char}</span>` : char;
        i++;
      }

      return html;
    }

    // Connect to WebSocket server
    function connect() {
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(`${protocol}//${location.host}`);

      ws.onopen = () => {
        connected = true;
        status.textContent = 'Connected';
        status.className = 'connected';
      };

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'output') {
          // Clear screen detection
          if (msg.data.includes('\x1b[2J') || msg.data.includes('\x1b[H')) {
            buffer = msg.data;
          } else {
            buffer += msg.data;
          }
          screen.innerHTML = ansiToHtml(buffer);
        }
      };

      ws.onclose = () => {
        connected = false;
        status.textContent = 'Disconnected - Reconnecting...';
        status.className = 'disconnected';
        setTimeout(connect, 3000);
      };

      ws.onerror = (err) => console.error('WebSocket error:', err);
    }

    // Send keypress to server
    function sendKey(key) {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data: key }));
      }
    }

    // Keyboard input handling
    document.addEventListener('keydown', (e) => {
      if (!connected) return;

      // Prevent browser handling of these keys
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
           'Enter', 'Escape', 'Backspace', 'Tab'].includes(e.key)) {
        e.preventDefault();
      }

      // Map keys to terminal escape sequences
      switch (e.key) {
        case 'ArrowUp':    sendKey('\x1b[A'); break;
        case 'ArrowDown':  sendKey('\x1b[B'); break;
        case 'ArrowRight': sendKey('\x1b[C'); break;
        case 'ArrowLeft':  sendKey('\x1b[D'); break;
        case 'Enter':      sendKey('\r'); break;
        case 'Escape':     sendKey('\x1b'); break;
        case 'Backspace':  sendKey('\x7f'); break;
        case 'Tab':        sendKey('\t'); break;
        default:
          if (e.key.length === 1) {
            if (e.ctrlKey) {
              // Ctrl+A through Ctrl+Z = ASCII 1-26
              const code = e.key.toLowerCase().charCodeAt(0) - 96;
              if (code > 0 && code < 27) sendKey(String.fromCharCode(code));
            } else {
              sendKey(e.key);
            }
          }
      }
    });

    // Start connection
    connect();
  </script>
</body>
</html>
```

---

## Part 3: Running It

1. Save `web-bridge.js` and `index.html` in the same folder
2. Install dependencies: `npm install ws`
3. Edit `TELNET_HOST` and `TELNET_PORT` in web-bridge.js
4. Run: `node web-bridge.js`
5. Open `http://localhost:8080` in your browser

---

## Key Concepts

### WebSocket Message Protocol

Browser and server communicate via JSON:

```javascript
// Browser → Server (keyboard input)
{ "type": "input", "data": "hello\r" }

// Server → Browser (terminal output)
{ "type": "output", "data": "\x1b[32mGreen text\x1b[0m" }
```

### ANSI Escape Codes

Terminals use escape sequences for colors and cursor control:

| Code | Meaning |
|------|---------|
| `\x1b[0m` | Reset all styles |
| `\x1b[1m` | Bold |
| `\x1b[31m` | Red foreground |
| `\x1b[42m` | Green background |
| `\x1b[2J` | Clear screen |
| `\x1b[H` | Cursor to home (top-left) |
| `\x1b[A/B/C/D` | Arrow keys (up/down/right/left) |

### Arrow Key Sequences

When user presses arrow keys, send these escape sequences:

```javascript
Up:    '\x1b[A'  // ESC [ A
Down:  '\x1b[B'  // ESC [ B
Right: '\x1b[C'  // ESC [ C
Left:  '\x1b[D'  // ESC [ D
```

---

## Enhancements to Consider

1. **Telnet negotiation** - Handle IAC sequences for raw mode
2. **Terminal resize** - Send NAWS (window size) updates
3. **Connection pooling** - Share single telnet connection across clients
4. **Authentication** - Add login before connecting
5. **TLS/SSL** - Use `wss://` for secure connections
6. **Mobile support** - Add touch controls or on-screen keyboard

---

## Troubleshooting

**"Connection refused"** - Make sure your telnet server is running

**Garbled output** - The server may need telnet negotiation for raw mode

**No colors** - Check that ANSI parsing is working; log `msg.data` to console

**Keys not working** - Verify the server expects the escape sequences you're sending

---

Created for ObjectMUD - https://github.com/your-repo-here
