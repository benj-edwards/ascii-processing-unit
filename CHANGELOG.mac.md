# APU Mac 1984 Demo Changelog

## 2026-01-01 Session

### Bug Fix: File Drag-and-Drop Not Working

**Problem**: File drag-and-drop between Finder windows stopped working. Users could start dragging (ghost icon appeared) but dropping had no effect - the ghost stayed on screen.

**Root Cause**: Two issues combined:

1. **APU SGR Mouse Parsing Bug** (`src/input.rs`):
   - Motion events after button release were being tagged as `Release` instead of `Move`
   - The terminal sends motion events with lowercase 'm' terminator and `button=None`
   - The original code unconditionally set `event = Release` for any lowercase 'm'
   - Fix: Only set `event = Release` when `button != None`
   ```rust
   // Before (broken):
   if is_release {
       event = MouseEvent::Release;
   }

   // After (fixed):
   if is_release && button != MouseButton::None {
       event = MouseEvent::Release;
   }
   ```

2. **macOS Terminal Release Event Quirk** (`mac1984-finder.cjs`):
   - macOS Terminal.app sends button release events with `button=none` instead of `button=left`
   - The drop handler required `button === 'left' && mouseEvent === 'release'`
   - Fix: Also accept `button === 'none' && mouseEvent === 'release'` when there's an active file drag
   ```javascript
   // Now accepts either left release OR none release when dragging
   if (((button === 'left' && mouseEvent === 'release') ||
        (button === 'none' && mouseEvent === 'release' && sstate.fileDrag)) && sstate.fileDrag) {
   ```

**How to Verify**: After rebuilding APU (`cargo build --release`), file drag-and-drop should work - dragging a file to another Finder window moves it to that folder.

### Other Fixes

- **Editor isSelecting flag**: Fixed multiple code paths that exit editor mode without clearing the `isSelecting` flag, which was blocking file drags
- **Status bar text**: Changed MacWrite status bar from "^E=Exit" to "^E Release Cursor"
- **Cursor on empty lines**: Fixed cursor positioning glitch when navigating to empty/shorter lines

---

## 2025-12-29 Session

### APU Core Improvements

**Two-Layer Compositing Architecture**
- Added separate `background` and `display` buffers to WindowManager
- Background layer holds direct draws (desktop pattern, menu bar, icons)
- Display layer is the composited result (background + windows)
- `composite()` now copies background to display, then renders windows on top
- Fixes window dragging trails - windows no longer leave artifacts when moved

**Grid Enhancements**
- Added `copy_from()` method to Grid for efficient buffer copying

**Server Updates**
- `SetDirect`, `PrintDirect`, `Batch` (without window) now write to background buffer
- `Clear` command clears background buffer
- Proper layer separation for windowing system

### Input Handling

**Mouse Support**
- Full SGR extended mouse mode support (1006)
- Button tracking mode (1002) for drag events
- Parses mouse press, release, and drag events
- X and Y coordinates properly converted from 1-based to 0-based

**Known Issue - Y=0 Bug**
- Some terminals send spurious drag events with Y=0
- Workaround in demo: ignore drag events where Y=0
- Root cause likely mixed X10/SGR mouse event formats from terminal

### Mac 1984 Demo (`demos/mac1984.cjs`)

**Features**
- Classic Macintosh desktop simulation
- Menu bar with Apple, File, Edit, View, Special menus
- Desktop icons: Macintosh HD, Documents, Applications, Trash
- Draggable windows with title bars
- File browser windows showing simulated file system
- Double-click icons to open folder windows
- Click files to select, double-click to open folders
- Close button on windows

**Menu Actions**
- About This Mac... - Shows system info dialog
- Calculator - Opens calculator window
- New Folder - Creates empty folder window
- Shut Down - Shows shutdown message and exits
- Empty Trash - Clears trash

**Visual Style**
- Checkered desktop pattern using `░` character
- White menu bar with black text
- Single-line bordered windows
- Classic Mac-style file icons

### Files Modified

```
apu-rust/
├── src/
│   ├── core/
│   │   ├── grid.rs      # Added copy_from()
│   │   └── window.rs    # Two-layer architecture
│   ├── server.rs        # Background buffer usage
│   └── input.rs         # Mouse event parsing
└── demos/
    └── mac1984.cjs      # Mac 1984 desktop demo
```

### Running the Demo

```bash
# Terminal 1: Start APU server
cd apu-rust
cargo run -- 6122 6123

# Terminal 2: Start demo
node demos/mac1984.cjs 6122

# Terminal 3: Connect as client
telnet localhost 6123
```

### Controls
- **Mouse click** - Select icons, click menus, interact with windows
- **Drag** - Move windows by title bar
- **Q** - Quit demo
