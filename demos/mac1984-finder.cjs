#!/usr/bin/env node
/**
 * Mac 1984 Enhanced Finder Demo
 * Full Finder with icon view and drag-and-drop between windows.
 * Test version - run on port 6121/6122
 */

const net = require('net');

const GAME_PORT = process.argv[2] || 6121;  // Test port for enhanced Finder
const COLS = 80;
const ROWS = 24;
const BLACK = 0, WHITE = 7, BRIGHT_WHITE = 15, GRAY = 8;

// Per-session state - each connected client has their own desktop
const sessions = new Map();

function getSessionState(sessionId) {
    if (!sessions.has(sessionId)) {
        // Create screen buffer to track what's displayed (for cursor inversion)
        const screenBuffer = [];
        for (let y = 0; y < ROWS; y++) {
            screenBuffer[y] = [];
            for (let x = 0; x < COLS; x++) {
                screenBuffer[y][x] = { char: ' ', fg: WHITE, bg: BLACK };
            }
        }
        sessions.set(sessionId, {
            menuOpen: null,
            selectedIcon: null,
            windows: [],
            nextWindowId: 1,
            // Keyboard cursor for navigation (arrow keys + spacebar)
            cursorX: 40,
            cursorY: 12,
            cursorVisible: false,  // Only show when keyboard is used
            // Drag/resize mode
            dragMode: null,        // null, 'drag', or 'resize'
            dragWindowId: null,    // Window being dragged/resized
            // File drag state for drag-and-drop between windows
            fileDrag: null,        // { file, sourceWindow, startX, startY }
            // Screen buffer for cursor inversion
            screenBuffer: screenBuffer,
        });
    }
    return sessions.get(sessionId);
}

// Legacy state for backward compatibility (first session)
const state = {
    menuOpen: null,
    selectedIcon: null,
    windows: [],
    nextWindowId: 1,
};

// Desktop icons
const icons = [
    { id: 'hd', name: 'Macintosh HD', x: 72, y: 3, char: '\u2587', selected: false },
    { id: 'docs', name: 'Documents', x: 72, y: 7, char: '\u25A4', selected: false },
    { id: 'apps', name: 'Applications', x: 72, y: 11, char: '\u25A4', selected: false },
    { id: 'trash', name: 'Trash', x: 72, y: 19, char: '\u25A8', selected: false },
];

// Simulated file system
const fileSystem = {
    'Macintosh HD': [
        { name: 'System Folder', type: 'folder', icon: '\u25A4' },
        { name: 'Applications', type: 'folder', icon: '\u25A4' },
        { name: 'Documents', type: 'folder', icon: '\u25A4' },
        { name: 'ReadMe.txt', type: 'file', icon: '\u25A2' },
    ],
    'Documents': [
        { name: 'Letter.txt', type: 'file', icon: '\u25A2' },
        { name: 'Budget.calc', type: 'file', icon: '\u25A2' },
        { name: 'Photos', type: 'folder', icon: '\u25A4' },
    ],
    'Applications': [
        { name: 'MacWrite', type: 'app', icon: '\u25C8' },
        { name: 'MacPaint', type: 'app', icon: '\u25C8' },
        { name: 'Calculator', type: 'app', icon: '\u25C8' },
    ],
    'System Folder': [
        { name: 'System', type: 'file', icon: '\u25A2' },
        { name: 'Finder', type: 'app', icon: '\u25C8' },
    ],
    'Photos': [
        { name: 'Vacation.pic', type: 'file', icon: '\u25A2' },
        { name: 'Family.pic', type: 'file', icon: '\u25A2' },
    ],
    'Trash': [],
};

// Virtual file contents (editable text)
const fileContents = {
    'ReadMe.txt': 'Welcome to Macintosh!\n\nThis is your new computer.\nDouble-click files to open them.',
    'Letter.txt': 'Dear Friend,\n\nI hope this letter finds you well.\n\nBest regards',
    'Budget.calc': '100 + 200 = 300\n50 * 4 = 200\nTotal: 500',
};

const menus = {
    apple: { x: 1, label: '@', items: ['About This Mac...', '-', 'Calculator', 'Puzzle'] },
    file: { x: 4, label: 'File', items: ['New Folder', 'Open', 'Close', '-', 'Shut Down'] },
    edit: { x: 10, label: 'Edit', items: ['Undo', '-', 'Cut', 'Copy', 'Paste'] },
    view: { x: 16, label: 'View', items: ['\u2713 by Icon', '  by List', '-', '  Clean Up'] },
    special: { x: 22, label: 'Special', items: ['Empty Trash...', '-', 'Shut Down'] },
};

// Icon dimensions for grid layout
const ICON_WIDTH = 10;   // Width of each icon cell
const ICON_HEIGHT = 4;   // Height of each icon cell (icon + name)

function cmd(obj) { return JSON.stringify(obj); }

class APUClient {
    constructor() {
        this.socket = null;
        this.buffer = '';
    }

    connect() {
        return new Promise((resolve, reject) => {
            this.socket = net.createConnection(GAME_PORT, 'localhost', () => {
                console.log('Connected to APU server');
                resolve();
            });
            this.socket.on('data', (data) => {
                this.buffer += data.toString();
                this.processBuffer();
            });
            this.socket.on('error', reject);
            this.socket.on('close', () => process.exit(0));
        });
    }

    processBuffer() {
        const lines = this.buffer.split('\n');
        this.buffer = lines.pop();
        for (const line of lines) {
            if (line.trim()) {
                try {
                    const event = JSON.parse(line);
                    if (event.type === 'input') {
                        // Input events now include session ID
                        handleInput(event.session, event.event);
                    } else if (event.type === 'client_connect') {
                        console.log(`Client connected: ${event.session}`);

                        // Reset APU display to clear any orphan windows from previous game instance
                        // This handles game server restarts while clients stay connected
                        apu.sendTo(event.session, { cmd: 'reset' });

                        // Initialize this session's display
                        const sessionState = getSessionState(event.session);

                        // Send init commands to this specific session
                        apu.sendTo(event.session, { cmd: 'init', cols: COLS, rows: ROWS });
                        apu.sendTo(event.session, { cmd: 'enable_mouse', mode: 'sgr' });

                        // Create initial window for this session
                        const win = {
                            id: `win_${sessionState.nextWindowId++}`,
                            title: 'Macintosh HD',
                            x: 3, y: 3,
                            width: 30,
                            height: Math.min(fileSystem['Macintosh HD'].length + 5, 12),
                            files: fileSystem['Macintosh HD'],
                            selectedFile: -1
                        };
                        sessionState.windows.push(win);
                        setTimeout(() => this.redrawSession(event.session), 100);
                    } else if (event.type === 'client_disconnect') {
                        console.log(`Client disconnected: ${event.session}`);
                        sessions.delete(event.session);
                    } else if (event.type === 'window_close_requested') {
                        // Window close - need to find which session owns it
                        // For now, check all sessions
                        for (const [sid, sstate] of sessions) {
                            handleWindowClose(sid, event.id);
                        }
                    } else if (event.type === 'window_moved') {
                        for (const [sid, sstate] of sessions) {
                            handleWindowMoved(sid, event.id, event.x, event.y);
                        }
                    } else if (event.type === 'window_resized') {
                        for (const [sid, sstate] of sessions) {
                            handleWindowResized(sid, event.id, event.width, event.height);
                        }
                    } else if (event.type === 'window_focused') {
                        for (const [sid, sstate] of sessions) {
                            handleWindowFocused(sid, event.id);
                        }
                    } else if (event.type === 'sessions') {
                        console.log(`Active sessions: ${event.sessions.map(s => s.id).join(', ')}`);
                    }
                } catch (e) {}
            }
        }
    }

    send(command) {
        if (this.socket?.writable) {
            this.socket.write(command + '\n');
        }
    }

    // Send command to a specific session
    sendTo(sessionId, obj) {
        this.send(JSON.stringify({ ...obj, session: sessionId }));
    }

