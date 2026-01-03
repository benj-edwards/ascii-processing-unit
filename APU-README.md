# APU - ASCII Processing Unit

Universal character-cell display engine for terminal applications.

## Quick Start

```javascript
import { Display, COLORS } from './src/index.js';

// Create display
const display = new Display({
  cols: 80,
  rows: 24,
  onOutput: (data) => process.stdout.write(data),
});

// Initialize
display.init();

// Create a window
const win = display.window('main', {
  x: 10, y: 5,
  width: 40, height: 10,
  border: 'double',
  title: 'Hello World',
});

win.print(2, 2, 'Hello from APU!', COLORS.brightGreen);

// Render to terminal
display.flush();
```

## Run Examples

```bash
# Simple hello world
node examples/hello.js

# Window demo with animation
node examples/windows.js
```

## Features

- **Cell Grid**: 80x24 (or dynamic) character buffer
- **Windows**: Overlapping windows with borders, titles, z-ordering
- **Borders**: single, double, rounded, heavy, ascii, none
- **Colors**: 16 ANSI colors with semantic names
- **Dirty Rect Optimization**: Only redraws changed cells
- **Extensible Renderers**: Start with ANSI, add more later

## API Overview

### Display

```javascript
const display = new Display({ cols: 80, rows: 24, onOutput: fn });

display.init();              // Send init sequence
display.shutdown();          // Reset terminal
display.clear();             // Clear screen
display.flush();             // Render to output
display.redraw();            // Force full redraw

// Direct drawing
display.set(x, y, char, fg, bg, attrs);
display.print(x, y, text, fg, bg, attrs);
display.box(x, y, w, h, style, fg, bg);
display.fill(x, y, w, h, char, fg, bg);
```

### Windows

```javascript
const win = display.window('id', {
  x: 0, y: 0,
  width: 40, height: 12,
  border: 'single',          // 'none', 'single', 'double', 'rounded', 'heavy', 'ascii'
  borderColor: 7,
  title: 'Window Title',
  background: 0,
  zIndex: 0,
  visible: true,
});

win.print(x, y, text, fg, bg, attrs);
win.set(x, y, char, fg, bg, attrs);
win.fill(x, y, w, h, char, fg, bg);
win.clear();
win.show();
win.hide();
```

### Colors

```javascript
import { COLORS, colorToIndex, semanticColor } from './src/index.js';

COLORS.black        // 0
COLORS.red          // 1
COLORS.green        // 2
COLORS.yellow       // 3
COLORS.blue         // 4
COLORS.magenta      // 5
COLORS.cyan         // 6
COLORS.white        // 7
COLORS.brightBlack  // 8  (gray)
COLORS.brightRed    // 9
// ... etc

semanticColor('player')   // 11 (bright yellow)
semanticColor('enemy')    // 9  (bright red)
semanticColor('item')     // 14 (bright cyan)
```

## File Structure

```
apu/
├── src/
│   ├── index.js              # Main API
│   ├── core/
│   │   ├── grid.js           # Cell grid
│   │   └── window.js         # Window manager
│   └── renderers/
│       └── ansi-ibm.js       # IBM PC ANSI renderer
├── examples/
│   ├── hello.js              # Simple example
│   └── windows.js            # Window demo
└── README.md
```

## Next Steps

- [ ] Connect ObjectMUD to APU
- [ ] Add VT-100 pure ASCII renderer
- [ ] Add web/canvas renderer
- [ ] Add input handling
- [ ] Add layout engine
