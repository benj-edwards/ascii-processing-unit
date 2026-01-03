# APU (ASCII Processing Unit) Changelog

## [0.1.3] - 2025-12-30

### Added

#### Game Server Reconnection Support
- **Feature**: APU now notifies games about existing client sessions when a game server connects/reconnects
- **Problem Solved**: When a game server restarts while clients are connected, orphan windows would remain on screen from the old game instance
- **Solution**:
  - APU sends `client_connect` events for all existing sessions when a game server connects
  - Games can send a `reset` command to clear orphan windows before redrawing
  - Clients stay connected through game server restarts with seamless display recovery

- **Files Changed**:
  - `src/server.rs` - Added session notification on game connection

#### Window Invert Mode (APU Core)
- **New Feature**: Windows can now have `invert: true` property
- When enabled, the window inverts the colors (swaps fg/bg) of whatever is underneath
- Perfect for cursors, selection highlights, or any overlay effect
- Works across all layers - inverts desktop background AND window content

#### Mac 1984 Demo Enhancements
- **Keyboard Navigation**: Full keyboard control for users without a mouse
  - Arrow keys move an inverted cursor around the screen
  - Cursor displays as the character underneath with inverted colors (fg/bg swapped)
  - Uses APU's new `invert` window mode for true color inversion on any layer
  - Spacebar or Enter clicks at cursor position
  - Press Spacebar on window title bar → enter DRAG mode, use arrows to move window
  - Press Spacebar on resize handle → enter RESIZE mode, use arrows to resize
  - Spacebar again exits drag/resize mode
  - [DRAG] or [RESIZE] indicator appears in menu bar when active
- **Calculator from Applications**: Calculator can now be launched by double-clicking it in the Applications folder, not just from the Apple menu
- **Sliding Puzzle Game**: Added classic 15-puzzle game accessible from Apple menu
  - 4x4 grid with tiles 1-15
  - Click adjacent tiles to slide them into the empty space
  - Move counter tracks progress
  - Shuffled using valid moves to ensure solvability
- **Calculator Persistence**: Calculator window no longer goes blank when menus are opened (same fix pattern as About dialog)
- **Puzzle Persistence**: Puzzle game maintains state during menu interactions
- **About Dialog**: Updated to show "Macintosh System Software v1.0 / Benj Edwards / December 30, 2025"

#### Windows 3.1 Demo
- Created colorful Windows 3.1 desktop demo (`demos/win31.cjs`)
- Program Manager with program groups (Main, Accessories, Games, Applications)
- Colorful desktop icons
- Menu system with File, Options, Window, Help
- About dialog with Windows logo colors
- Running on commemorative port 1990

#### Commemorative Ports
- Mac 1984 demo on port 1984 (client), game port 1983
- Windows 3.1 demo on port 1990 (client), game port 1989

### Fixed

#### Text Editor Word Wrap
- Long lines in text editor now wrap within window bounds instead of extending past the edge
- Cursor position correctly tracked in wrapped display

## [0.1.2] - 2025-12-30

### Added

#### Clear Commands Documentation

APU is a universal ASCII display driver supporting all text-based applications: IRC, MUSHes, BBS games, ZZT, Zork, etc. The clearing commands are designed to support both windowed and non-windowed use cases:

| Command | Effect | Use Case |
|---------|--------|----------|
| `clear` | Clears background layer only | Refreshing desktop while preserving windows |
| `clear_background` | Alias for `clear` | Explicit name for windowed apps |
| `clear_window {id}` | Clears specific window content | Resetting a single window |
| `reset` | Destroys ALL windows AND clears background | Complete slate, switching game modes |

**For non-windowed apps** (IRC, MUSH, Zork, BBS):
- No windows exist, so `clear` clears the entire visible screen
- Works exactly like a traditional terminal clear

**For windowed apps** (Mac GUI, dialog systems):
- `clear` refreshes the background/desktop without destroying windows
- Windows persist with their content intact
- Use `reset` when you need a complete fresh start