    async init() {
        // Don't broadcast init - each session is initialized when it connects
        // This just waits for the connection to be ready
        await new Promise(r => setTimeout(r, 50));
    }

    redraw() { drawDesktop(null); }  // Broadcast to all
    redrawSession(sessionId) { drawDesktop(sessionId); }
}

const apu = new APUClient();

// Helper to send command to session (or broadcast if null)
// Also tracks what's being drawn for cursor inversion
function sendCmd(sessionId, obj) {
    // Track screen buffer for cursor inversion
    if (sessionId) {
        const sstate = getSessionState(sessionId);
        trackScreenBuffer(sstate, obj);
        apu.sendTo(sessionId, obj);
    } else {
        apu.send(cmd(obj));
    }
}

// Track what's being drawn to the screen buffer
function trackScreenBuffer(sstate, obj) {
    if (!sstate.screenBuffer) return;

    const buf = sstate.screenBuffer;

    if (obj.cmd === 'set_direct' && obj.x >= 0 && obj.x < COLS && obj.y >= 0 && obj.y < ROWS) {
        buf[obj.y][obj.x] = { char: obj.char || ' ', fg: obj.fg ?? WHITE, bg: obj.bg ?? BLACK };
    } else if (obj.cmd === 'print_direct' && obj.text) {
        const y = obj.y;
        if (y >= 0 && y < ROWS) {
            for (let i = 0; i < obj.text.length; i++) {
                const x = obj.x + i;
                if (x >= 0 && x < COLS) {
                    buf[y][x] = { char: obj.text[i], fg: obj.fg ?? WHITE, bg: obj.bg ?? BLACK };
                }
            }
        }
    } else if (obj.cmd === 'batch' && obj.cells) {
        for (const cell of obj.cells) {
            if (cell.x >= 0 && cell.x < COLS && cell.y >= 0 && cell.y < ROWS) {
                buf[cell.y][cell.x] = { char: cell.char || ' ', fg: cell.fg ?? WHITE, bg: cell.bg ?? BLACK };
            }
        }
    } else if (obj.cmd === 'clear') {
        // Clear buffer to desktop pattern
        for (let y = 0; y < ROWS; y++) {
            for (let x = 0; x < COLS; x++) {
                buf[y][x] = { char: ' ', fg: WHITE, bg: BLACK };
            }
        }
    }
    // Note: Window content is drawn with 'print' command which uses window-relative coords
    // For simplicity, we track direct commands; window areas will show underlying desktop
}

function drawDesktop(sessionId) {
    // Get session-specific state, or use global state for broadcast
    const sstate = sessionId ? getSessionState(sessionId) : state;

    // Clear everything first
    sendCmd(sessionId, { cmd: 'clear' });

    // Build batch for desktop pattern - solid gradient
    const cells = [];
    for (let y = 1; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
            cells.push({
                x, y,
                char: '\u2591',  // ░ light shade - solid pattern
                fg: GRAY,
                bg: BLACK
            });
        }
    }
    sendCmd(sessionId, { cmd: 'batch', cells });

    // Menu bar - use batch too
    const menuCells = [];
    for (let x = 0; x < COLS; x++) {
        menuCells.push({ x, y: 0, char: ' ', fg: BLACK, bg: WHITE });
    }
    sendCmd(sessionId, { cmd: 'batch', cells: menuCells });

    // Menu labels
    sendCmd(sessionId, { cmd: 'print_direct', x: 1, y: 0, text: '@', fg: BLACK, bg: WHITE });
    sendCmd(sessionId, { cmd: 'print_direct', x: 4, y: 0, text: 'File', fg: BLACK, bg: WHITE });
    sendCmd(sessionId, { cmd: 'print_direct', x: 10, y: 0, text: 'Edit', fg: BLACK, bg: WHITE });
    sendCmd(sessionId, { cmd: 'print_direct', x: 16, y: 0, text: 'View', fg: BLACK, bg: WHITE });
    sendCmd(sessionId, { cmd: 'print_direct', x: 22, y: 0, text: 'Special', fg: BLACK, bg: WHITE });

    // Time
    const time = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    sendCmd(sessionId, { cmd: 'print_direct', x: COLS - time.length - 1, y: 0, text: time, fg: BLACK, bg: WHITE });

    // Desktop icons (shared across all sessions)
    for (const icon of icons) {
        const fg = icon.selected ? BLACK : BRIGHT_WHITE;
        const bg = icon.selected ? WHITE : BLACK;
        sendCmd(sessionId, { cmd: 'set_direct', x: icon.x, y: icon.y, char: icon.char, fg, bg });
        // Label below icon
        const label = icon.name.length > 12 ? icon.name.substring(0, 11) + '.' : icon.name;
        const lx = icon.x - Math.floor(label.length / 2) + 1;
        sendCmd(sessionId, { cmd: 'print_direct', x: Math.max(0, lx), y: icon.y + 1, text: label, fg, bg });
    }

    // Draw windows (session-specific)
    for (const win of sstate.windows) { if (win.staticContent || win.isCalculator || win.isPuzzle) { sendCmd(sessionId, { cmd: "bring_to_front", id: win.id }); continue; }
        drawWindow(sessionId, win);
    }

    // Dropdown menu if open (session-specific)
    if (sstate.menuOpen) {
        drawDropdown(sessionId, sstate.menuOpen);
    }

    // Draw keyboard cursor if visible (after everything else)
    drawCursor(sessionId);

    // Show drag/resize mode indicator in menu bar
    if (sstate.dragMode) {
        const modeText = sstate.dragMode === 'drag' ? '[DRAG]' : '[RESIZE]';
        sendCmd(sessionId, { cmd: 'print_direct', x: 35, y: 0, text: modeText, fg: WHITE, bg: BLACK });
    }

    // Flush to render
    sendCmd(sessionId, { cmd: 'flush', force_full: true });
}

function drawWindow(sessionId, win) {
    // Create window with automatic chrome (close button, resize handle, dragging)
    // APU handles all the chrome automatically now!
    sendCmd(sessionId, {
        cmd: 'create_window',
        id: win.id,
        x: win.x,
        y: win.y,
        width: win.width,
        height: win.height,
        border: 'single',
        title: win.title,
        closable: true,     // APU draws close button automatically
        resizable: true,    // APU draws resize handle automatically
        draggable: true,    // APU handles dragging automatically
        min_width: 10,
        min_height: 5
    });

    // Fill window background
    if (!win.staticContent) sendCmd(sessionId, {
        cmd: 'fill',
        window: win.id,
        x: 0, y: 0,
        width: win.width - 2,
        height: win.height - 2,
        char: ' ',
        fg: BLACK,
        bg: WHITE
    });

    // Draw files based on view mode
    if (win.files) {
        if (win.viewMode === 'icon') {
            // Icon view: grid of icons
            drawIconView(sessionId, win);
        } else {
            // List view: compact list
            drawListView(sessionId, win);
        }

        // Item count at bottom
        const count = win.files.length;
        sendCmd(sessionId, {
            cmd: 'print',
            window: win.id,
            x: 1,
            y: win.height - 4,
            text: `${count} item${count !== 1 ? 's' : ''}`,
            fg: GRAY,
            bg: WHITE
        });
    }

    sendCmd(sessionId, { cmd: 'bring_to_front', id: win.id });
}

