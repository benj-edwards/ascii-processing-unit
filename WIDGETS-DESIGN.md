# APU Widget System Design

## Philosophy

**Games describe WHAT, APU handles HOW.**

```
Game says:  "Create a dialog at (10,5) with title 'Save File?' and OK/Cancel buttons"
APU does:   Draws window, border, title, buttons, handles focus, clicks, keyboard
Game gets:  {"type": "button_clicked", "window": "dialog1", "button": "ok"}
```

## Architecture Layers

```
┌─────────────────────────────────────────────────────────┐
│                    GAME (JSON API)                       │
│  "Create window", "Add button", "Set text"              │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│                   WIDGET LAYER (New)                     │
│  Menu, Button, TextInput, TextArea, Label, List         │
│  - Handles input → events                               │
│  - Manages focus                                        │
│  - Built-in behaviors                                   │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│                  WINDOW LAYER (Enhanced)                 │
│  - Automatic chrome (close, resize, drag)               │
│  - Contains widgets                                     │
│  - Z-ordering                                           │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│                   RENDER LAYER (Current)                 │
│  Grid, Cell, ANSI output                                │
└─────────────────────────────────────────────────────────┘
```

## Window Chrome (Automatic)

Every window gets automatic:
- **Title bar** with title text
- **Close button** `[×]` in top-left (configurable)
- **Resize handle** `◢` in bottom-right (if resizable)
- **Drag behavior** on title bar
- **Focus ring** when focused

```json
{
    "cmd": "create_window",
    "id": "main",
    "x": 5, "y": 3,
    "width": 40, "height": 15,
    "title": "My Window",
    "closable": true,
    "resizable": true,
    "draggable": true,
    "min_width": 20,
    "min_height": 8
}
```

**Events emitted automatically:**
```json
{"type": "window_moved", "id": "main", "x": 10, "y": 8}
{"type": "window_resized", "id": "main", "width": 50, "height": 20}
{"type": "window_close_requested", "id": "main"}
{"type": "window_focused", "id": "main"}
```

## Built-in Widgets

### Button

```json
{
    "cmd": "add_widget",
    "window": "dialog",
    "widget": "button",
    "id": "ok_btn",
    "x": 10, "y": 8,
    "label": "[ OK ]",
    "default": true,
    "hotkey": "enter"
}
```

**Events:**
```json
{"type": "button_clicked", "window": "dialog", "widget": "ok_btn"}
```

### Label

```json
{
    "cmd": "add_widget",
    "window": "main",
    "widget": "label",
    "id": "status",
    "x": 1, "y": 0,
    "text": "Ready",
    "fg": 10
}
```

### TextInput (Single Line)

```json
{
    "cmd": "add_widget",
    "window": "dialog",
    "widget": "text_input",
    "id": "filename",
    "x": 1, "y": 3,
    "width": 30,
    "value": "",
    "placeholder": "Enter filename...",
    "max_length": 255
}
```

**Events:**
```json
{"type": "text_changed", "window": "dialog", "widget": "filename", "value": "test.txt"}
{"type": "text_submitted", "window": "dialog", "widget": "filename", "value": "test.txt"}
```

**Built-in behaviors:**
- Cursor movement (arrow keys, home, end)
- Backspace, delete
- Text selection (shift+arrows)
- Copy/paste (if supported)

### TextArea (Multi-line)

```json
{
    "cmd": "add_widget",
    "window": "editor",
    "widget": "text_area",
    "id": "content",
    "x": 0, "y": 0,
    "width": 78, "height": 20,
    "value": "Initial text here...",
    "word_wrap": true,
    "line_numbers": false,
    "scrollable": true
}
```

**Built-in behaviors:**
- Multi-line editing
- Word wrap
- Scrolling
- Line numbers (optional)

### List / Select

```json
{
    "cmd": "add_widget",
    "window": "browser",
    "widget": "list",
    "id": "files",
    "x": 1, "y": 1,
    "width": 30, "height": 10,
    "items": [
        {"id": "f1", "label": "Document.txt", "icon": "📄"},
        {"id": "f2", "label": "Images/", "icon": "📁"},
        {"id": "f3", "label": "Music/", "icon": "📁"}
    ],
    "multi_select": false
}
```

**Events:**
```json
{"type": "list_selection_changed", "window": "browser", "widget": "files", "selected": ["f1"]}
{"type": "list_item_activated", "window": "browser", "widget": "files", "item": "f2"}
```