### Fixed

#### Window Content Disappearing on Redraw

- **Problem**: Windows with static content (like "About This Macintosh") would go blank when other UI elements were redrawn (e.g., opening a menu).

- **Root Cause Investigation**:
  1. Initial theory: `clear` command was wiping windows → Fixed by making `clear` only affect background layer
  2. Initial theory: `create_window` was replacing windows → Fixed by making it idempotent (preserve content)
  3. **Actual root cause**: When `create_window` was called on an existing window with a *different border style*, `set_border()` would call `resize()` on the content grid, and `resize()` creates a fresh cell array: `self.cells = vec![Cell::default(); cols * rows]` - wiping all content!

- **The Trigger**: The About window was created with `border: 'double'`, but the generic `drawWindow()` function called `create_window` with `border: 'single'`. This border mismatch triggered a resize, destroying the content.

- **Solution** (in mac1984.cjs): Windows with `staticContent: true` now skip `drawWindow()` entirely during desktop redraws. They just get brought to front without being re-created.

- **Files Changed**:
  - `src/core/window.rs` - `create_window` made idempotent
  - `src/server.rs` - `clear` only clears background
  - `mac1984.cjs` - Added `staticContent` flag, skip redraw for static windows

#### Idempotent Window Creation
- `create_window` now preserves existing window content if the window already exists
- Only updates position; resizes only if dimensions changed
- Prevents accidental content loss when re-calling create_window

#### New Commands Added
- `reset` - Nuclear option: destroys ALL windows AND clears background
- `clear_background` - Explicit alias for `clear` (for clarity in windowed apps)
- `clear_all_windows()` method added to WindowManager

## [0.1.1] - 2025-12-30

### Fixed

#### ANSI Color Attribute Bleeding Bug
- **Problem**: A subtle brightness artifact appeared on specific screen rows, particularly visible on the window title bar row. The desktop pattern to the right of windows appeared brighter than the rest of the screen.

- **Root Cause**: After emitting an SGR reset sequence (`ESC[0m`) to turn off text attributes like bold, the renderer assumed the terminal was in an explicit "White foreground / Black background" state. However, terminals after reset are actually in their "default" state, which may look similar but isn't the same as explicitly setting colors 37/40.

  When the next cell happened to have White/Black colors (matching what we *thought* the terminal had), no color codes were emitted. But since the terminal was at "default" rather than explicit White/Black, subsequent color changes could produce unexpected results.

- **Solution**: After emitting a reset, the renderer now sets its internal color tracking to an unlikely sentinel value (BrightMagenta) instead of White/Black. This forces the actual cell colors to always be explicitly emitted after any reset, ensuring the terminal state matches what we expect.

- **Technical Details** (`src/renderer/ansi_ibm.rs`):
  ```rust
  // Before (buggy):
  if needs_reset {
      codes.push(0); // Reset
      self.current_fg = Color::White;  // Assumed terminal state
      self.current_bg = Color::Black;
  }

  // After (fixed):
  if needs_reset {
      codes.push(0); // Reset
      // Use sentinel to force color output - terminal is at "default", not White/Black
      self.current_fg = Color::BrightMagenta;
      self.current_bg = Color::BrightMagenta;
  }
  ```

- **Files Changed**: `src/renderer/ansi_ibm.rs`

### Also Fixed in This Session

#### Control Character Sanitization
- Characters below ASCII 32 (space) and DEL (0x7F) are now replaced with spaces in the renderer to prevent terminal corruption from stray control characters in cell data.

#### Backspace Key Parsing
- Fixed input parser not recognizing DEL (0x7F) as backspace because the condition `first < 32` didn't include 127.

## [0.1.0] - 2025-12-29

### Added
- Initial APU implementation
- IBM PC ANSI renderer with 16-color support
- Window management with compositing
- Mouse input parsing (X10 and SGR extended modes)
- Keyboard input parsing with escape sequence handling
- Session-based multi-client support
- JSON command protocol for external control