// Draw files in icon view (grid of icons)
function drawIconView(sessionId, win) {
    const iconsPerRow = Math.floor((win.width - 4) / ICON_WIDTH);
    const contentHeight = win.height - 5;  // Leave room for border and item count

    for (let i = 0; i < win.files.length; i++) {
        const f = win.files[i];
        const selected = win.selectedFile === i;

        const col = i % iconsPerRow;
        const row = Math.floor(i / iconsPerRow);

        const iconX = 1 + col * ICON_WIDTH + Math.floor(ICON_WIDTH / 2) - 1;
        const iconY = row * ICON_HEIGHT;

        // Skip if outside visible area
        if (iconY >= contentHeight) continue;

        // Draw large icon (2x2 block for folders, different for files)
        const iconChar = f.type === 'folder' ? '\u2587' :
                        f.type === 'app' ? '\u25C8' : '\u25A1';

        // Icon background highlight if selected
        if (selected) {
            sendCmd(sessionId, {
                cmd: 'fill',
                window: win.id,
                x: col * ICON_WIDTH + 1,
                y: iconY,
                width: ICON_WIDTH - 1,
                height: ICON_HEIGHT - 1,
                char: ' ',
                fg: WHITE,
                bg: BLACK
            });
        }

        // Draw icon
        sendCmd(sessionId, {
            cmd: 'print',
            window: win.id,
            x: iconX,
            y: iconY,
            text: iconChar + iconChar,
            fg: selected ? WHITE : BLACK,
            bg: selected ? BLACK : WHITE
        });

        // Draw filename below icon (truncate to fit)
        const maxNameLen = ICON_WIDTH - 1;
        const displayName = f.name.length > maxNameLen ?
            f.name.substring(0, maxNameLen - 1) + '…' : f.name;

        const nameX = col * ICON_WIDTH + 1 + Math.floor((ICON_WIDTH - 1 - displayName.length) / 2);
        sendCmd(sessionId, {
            cmd: 'print',
            window: win.id,
            x: Math.max(1, nameX),
            y: iconY + 2,
            text: displayName,
            fg: selected ? WHITE : BLACK,
            bg: selected ? BLACK : WHITE
        });
    }
}

// Get file index at local coordinates based on view mode
function getFileAtPosition(win, localX, localY) {
    if (win.viewMode === 'icon') {
        // Icon view: grid layout
        const iconsPerRow = Math.floor((win.width - 4) / ICON_WIDTH);
        const col = Math.floor(localX / ICON_WIDTH);
        const row = Math.floor(localY / ICON_HEIGHT);
        const idx = row * iconsPerRow + col;
        if (idx >= 0 && idx < win.files.length) {
            return idx;
        }
        return -1;
    } else {
        // List view: one file per row
        return localY;
    }
}

// Draw files in list view (compact list)
function drawListView(sessionId, win) {
    for (let i = 0; i < win.files.length && i < win.height - 5; i++) {
        const f = win.files[i];
        const selected = win.selectedFile === i;
        const text = `${f.icon} ${f.name}`;
        sendCmd(sessionId, {
            cmd: 'print',
            window: win.id,
            x: 1,
            y: i,
            text: text.substring(0, win.width - 4),
            fg: selected ? WHITE : BLACK,
            bg: selected ? BLACK : WHITE
        });
    }
}

function drawDropdown(sessionId, menuName) {
    const menu = menus[menuName];
    if (!menu) return;

    const w = Math.max(...menu.items.map(i => i.length)) + 4;
    const h = menu.items.length + 2;

    sendCmd(sessionId, {
        cmd: 'create_window',
        id: 'dropdown',
        x: menu.x,
        y: 1,
        width: w,
        height: h,
        border: 'single',
        closable: false,    // No close button on dropdown
        resizable: false,   // No resize handle
        draggable: false    // Can't drag dropdown
    });

    sendCmd(sessionId, {
        cmd: 'fill',
        window: 'dropdown',
        x: 0, y: 0,
        width: w - 2,
        height: h - 2,
        char: ' ',
        fg: BLACK,
        bg: WHITE
    });

    for (let i = 0; i < menu.items.length; i++) {
        const item = menu.items[i];
        if (item === '-') {
            sendCmd(sessionId, {
                cmd: 'print',
                window: 'dropdown',
                x: 0,
                y: i,
                text: '-'.repeat(w - 2),
                fg: GRAY,
                bg: WHITE
            });
        } else {
            sendCmd(sessionId, {
                cmd: 'print',
                window: 'dropdown',
                x: 1,
                y: i,
                text: item,
                fg: BLACK,
                bg: WHITE
            });
        }
    }

    sendCmd(sessionId, { cmd: 'bring_to_front', id: 'dropdown' });
}

function createWindow(sessionId, title, files, x, y, viewMode = 'icon') {
    const sstate = getSessionState(sessionId);

    // Calculate window size based on view mode
    let width, height;
    if (viewMode === 'icon') {
        // Icon view: grid layout - calculate based on number of icons
        const iconsPerRow = 4;
        const rows = Math.ceil(files.length / iconsPerRow);
        width = iconsPerRow * ICON_WIDTH + 4;  // 4 icons wide + padding
        height = Math.min(rows * ICON_HEIGHT + 4, 16);  // Grid rows + chrome
    } else {
        // List view: compact vertical list
        width = 30;
        height = Math.min(files.length + 5, 12);
    }

    const win = {
        id: `win_${sstate.nextWindowId++}`,
        title,
        x: x ?? (5 + sstate.windows.length * 3),
        y: y ?? (3 + sstate.windows.length * 2),
        width,
        height,
        files,
        selectedFile: -1,
        viewMode,         // 'icon' or 'list'
        folderPath: title // Track the folder path for file operations
    };
    sstate.windows.push(win);
    return win;
}

// Window event handlers - APU now handles chrome automatically!
function handleWindowClose(sessionId, windowId) {
    const sstate = getSessionState(sessionId);
    const idx = sstate.windows.findIndex(w => w.id === windowId);
    if (idx >= 0) {
        console.log(`Window close requested: ${windowId} (session ${sessionId})`);
        const win = sstate.windows[idx];
        // Clear active editor if closing it
        if (win.isEditor && sstate.activeEditor === windowId) {
            sstate.activeEditor = null;
        }
        sstate.windows.splice(idx, 1);
        sendCmd(sessionId, { cmd: 'remove_window', id: windowId });
        sendCmd(sessionId, { cmd: 'flush', force_full: false });
    }
}

function handleWindowMoved(sessionId, windowId, newX, newY) {
    const sstate = getSessionState(sessionId);
    const win = sstate.windows.find(w => w.id === windowId);
    if (win) {
        console.log(`Window moved: ${windowId} to (${newX}, ${newY}) (session ${sessionId})`);
        win.x = newX;
        win.y = newY;
        // Just flush, APU already moved the window
        sendCmd(sessionId, { cmd: 'flush', force_full: false });
    }
}

function handleWindowResized(sessionId, windowId, newWidth, newHeight) {
    const sstate = getSessionState(sessionId);
    const win = sstate.windows.find(w => w.id === windowId);
    if (win) {
        console.log(`Window resized: ${windowId} to ${newWidth}x${newHeight} (session ${sessionId})`);
        win.width = newWidth;
        win.height = newHeight;
        // Redraw window content for new size - use appropriate draw function
        if (win.isEditor) {
            drawTextEditor(sessionId, win);
        } else {
            drawWindow(sessionId, win);
        }
        sendCmd(sessionId, { cmd: 'flush', force_full: true });
    }
}

function handleWindowFocused(sessionId, windowId) {
    const sstate = getSessionState(sessionId);
    // Move window to front of our list
    const idx = sstate.windows.findIndex(w => w.id === windowId);
    if (idx >= 0) {
        console.log(`Window focused: ${windowId} (session ${sessionId})`);
        const win = sstate.windows.splice(idx, 1)[0];
        sstate.windows.push(win);
    }
}