### Menu Bar

```json
{
    "cmd": "create_menu_bar",
    "menus": [
        {
            "id": "file",
            "label": "File",
            "items": [
                {"id": "new", "label": "New", "hotkey": "Ctrl+N"},
                {"id": "open", "label": "Open...", "hotkey": "Ctrl+O"},
                {"type": "separator"},
                {"id": "quit", "label": "Quit", "hotkey": "Ctrl+Q"}
            ]
        },
        {
            "id": "edit",
            "label": "Edit",
            "items": [
                {"id": "cut", "label": "Cut", "hotkey": "Ctrl+X"},
                {"id": "copy", "label": "Copy", "hotkey": "Ctrl+C"},
                {"id": "paste", "label": "Paste", "hotkey": "Ctrl+V"}
            ]
        }
    ]
}
```

**Events:**
```json
{"type": "menu_item_selected", "menu": "file", "item": "open"}
```

**Built-in behaviors:**
- Click to open dropdown
- Keyboard navigation (arrows, enter, escape)
- Hotkey handling
- Auto-close on selection or click outside

## Window Presets

Quick creation of common window types:

### Dialog

```json
{
    "cmd": "create_dialog",
    "id": "confirm",
    "x": 20, "y": 8,
    "title": "Confirm Delete",
    "message": "Are you sure you want to delete this file?",
    "buttons": ["ok", "cancel"],
    "default": "cancel",
    "icon": "warning"
}
```

### Input Dialog

```json
{
    "cmd": "create_input_dialog",
    "id": "rename",
    "title": "Rename File",
    "prompt": "Enter new name:",
    "value": "document.txt",
    "buttons": ["ok", "cancel"]
}
```

### File Browser

```json
{
    "cmd": "create_file_browser",
    "id": "open_file",
    "title": "Open File",
    "path": "/home/user",
    "filter": "*.txt",
    "show_hidden": false
}
```

## Focus Management

APU automatically manages focus:
- Tab cycles through focusable widgets
- Shift+Tab cycles backwards
- Clicking focuses widget
- Focused widget receives keyboard input

```json
{"cmd": "set_focus", "window": "dialog", "widget": "filename"}
{"cmd": "focus_next"}
{"cmd": "focus_prev"}
```

**Events:**
```json
{"type": "focus_changed", "window": "dialog", "widget": "filename", "prev_widget": "ok_btn"}
```

## Input Modes

### Raw Mode (Default)
All input forwarded to game as-is.

### Widget Mode
Input handled by focused widget, only high-level events sent to game.

```json
{"cmd": "set_input_mode", "mode": "widget"}
{"cmd": "set_input_mode", "mode": "raw"}
```

## Client Auto-Sync

When a new client connects, APU automatically:
1. Sends full display state
2. No game action required

## Custom Drawing

Still supported for flexibility:

```json
{"cmd": "set_direct", "x": 10, "y": 5, "char": "@", "fg": 10}
{"cmd": "print_direct", "x": 5, "y": 10, "text": "Custom!", "fg": 14}
```

Widgets can coexist with custom drawing.

## Implementation Priority

### Phase 1: Core Window Enhancement
- [ ] Window chrome (close, resize, drag) built-in
- [ ] Auto-emit window events (moved, resized, close_requested)
- [ ] Client auto-sync on connect

### Phase 2: Basic Widgets
- [ ] Label
- [ ] Button
- [ ] Focus management

### Phase 3: Input Widgets
- [ ] TextInput with full editing
- [ ] TextArea with word wrap

### Phase 4: Complex Widgets
- [ ] List/Select
- [ ] Menu bar with dropdowns

### Phase 5: Presets
- [ ] Dialog presets
- [ ] Input dialog
- [ ] File browser

## Example: Simple Game

```javascript
// Before (manual everything)
socket.on('data', (data) => {
    const event = JSON.parse(data);
    if (event.type === 'input' && event.event.type === 'mouse') {
        // Manually check if click is on button...
        if (isInsideButton(event.event.x, event.event.y, okButton)) {
            handleOkClick();
        }
    }
});

// After (APU handles it)
socket.on('data', (data) => {
    const event = JSON.parse(data);
    if (event.type === 'button_clicked' && event.widget === 'ok') {
        handleOkClick();
    }
});
```

The game code becomes purely about application logic, not UI mechanics.