function handleInput(sessionId, event) {
    if (event.type === 'mouse') {
        // Hide keyboard cursor when mouse is used
        const sstate = getSessionState(sessionId);
        sstate.cursorVisible = false;
        sstate.dragMode = null;  // Exit any drag mode
        handleMouse(sessionId, event);
    } else if (event.type === 'key') {
        // Arrow keys, enter, backspace, etc.
        console.log(`Key from ${sessionId}: ${event.key}`);

        // Try editor first
        if (handleEditorInput(sessionId, null, event.key)) return;

        // Handle keyboard cursor navigation (including drag mode)
        if (handleKeyboardCursor(sessionId, event.key)) return;
    } else if (event.type === 'char') {
        // Try editor first
        if (handleEditorInput(sessionId, event.char, null)) return;

        const sstate = getSessionState(sessionId);

        // Spacebar handling
        if (event.char === ' ' && !sstate.activeEditor) {
            sstate.cursorVisible = true;

            // If already in drag mode, exit it
            if (sstate.dragMode) {
                console.log(`Exiting ${sstate.dragMode} mode`);
                sstate.dragMode = null;
                sstate.dragWindowId = null;
                apu.redrawSession(sessionId);
                return;
            }

            // Check if we should enter drag or resize mode
            const dragInfo = checkDragTarget(sessionId, sstate.cursorX, sstate.cursorY);
            if (dragInfo) {
                sstate.dragMode = dragInfo.mode;
                sstate.dragWindowId = dragInfo.windowId;
                console.log(`Entering ${sstate.dragMode} mode for window ${sstate.dragWindowId}`);
                apu.redrawSession(sessionId);
                return;
            }

            // Otherwise just click
            simulateClick(sessionId, sstate.cursorX, sstate.cursorY);
            return;
        }

        // Escape exits drag mode
        if (event.char === '\x1b' && sstate.dragMode) {
            sstate.dragMode = null;
            sstate.dragWindowId = null;
            apu.redrawSession(sessionId);
            return;
        }

        // Only handle Q if no editor is active
        if (!sstate.activeEditor) {
            console.log(`Char from ${sessionId}: ${event.char}`);
            if (event.char === 'q' || event.char === 'Q') {
                process.exit(0);
            }
        }
    }
}

// Check if cursor is over a draggable/resizable part of a window
function checkDragTarget(sessionId, x, y) {
    const sstate = getSessionState(sessionId);

    // Check windows from front to back
    for (let i = sstate.windows.length - 1; i >= 0; i--) {
        const win = sstate.windows[i];

        // Check title bar (top edge of window, excluding close button area)
        if (y === win.y && x >= win.x + 2 && x < win.x + win.width - 1) {
            return { mode: 'drag', windowId: win.id };
        }

        // Check resize handle (bottom-right corner)
        if (y === win.y + win.height - 1 && x === win.x + win.width - 1) {
            return { mode: 'resize', windowId: win.id };
        }

        // If cursor is inside window but not on drag/resize areas, don't drag
        if (x >= win.x && x < win.x + win.width && y >= win.y && y < win.y + win.height) {
            return null;
        }
    }

    return null;
}

// Handle arrow key navigation
function handleKeyboardCursor(sessionId, key) {
    const sstate = getSessionState(sessionId);

    // If in drag or resize mode, arrow keys move/resize the window
    if (sstate.dragMode && sstate.dragWindowId) {
        const win = sstate.windows.find(w => w.id === sstate.dragWindowId);
        if (win) {
            if (sstate.dragMode === 'drag') {
                // Move window
                let dx = 0, dy = 0;
                switch (key) {
                    case 'up': dy = -1; break;
                    case 'down': dy = 1; break;
                    case 'left': dx = -1; break;
                    case 'right': dx = 1; break;
                }
                if (dx !== 0 || dy !== 0) {
                    const newX = Math.max(0, Math.min(COLS - win.width, win.x + dx));
                    const newY = Math.max(1, Math.min(ROWS - win.height, win.y + dy));
                    if (newX !== win.x || newY !== win.y) {
                        win.x = newX;
                        win.y = newY;
                        // Move cursor with window
                        sstate.cursorX = Math.max(0, Math.min(COLS - 1, sstate.cursorX + dx));
                        sstate.cursorY = Math.max(0, Math.min(ROWS - 1, sstate.cursorY + dy));
                        // Tell APU to move the window
                        sendCmd(sessionId, { cmd: 'move_window', id: win.id, x: win.x, y: win.y });
                        apu.redrawSession(sessionId);
                    }
                    return true;
                }
            } else if (sstate.dragMode === 'resize') {
                // Resize window
                let dw = 0, dh = 0;
                switch (key) {
                    case 'up': dh = -1; break;
                    case 'down': dh = 1; break;
                    case 'left': dw = -1; break;
                    case 'right': dw = 1; break;
                }
                if (dw !== 0 || dh !== 0) {
                    const minW = 10, minH = 5;
                    const newW = Math.max(minW, Math.min(COLS - win.x, win.width + dw));
                    const newH = Math.max(minH, Math.min(ROWS - win.y, win.height + dh));
                    if (newW !== win.width || newH !== win.height) {
                        win.width = newW;
                        win.height = newH;
                        // Move cursor with resize handle
                        sstate.cursorX = win.x + win.width - 1;
                        sstate.cursorY = win.y + win.height - 1;
                        // Tell APU to resize the window
                        sendCmd(sessionId, { cmd: 'resize_window', id: win.id, width: win.width, height: win.height });
                        // Redraw window content
                        if (win.isEditor) {
                            drawTextEditor(sessionId, win);
                        } else if (!win.staticContent && !win.isCalculator && !win.isPuzzle) {
                            drawWindow(sessionId, win);
                        }
                        apu.redrawSession(sessionId);
                    }
                    return true;
                }
            }
        }
        return false;
    }

    // Normal cursor movement
    let moved = false;

    switch (key) {
        case 'up':
            if (sstate.cursorY > 0) { sstate.cursorY--; moved = true; }
            break;
        case 'down':
            if (sstate.cursorY < ROWS - 1) { sstate.cursorY++; moved = true; }
            break;
        case 'left':
            if (sstate.cursorX > 0) { sstate.cursorX--; moved = true; }
            break;
        case 'right':
            if (sstate.cursorX < COLS - 1) { sstate.cursorX++; moved = true; }
            break;
        case 'enter':
            // Enter also acts as click (or exits drag mode)
            if (sstate.dragMode) {
                sstate.dragMode = null;
                sstate.dragWindowId = null;
                apu.redrawSession(sessionId);
                return true;
            }
            sstate.cursorVisible = true;
            simulateClick(sessionId, sstate.cursorX, sstate.cursorY);
            return true;
    }

    if (moved) {
        sstate.cursorVisible = true;
        // Redraw desktop to clear old cursor position and show new one
        apu.redrawSession(sessionId);
        return true;
    }

    return false;
}

// Draw keyboard cursor indicator - uses a tiny invert window to appear on top of everything
function drawCursor(sessionId) {
    const sstate = getSessionState(sessionId);

    if (!sstate.cursorVisible) {
        // Remove cursor window if cursor is hidden
        apu.sendTo(sessionId, { cmd: 'remove_window', id: 'kbd_cursor' });
        return;
    }

    // Create a tiny 1x1 invert window for the cursor that floats on top of everything
    // The invert flag tells APU to swap fg/bg of whatever is underneath - no need
    // for us to track what's on screen, APU does it automatically!
    apu.sendTo(sessionId, {
        cmd: 'create_window',
        id: 'kbd_cursor',
        x: sstate.cursorX,
        y: sstate.cursorY,
        width: 1,
        height: 1,
        border: 'none',
        closable: false,
        resizable: false,
        draggable: false,
        invert: true  // Magic! Inverts colors of whatever is underneath
    });

    // Always bring cursor to front
    apu.sendTo(sessionId, { cmd: 'bring_to_front', id: 'kbd_cursor' });
}

// Simulate a mouse click at cursor position
function simulateClick(sessionId, x, y) {
    console.log(`Simulated click at (${x}, ${y})`);
    // Create a synthetic mouse event
    handleMouse(sessionId, {
        x: x,
        y: y,
        button: 'left',
        event: 'press'
    });
}

function handleMouse(sessionId, e) {
    const sstate = getSessionState(sessionId);
    const { x, y, button, event: mouseEvent } = e;

    // APU now handles window chrome (close, drag, resize) automatically!
    // We only need to handle: menus, window content clicks, desktop icons

    if (button === 'left' && mouseEvent === 'press') {
        // Menu bar click
        if (y === 0) {
            let clickedMenu = null;
            if (x >= 1 && x < 3) clickedMenu = 'apple';
            else if (x >= 4 && x < 8) clickedMenu = 'file';
            else if (x >= 10 && x < 14) clickedMenu = 'edit';
            else if (x >= 16 && x < 20) clickedMenu = 'view';
            else if (x >= 22 && x < 29) clickedMenu = 'special';

            // Always remove old dropdown first
            sendCmd(sessionId, { cmd: 'remove_window', id: 'dropdown' });

            if (clickedMenu) {
                sstate.menuOpen = sstate.menuOpen === clickedMenu ? null : clickedMenu;
            } else {
                sstate.menuOpen = null;
            }

            apu.redrawSession(sessionId);
            return;
        }

        // Dropdown menu item click
        if (sstate.menuOpen) {
            const menu = menus[sstate.menuOpen];
            const w = Math.max(...menu.items.map(i => i.length)) + 4;
            if (x >= menu.x && x < menu.x + w && y >= 2 && y < 2 + menu.items.length) {
                const idx = y - 2;
                const item = menu.items[idx];
                if (item && item !== '-') {
                    console.log(`Menu action: ${sstate.menuOpen} -> ${item} (session ${sessionId})`);
                    handleMenuAction(sessionId, sstate.menuOpen, item);
                }
            }
            sstate.menuOpen = null;
            sendCmd(sessionId, { cmd: 'remove_window', id: 'dropdown' });
            apu.redrawSession(sessionId);
            return;
        }

        // Window content clicks (file selection, calculator - chrome handled by APU)
        for (let i = sstate.windows.length - 1; i >= 0; i--) {
            const win = sstate.windows[i];
            // Only handle content area clicks (not title bar, close button, resize handle)
            if (x >= win.x + 1 && x < win.x + win.width - 1 &&
                y > win.y && y < win.y + win.height - 1) {
                // Calculator clicks
                if (win.isCalculator) {
                    const localX = x - win.x - 1;
                    const localY = y - win.y - 1;
                    handleCalculatorClick(sessionId, win, localX, localY);
                    return;
                }
                // Puzzle clicks
                if (win.isPuzzle) {
                    const localX = x - win.x - 1;
                    const localY = y - win.y - 1;
                    handlePuzzleClick(sessionId, win, localX, localY);
                    return;
                }
                // File selection (only for windows with files)
                if (win.files) {
                    const localX = x - win.x - 1;
                    const localY = y - win.y - 1;
                    const fileIdx = getFileAtPosition(win, localX, localY);

                    if (fileIdx >= 0 && fileIdx < win.files.length) {
                        // Double-click simulation: if already selected, open it
                        if (win.selectedFile === fileIdx) {
                            const f = win.files[fileIdx];
                            if (f.type === 'folder' && fileSystem[f.name]) {
                                createWindow(sessionId, f.name, fileSystem[f.name]);
                            } else if (f.type === 'file' && f.name.endsWith('.txt')) {
                                openTextEditor(sessionId, f.name);
                            } else if (f.type === 'app' && f.name === 'MacWrite') {
                                openTextEditor(sessionId, 'Untitled.txt');
                            } else if (f.type === 'app' && f.name === 'Calculator') {
                                openCalculator(sessionId);
                            }
                        } else {
                            // Start file drag
                            sstate.fileDrag = {
                                file: win.files[fileIdx],
                                sourceWindow: win.id,
                                sourcePath: win.folderPath,
                                fileIdx: fileIdx,
                                startX: x,
                                startY: y
                            };
                        }
                        win.selectedFile = fileIdx;
                        apu.redrawSession(sessionId);
                    }
                }
                // Click was inside a window - don't fall through to desktop
                return;
            }
        }

        // Desktop icon click
        for (const icon of icons) {
            const labelLen = icon.name.length > 12 ? 12 : icon.name.length;
            const labelX = icon.x - Math.floor(labelLen / 2) + 1;
            // Check icon position and label area
            if ((Math.abs(x - icon.x) <= 1 && Math.abs(y - icon.y) <= 0) ||
                (x >= labelX && x < labelX + labelLen && y === icon.y + 1)) {
                console.log(`Selected icon: ${icon.name} (session ${sessionId})`);
                icons.forEach(i => i.selected = false);
                icon.selected = true;
                // Double-click to open
                if (sstate.selectedIcon === icon.id && fileSystem[icon.name]) {
                    createWindow(sessionId, icon.name, fileSystem[icon.name]);
                }
                sstate.selectedIcon = icon.id;
                apu.redrawSession(sessionId);
                return;
            }
        }

        // Click on empty desktop - deselect
        icons.forEach(i => i.selected = false);
        sstate.selectedIcon = null;
        apu.redrawSession(sessionId);
    }
    // Handle mouse release for file drops
    if (button === 'left' && mouseEvent === 'release' && sstate.fileDrag) {
        const drag = sstate.fileDrag;
        sstate.fileDrag = null;

        // Find target window for drop
        for (let i = sstate.windows.length - 1; i >= 0; i--) {
            const win = sstate.windows[i];
            // Check if dropped on a different window with files
            if (win.files && win.id !== drag.sourceWindow &&
                x >= win.x && x < win.x + win.width &&
                y >= win.y && y < win.y + win.height) {

                // Move file from source to target
                const sourcePath = drag.sourcePath;
                const targetPath = win.folderPath;

                if (fileSystem[sourcePath] && fileSystem[targetPath]) {
                    // Remove from source
                    const srcIdx = fileSystem[sourcePath].findIndex(f => f.name === drag.file.name);
                    if (srcIdx >= 0) {
                        fileSystem[sourcePath].splice(srcIdx, 1);
                    }

                    // Add to target (if not already there)
                    if (!fileSystem[targetPath].find(f => f.name === drag.file.name)) {
                        fileSystem[targetPath].push(drag.file);
                    }

                    // Update window file lists
                    const sourceWin = sstate.windows.find(w => w.id === drag.sourceWindow);
                    if (sourceWin) {
                        sourceWin.files = fileSystem[sourcePath] || [];
                        sourceWin.selectedFile = -1;
                    }
                    win.files = fileSystem[targetPath] || [];
                    win.selectedFile = win.files.length - 1;

                    console.log(`Moved ${drag.file.name} from ${sourcePath} to ${targetPath}`);
                    apu.redrawSession(sessionId);
                    return;
                }
            }
        }

        // Check if dropped on Trash icon
        const trashIcon = icons.find(i => i.id === 'trash');
        if (trashIcon && Math.abs(x - trashIcon.x) <= 2 && Math.abs(y - trashIcon.y) <= 1) {
            const sourcePath = drag.sourcePath;
            if (fileSystem[sourcePath]) {
                // Remove from source
                const srcIdx = fileSystem[sourcePath].findIndex(f => f.name === drag.file.name);
                if (srcIdx >= 0) {
                    fileSystem[sourcePath].splice(srcIdx, 1);
                    fileSystem['Trash'].push(drag.file);
                    console.log(`Trashed ${drag.file.name}`);

                    // Update source window
                    const sourceWin = sstate.windows.find(w => w.id === drag.sourceWindow);
                    if (sourceWin) {
                        sourceWin.files = fileSystem[sourcePath] || [];
                        sourceWin.selectedFile = -1;
                    }
                    apu.redrawSession(sessionId);
                    return;
                }
            }
        }

        // Drag cancelled - just redraw
        apu.redrawSession(sessionId);
    }

    // Note: drag/release events for window chrome are handled by APU automatically
}

function handleMenuAction(sessionId, menuName, item) {
    const sstate = getSessionState(sessionId);

    if (item === 'About This Mac...') {
        const win = {
            id: `win_${sstate.nextWindowId++}`,
            title: 'About This Macintosh',
            x: 20, y: 6,
            width: 40, height: 8,
            files: null, staticContent: true
        };
        sstate.windows.push(win);
        setTimeout(() => {
            sendCmd(sessionId, { cmd: 'create_window', id: win.id, x: win.x, y: win.y, width: win.width, height: win.height, border: 'double', title: win.title });
            sendCmd(sessionId, { cmd: 'fill', window: win.id, x: 0, y: 0, width: 38, height: 6, char: ' ', fg: BLACK, bg: WHITE });
            sendCmd(sessionId, { cmd: 'print', window: win.id, x: 4, y: 1, text: 'Macintosh System Software v1.0', fg: BLACK, bg: WHITE });
            sendCmd(sessionId, { cmd: 'print', window: win.id, x: 12, y: 3, text: 'Benj Edwards', fg: BLACK, bg: WHITE });
            sendCmd(sessionId, { cmd: 'print', window: win.id, x: 10, y: 4, text: 'December 30, 2025', fg: BLACK, bg: WHITE });
            sendCmd(sessionId, { cmd: 'bring_to_front', id: win.id });
            sendCmd(sessionId, { cmd: 'flush', force_full: false });
        }, 50);
    } else if (item === 'Calculator') {
        openCalculator(sessionId);
    } else if (item === 'Puzzle') {
        const win = {
            id: `win_${sstate.nextWindowId++}`,
            title: 'Puzzle',
            x: 25, y: 3,
            width: 20, height: 16,
            files: null,
            isPuzzle: true,
            puzzleBoard: createShuffledPuzzle(),
            puzzleMoves: 0
        };
        sstate.windows.push(win);
        setTimeout(() => {
            drawPuzzle(sessionId, win);
            sendCmd(sessionId, { cmd: 'flush', force_full: false });
        }, 50);
    } else if (item === 'New Folder') {
        createWindow(sessionId, 'untitled folder', []);
        apu.redrawSession(sessionId);
    } else if (item === '\u2713 by Icon' || item === '  by Icon') {
        // Switch to icon view - update menu checkmark and redraw windows
        menus.view.items[0] = '\u2713 by Icon';
        menus.view.items[1] = '  by List';
        // Update all file windows to icon view
        for (const win of sstate.windows) {
            if (win.files && win.viewMode !== 'icon') {
                win.viewMode = 'icon';
                // Resize window for icon view
                const iconsPerRow = 4;
                const rows = Math.ceil(win.files.length / iconsPerRow);
                win.width = iconsPerRow * ICON_WIDTH + 4;
                win.height = Math.min(rows * ICON_HEIGHT + 4, 16);
            }
        }
        apu.redrawSession(sessionId);
    } else if (item === '\u2713 by List' || item === '  by List') {
        // Switch to list view - update menu checkmark and redraw windows
        menus.view.items[0] = '  by Icon';
        menus.view.items[1] = '\u2713 by List';
        // Update all file windows to list view
        for (const win of sstate.windows) {
            if (win.files && win.viewMode !== 'list') {
                win.viewMode = 'list';
                // Resize window for list view
                win.width = 30;
                win.height = Math.min(win.files.length + 5, 12);
            }
        }
        apu.redrawSession(sessionId);
    } else if (item === 'Shut Down') {
        sendCmd(sessionId, { cmd: 'clear' });
        sendCmd(sessionId, { cmd: 'print_direct', x: 20, y: 11, text: 'You may now turn off your Macintosh.', fg: WHITE, bg: BLACK });
        sendCmd(sessionId, { cmd: 'flush', force_full: true });
        sendCmd(sessionId, { cmd: 'shutdown' }); // Tell APU to close connection
        sessions.delete(sessionId);
    } else if (item === 'Empty Trash...') {
        fileSystem['Trash'] = [];
        apu.redrawSession(sessionId);
    }
}

// Open calculator helper - can be called from menu or Applications folder
function openCalculator(sessionId) {
    const sstate = getSessionState(sessionId);
    const win = {
        id: `win_${sstate.nextWindowId++}`,
        title: 'Calculator',
        x: 30, y: 5,
        width: 16, height: 10,
        files: null,
        isCalculator: true,
        calcDisplay: '0',
        calcPending: null,
        calcOperator: null,
        calcClear: true
    };
    sstate.windows.push(win);
    setTimeout(() => {
        drawCalculator(sessionId, win);
        sendCmd(sessionId, { cmd: 'flush', force_full: false });
    }, 50);
}

// Calculator functions
function drawCalculator(sessionId, win) {
    sendCmd(sessionId, {
        cmd: 'create_window',
        id: win.id,
        x: win.x, y: win.y,
        width: win.width, height: win.height,
        border: 'single',
        title: win.title,
        closable: true,
        resizable: false,
        draggable: true
    });
    sendCmd(sessionId, { cmd: 'fill', window: win.id, x: 0, y: 0, width: 14, height: 8, char: ' ', fg: BLACK, bg: WHITE });

    // Display - right-aligned, max 9 chars
    const display = win.calcDisplay.length > 9 ? win.calcDisplay.slice(-9) : win.calcDisplay;
    sendCmd(sessionId, { cmd: 'print', window: win.id, x: 1, y: 0, text: '[' + display.padStart(9) + ']', fg: BLACK, bg: WHITE });

    // Buttons
    sendCmd(sessionId, { cmd: 'print', window: win.id, x: 1, y: 2, text: 'C  (  )  /', fg: BLACK, bg: WHITE });
    sendCmd(sessionId, { cmd: 'print', window: win.id, x: 1, y: 3, text: '7  8  9  *', fg: BLACK, bg: WHITE });
    sendCmd(sessionId, { cmd: 'print', window: win.id, x: 1, y: 4, text: '4  5  6  -', fg: BLACK, bg: WHITE });
    sendCmd(sessionId, { cmd: 'print', window: win.id, x: 1, y: 5, text: '1  2  3  +', fg: BLACK, bg: WHITE });
    sendCmd(sessionId, { cmd: 'print', window: win.id, x: 1, y: 6, text: '0     .  =', fg: BLACK, bg: WHITE });

    sendCmd(sessionId, { cmd: 'bring_to_front', id: win.id });
}

function handleCalculatorClick(sessionId, win, localX, localY) {
    // Button layout (localX is 0-based inside content area):
    // Row 2: C(1)  ((4)  )(7)  /(10)
    // Row 3: 7(1)  8(4)  9(7)  *(10)
    // Row 4: 4(1)  5(4)  6(7)  -(10)
    // Row 5: 1(1)  2(4)  3(7)  +(10)
    // Row 6: 0(1)      .(7)  =(10)

    const buttons = {
        2: { 1: 'C', 4: '(', 7: ')', 10: '/' },
        3: { 1: '7', 4: '8', 7: '9', 10: '*' },
        4: { 1: '4', 4: '5', 7: '6', 10: '-' },
        5: { 1: '1', 4: '2', 7: '3', 10: '+' },
        6: { 1: '0', 7: '.', 10: '=' }
    };

    const row = buttons[localY];
    if (!row) return false;

    // Find which button was clicked (allow 2 char width per button)
    let btn = null;
    for (const [col, b] of Object.entries(row)) {
        const c = parseInt(col);
        if (localX >= c && localX < c + 2) {
            btn = b;
            break;
        }
    }

    if (!btn) return false;

    console.log(`Calculator button: ${btn}`);

    if (btn === 'C') {
        win.calcDisplay = '0';
        win.calcPending = null;
        win.calcOperator = null;
        win.calcClear = true;
    } else if (btn >= '0' && btn <= '9') {
        if (win.calcClear || win.calcDisplay === '0') {
            win.calcDisplay = btn;
            win.calcClear = false;
        } else {
            win.calcDisplay += btn;
        }
    } else if (btn === '.') {
        if (!win.calcDisplay.includes('.')) {
            win.calcDisplay += '.';
            win.calcClear = false;
        }
    } else if (btn === '+' || btn === '-' || btn === '*' || btn === '/') {
        if (win.calcPending !== null && win.calcOperator) {
            win.calcDisplay = String(calculate(win.calcPending, parseFloat(win.calcDisplay), win.calcOperator));
        }
        win.calcPending = parseFloat(win.calcDisplay);
        win.calcOperator = btn;
        win.calcClear = true;
    } else if (btn === '=') {
        if (win.calcPending !== null && win.calcOperator) {
            win.calcDisplay = String(calculate(win.calcPending, parseFloat(win.calcDisplay), win.calcOperator));
            win.calcPending = null;
            win.calcOperator = null;
            win.calcClear = true;
        }
    }

    drawCalculator(sessionId, win);
    sendCmd(sessionId, { cmd: 'flush', force_full: false });
    return true;
}

function calculate(a, b, op) {
    switch (op) {
        case '+': return a + b;
        case '-': return a - b;
        case '*': return a * b;
        case '/': return b !== 0 ? a / b : 'Error';
        default: return b;
    }
}

// Sliding Puzzle functions
function createShuffledPuzzle() {
    // Create solved board: 1-15, 0 (empty)
    const board = [
        [1, 2, 3, 4],
        [5, 6, 7, 8],
        [9, 10, 11, 12],
        [13, 14, 15, 0]
    ];

    // Shuffle by making random valid moves (ensures solvability)
    let emptyRow = 3, emptyCol = 3;
    for (let i = 0; i < 100; i++) {
        const moves = [];
        if (emptyRow > 0) moves.push([-1, 0]);
        if (emptyRow < 3) moves.push([1, 0]);
        if (emptyCol > 0) moves.push([0, -1]);
        if (emptyCol < 3) moves.push([0, 1]);

        const [dr, dc] = moves[Math.floor(Math.random() * moves.length)];
        const newRow = emptyRow + dr;
        const newCol = emptyCol + dc;

        board[emptyRow][emptyCol] = board[newRow][newCol];
        board[newRow][newCol] = 0;
        emptyRow = newRow;
        emptyCol = newCol;
    }

    return board;
}

function drawPuzzle(sessionId, win) {
    sendCmd(sessionId, {
        cmd: 'create_window',
        id: win.id,
        x: win.x, y: win.y,
        width: win.width, height: win.height,
        border: 'single',
        title: win.title,
        closable: true,
        resizable: false,
        draggable: true
    });

    // Fill background
    sendCmd(sessionId, { cmd: 'fill', window: win.id, x: 0, y: 0, width: 18, height: 14, char: ' ', fg: BLACK, bg: WHITE });

    // Draw the 4x4 grid - each tile is 4 wide x 3 tall
    for (let row = 0; row < 4; row++) {
        for (let col = 0; col < 4; col++) {
            const val = win.puzzleBoard[row][col];
            const x = 1 + col * 4;
            const y = row * 3;

            if (val === 0) {
                // Empty space - just blank
                sendCmd(sessionId, { cmd: 'print', window: win.id, x, y, text: '    ', fg: BLACK, bg: WHITE });
                sendCmd(sessionId, { cmd: 'print', window: win.id, x, y: y + 1, text: '    ', fg: BLACK, bg: WHITE });
                sendCmd(sessionId, { cmd: 'print', window: win.id, x, y: y + 2, text: '    ', fg: BLACK, bg: WHITE });
            } else {
                // Tile with number - complete box
                const numStr = val.toString().padStart(2);
                sendCmd(sessionId, { cmd: 'print', window: win.id, x, y, text: '\u250C\u2500\u2500\u2510', fg: BLACK, bg: WHITE });
                sendCmd(sessionId, { cmd: 'print', window: win.id, x, y: y + 1, text: `\u2502${numStr}\u2502`, fg: BLACK, bg: WHITE });
                sendCmd(sessionId, { cmd: 'print', window: win.id, x, y: y + 2, text: '\u2514\u2500\u2500\u2518', fg: BLACK, bg: WHITE });
            }
        }
    }

    // Moves counter
    const status = `Moves: ${win.puzzleMoves}`;
    sendCmd(sessionId, { cmd: 'print', window: win.id, x: 1, y: 12, text: status.padEnd(16), fg: GRAY, bg: WHITE });

    // Check for win
    if (isPuzzleSolved(win.puzzleBoard)) {
        sendCmd(sessionId, { cmd: 'print', window: win.id, x: 5, y: 13, text: 'YOU WIN!', fg: BLACK, bg: WHITE });
    }

    sendCmd(sessionId, { cmd: 'bring_to_front', id: win.id });
}

function handlePuzzleClick(sessionId, win, localX, localY) {
    // Determine which tile was clicked (4 chars wide, 3 chars tall per tile)
    const col = Math.floor(localX / 4);
    const row = Math.floor(localY / 3);

    if (col < 0 || col > 3 || row < 0 || row > 3) return false;

    // Find empty space
    let emptyRow = -1, emptyCol = -1;
    for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 4; c++) {
            if (win.puzzleBoard[r][c] === 0) {
                emptyRow = r;
                emptyCol = c;
                break;
            }
        }
    }

    // Check if clicked tile is adjacent to empty space
    const isAdjacent = (
        (Math.abs(row - emptyRow) === 1 && col === emptyCol) ||
        (Math.abs(col - emptyCol) === 1 && row === emptyRow)
    );

    if (isAdjacent) {
        // Swap clicked tile with empty space
        win.puzzleBoard[emptyRow][emptyCol] = win.puzzleBoard[row][col];
        win.puzzleBoard[row][col] = 0;
        win.puzzleMoves++;

        drawPuzzle(sessionId, win);
        sendCmd(sessionId, { cmd: 'flush', force_full: false });
    }

    return true;
}

function isPuzzleSolved(board) {
    const expected = [
        [1, 2, 3, 4],
        [5, 6, 7, 8],
        [9, 10, 11, 12],
        [13, 14, 15, 0]
    ];
    for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 4; c++) {
            if (board[r][c] !== expected[r][c]) return false;
        }
    }
    return true;
}

// Text editor for .txt files
function openTextEditor(sessionId, fileName) {
    const sstate = getSessionState(sessionId);
    const content = fileContents[fileName] || '';
    console.log(`Opening editor for ${fileName}, content length: ${content.length}`);

    const win = {
        id: `editor_${sstate.nextWindowId++}`,
        title: fileName,
        x: 5 + sstate.windows.length * 2,
        y: 2 + sstate.windows.length,
        width: 40,
        height: 14,
        files: null,
        isEditor: true,
        fileName: fileName,
        content: content.split('\n'),
        cursorX: 0,
        cursorY: 0,
        scrollY: 0,
        dirty: false
    };
    sstate.windows.push(win);
    sstate.activeEditor = win.id;
    console.log(`Editor window created: ${win.id}, activeEditor set`);

    // Draw after a brief delay to ensure window is created
    setTimeout(() => {
        drawTextEditor(sessionId, win);
        sendCmd(sessionId, { cmd: 'flush', force_full: true });
        console.log(`Editor drawn and flushed`);
    }, 50);
}

// Wrap a line to fit within width, returning array of wrapped segments
function wrapLine(line, width) {
    if (line.length <= width) return [line];
    const wrapped = [];
    let remaining = line;
    while (remaining.length > width) {
        // Try to break at space
        let breakAt = remaining.lastIndexOf(' ', width);
        if (breakAt <= 0) breakAt = width; // No space found, hard break
        wrapped.push(remaining.substring(0, breakAt));
        remaining = remaining.substring(breakAt).trimStart();
    }
    if (remaining) wrapped.push(remaining);
    return wrapped;
}

// Build wrapped display lines with cursor tracking
function buildWrappedContent(content, width) {
    const lines = [];
    for (let lineIdx = 0; lineIdx < content.length; lineIdx++) {
        const wrapped = wrapLine(content[lineIdx] || '', width);
        for (let wrapIdx = 0; wrapIdx < wrapped.length; wrapIdx++) {
            lines.push({
                text: wrapped[wrapIdx],
                lineIdx,
                wrapIdx,
                startCol: wrapIdx === 0 ? 0 : lines.filter(l => l.lineIdx === lineIdx).reduce((s, l) => s + l.text.length + 1, 0)
            });
        }
        if (wrapped.length === 0) {
            lines.push({ text: '', lineIdx, wrapIdx: 0, startCol: 0 });
        }
    }
    return lines;
}

function drawTextEditor(sessionId, win) {
    sendCmd(sessionId, {
        cmd: 'create_window',
        id: win.id,
        x: win.x, y: win.y,
        width: win.width, height: win.height,
        border: 'single',
        title: win.dirty ? `${win.title} *` : win.title,
        closable: true,
        resizable: true,
        draggable: true,
        min_width: 20,
        min_height: 6
    });

    // Fill background
    sendCmd(sessionId, {
        cmd: 'fill',
        window: win.id,
        x: 0, y: 0,
        width: win.width - 2,
        height: win.height - 2,
        char: ' ',
        fg: BLACK,
        bg: WHITE
    });

    const contentHeight = win.height - 4;  // Leave room for status bar
    const contentWidth = win.width - 4;    // 1 cell margin on each side

    // Build wrapped display with cursor position tracking
    const wrappedLines = buildWrappedContent(win.content, contentWidth);

    // Find which display line the cursor is on
    let cursorDisplayLine = 0;
    let cursorDisplayCol = win.cursorX;
    for (let i = 0; i < wrappedLines.length; i++) {
        const wl = wrappedLines[i];
        if (wl.lineIdx === win.cursorY) {
            if (win.cursorX <= wl.startCol + wl.text.length) {
                cursorDisplayLine = i;
                cursorDisplayCol = win.cursorX - wl.startCol;
                if (cursorDisplayCol < 0) cursorDisplayCol = 0;
                if (cursorDisplayCol > wl.text.length) cursorDisplayCol = wl.text.length;
                break;
            }
        }
    }

    // Adjust scroll to keep cursor visible
    if (cursorDisplayLine < win.scrollY) win.scrollY = cursorDisplayLine;
    if (cursorDisplayLine >= win.scrollY + contentHeight) win.scrollY = cursorDisplayLine - contentHeight + 1;

    // Draw visible lines
    for (let i = 0; i < contentHeight; i++) {
        const displayIdx = i + win.scrollY;
        const wl = wrappedLines[displayIdx];
        const line = wl ? wl.text : '';
        const displayLine = line.padEnd(contentWidth, ' ');

        // Check if cursor is on this display line
        const hasCursor = displayIdx === cursorDisplayLine && cursorDisplayCol < contentWidth;

        if (hasCursor) {
            const beforeCursor = displayLine.substring(0, cursorDisplayCol);
            const cursorChar = displayLine[cursorDisplayCol] || ' ';
            const afterCursor = displayLine.substring(cursorDisplayCol + 1);

            if (beforeCursor) {
                sendCmd(sessionId, {
                    cmd: 'print', window: win.id,
                    x: 1, y: i, text: beforeCursor,
                    fg: BLACK, bg: WHITE
                });
            }
            sendCmd(sessionId, {
                cmd: 'print', window: win.id,
                x: 1 + cursorDisplayCol, y: i, text: cursorChar,
                fg: WHITE, bg: BLACK
            });
            if (afterCursor) {
                sendCmd(sessionId, {
                    cmd: 'print', window: win.id,
                    x: 1 + cursorDisplayCol + 1, y: i, text: afterCursor,
                    fg: BLACK, bg: WHITE
                });
            }
        } else {
            sendCmd(sessionId, {
                cmd: 'print', window: win.id,
                x: 1, y: i, text: displayLine,
                fg: BLACK, bg: WHITE
            });
        }
    }

    // Status bar
    const status = `Ln ${win.cursorY + 1}, Col ${win.cursorX + 1}  [Ctrl+S=Save]`;
    sendCmd(sessionId, {
        cmd: 'print', window: win.id,
        x: 1, y: win.height - 4,
        text: status.substring(0, contentWidth).padEnd(contentWidth, ' '),
        fg: GRAY, bg: WHITE
    });

    sendCmd(sessionId, { cmd: 'bring_to_front', id: win.id });
}

// Handle keyboard input for editor
function handleEditorInput(sessionId, char, key) {
    const sstate = getSessionState(sessionId);
    if (!sstate.activeEditor) {
        console.log(`No activeEditor for session ${sessionId}`);
        return false;
    }

    const win = sstate.windows.find(w => w.id === sstate.activeEditor);
    if (!win || !win.isEditor) {
        console.log(`Editor window not found: ${sstate.activeEditor}`);
        return false;
    }

    console.log(`Editor input: char=${char ? JSON.stringify(char) : 'null'}, key=${key || 'null'}`);

    const contentHeight = win.height - 4;  // Match drawTextEditor

    if (key === 'up' && win.cursorY > 0) {
        win.cursorY--;
        if (win.cursorY < win.scrollY) win.scrollY = win.cursorY;
    } else if (key === 'down') {
        if (win.cursorY < win.content.length - 1) {
            win.cursorY++;
            if (win.cursorY >= win.scrollY + contentHeight) win.scrollY++;
        }
    } else if (key === 'left' && win.cursorX > 0) {
        win.cursorX--;
    } else if (key === 'right') {
        const line = win.content[win.cursorY] || '';
        if (win.cursorX < line.length) win.cursorX++;
    } else if (key === 'enter') {
        // Split line at cursor
        const line = win.content[win.cursorY] || '';
        win.content[win.cursorY] = line.substring(0, win.cursorX);
        win.content.splice(win.cursorY + 1, 0, line.substring(win.cursorX));
        win.cursorY++;
        win.cursorX = 0;
        win.dirty = true;
        if (win.cursorY >= win.scrollY + contentHeight) win.scrollY++;
    } else if (key === 'backspace') {
        if (win.cursorX > 0) {
            const line = win.content[win.cursorY] || '';
            win.content[win.cursorY] = line.substring(0, win.cursorX - 1) + line.substring(win.cursorX);
            win.cursorX--;
            win.dirty = true;
        } else if (win.cursorY > 0) {
            // Join with previous line
            const prevLine = win.content[win.cursorY - 1] || '';
            const currLine = win.content[win.cursorY] || '';
            win.cursorX = prevLine.length;
            win.content[win.cursorY - 1] = prevLine + currLine;
            win.content.splice(win.cursorY, 1);
            win.cursorY--;
            win.dirty = true;
            if (win.cursorY < win.scrollY) win.scrollY = win.cursorY;
        }
    } else if (char === '\x13') { // Ctrl+S = Save
        fileContents[win.fileName] = win.content.join('\n');
        win.dirty = false;
        console.log(`Saved ${win.fileName}`);
        // Add to Macintosh HD if not there
        if (!fileSystem['Macintosh HD'].find(f => f.name === win.fileName)) {
            fileSystem['Macintosh HD'].push({ name: win.fileName, type: 'file', icon: '\u25A2' });
        }
    } else if (char && char.length === 1 && char >= ' ') {
        // Insert character
        const line = win.content[win.cursorY] || '';
        win.content[win.cursorY] = line.substring(0, win.cursorX) + char + line.substring(win.cursorX);
        win.cursorX++;
        win.dirty = true;
    } else {
        return false; // Not handled
    }

    drawTextEditor(sessionId, win);
    sendCmd(sessionId, { cmd: 'flush', force_full: true });
    return true;
}

async function main() {
    console.log('Mac 1984 ASCII Desktop Demo (Multi-Session)');
    console.log('============================================\n');
    console.log('Connect with: telnet localhost 6123');
    console.log('Each client gets their own private desktop!');
    console.log('\nKeyboard Controls:');
    console.log('  Arrow keys  - Move cursor');
    console.log('  Space/Enter - Click at cursor');
    console.log('  Space on title bar - Enter DRAG mode');
    console.log('  Space on resize corner - Enter RESIZE mode');
    console.log('  Space again - Exit drag/resize mode');
    console.log('  Q - Quit\n');

    await apu.connect();
    await apu.init();

    // Initial window creation now happens per-session when clients connect
    // See client_connect handler in processBuffer()

    console.log('Demo started - waiting for clients...');
}

main().catch(console.error);
