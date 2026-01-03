#!/usr/bin/env node
/**
 * Mac 1984 ASCII Desktop Demo
 * A simulation of the original Macintosh desktop using APU.
 */

const net = require('net');

const GAME_PORT = process.argv[2] || 6122;
const COLS = 80;
const ROWS = 24;
const BLACK = 0, WHITE = 7, BRIGHT_WHITE = 15, GRAY = 8;

// Per-session state - each connected client has their own desktop
const sessions = new Map();

function getSessionState(sessionId) {
    if (!sessions.has(sessionId)) {
        sessions.set(sessionId, {
            menuOpen: null,
            selectedIcon: null,
            windows: [],
            nextWindowId: 1,
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
    apple: { x: 1, label: '@', items: ['About This Mac...', '-', 'Calculator'] },
    file: { x: 4, label: 'File', items: ['New Folder', 'Open', 'Close', '-', 'Shut Down'] },
    edit: { x: 10, label: 'Edit', items: ['Undo', '-', 'Cut', 'Copy', 'Paste'] },
    view: { x: 16, label: 'View', items: ['by Icon', 'by Name', 'by Date'] },
    special: { x: 22, label: 'Special', items: ['Empty Trash...', '-', 'Shut Down'] },
};

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
function sendCmd(sessionId, obj) {
    if (sessionId) {
        apu.sendTo(sessionId, obj);
    } else {
        apu.send(cmd(obj));
    }
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
    for (const win of sstate.windows) {
        drawWindow(sessionId, win);
    }

    // Dropdown menu if open (session-specific)
    if (sstate.menuOpen) {
        drawDropdown(sessionId, sstate.menuOpen);
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

    // File list if this window has files
    if (win.files) {
        for (let i = 0; i < win.files.length && i < win.height - 4; i++) {
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
    // No more overlay windows needed - APU handles close button and resize handle!
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

function createWindow(sessionId, title, files, x, y) {
    const sstate = getSessionState(sessionId);
    const win = {
        id: `win_${sstate.nextWindowId++}`,
        title,
        x: x ?? (5 + sstate.windows.length * 3),
        y: y ?? (3 + sstate.windows.length * 2),
        width: 30,
        height: Math.min(files.length + 5, 12),
        files,
        selectedFile: -1
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
        handleMouse(sessionId, event);
    } else if (event.type === 'key') {
        // Arrow keys, enter, backspace, etc.
        console.log(`Key from ${sessionId}: ${event.key}`);
        if (handleEditorInput(sessionId, null, event.key)) return;
        // Key not handled by editor - ignore it
    } else if (event.type === 'char') {
        // Try editor first
        if (handleEditorInput(sessionId, event.char, null)) return;

        // Only handle Q if no editor is active
        const sstate = getSessionState(sessionId);
        if (!sstate.activeEditor) {
            console.log(`Char from ${sessionId}: ${event.char}`);
            if (event.char === 'q' || event.char === 'Q') {
                process.exit(0);
            }
        }
    }
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

        // Window content clicks (file selection only - chrome handled by APU)
        for (let i = sstate.windows.length - 1; i >= 0; i--) {
            const win = sstate.windows[i];
            // Only handle content area clicks (not title bar, close button, resize handle)
            if (x >= win.x + 1 && x < win.x + win.width - 1 &&
                y > win.y && y < win.y + win.height - 1) {
                // File selection (only for windows with files)
                if (win.files) {
                    const fileIdx = y - win.y - 1;
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
                            }
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
            files: null
        };
        sstate.windows.push(win);
        setTimeout(() => {
            sendCmd(sessionId, { cmd: 'create_window', id: win.id, x: win.x, y: win.y, width: win.width, height: win.height, border: 'double', title: win.title });
            sendCmd(sessionId, { cmd: 'fill', window: win.id, x: 0, y: 0, width: 38, height: 6, char: ' ', fg: BLACK, bg: WHITE });
            sendCmd(sessionId, { cmd: 'print', window: win.id, x: 6, y: 1, text: 'Macintosh System Software', fg: BLACK, bg: WHITE });
            sendCmd(sessionId, { cmd: 'print', window: win.id, x: 12, y: 2, text: 'Version 1.0', fg: BLACK, bg: WHITE });
            sendCmd(sessionId, { cmd: 'print', window: win.id, x: 6, y: 4, text: 'Total Memory: 128K', fg: BLACK, bg: WHITE });
            sendCmd(sessionId, { cmd: 'bring_to_front', id: win.id });
            sendCmd(sessionId, { cmd: 'flush', force_full: false });
        }, 50);
    } else if (item === 'Calculator') {
        const win = {
            id: `win_${sstate.nextWindowId++}`,
            title: 'Calculator',
            x: 30, y: 5,
            width: 16, height: 10,
            files: null
        };
        sstate.windows.push(win);
        setTimeout(() => {
            sendCmd(sessionId, { cmd: 'create_window', id: win.id, x: win.x, y: win.y, width: win.width, height: win.height, border: 'single', title: win.title });
            sendCmd(sessionId, { cmd: 'fill', window: win.id, x: 0, y: 0, width: 14, height: 8, char: ' ', fg: BLACK, bg: WHITE });
            sendCmd(sessionId, { cmd: 'print', window: win.id, x: 1, y: 0, text: '[        0]', fg: BLACK, bg: WHITE });
            sendCmd(sessionId, { cmd: 'print', window: win.id, x: 1, y: 2, text: 'C  +  %  /', fg: BLACK, bg: WHITE });
            sendCmd(sessionId, { cmd: 'print', window: win.id, x: 1, y: 3, text: '7  8  9  *', fg: BLACK, bg: WHITE });
            sendCmd(sessionId, { cmd: 'print', window: win.id, x: 1, y: 4, text: '4  5  6  -', fg: BLACK, bg: WHITE });
            sendCmd(sessionId, { cmd: 'print', window: win.id, x: 1, y: 5, text: '1  2  3  +', fg: BLACK, bg: WHITE });
            sendCmd(sessionId, { cmd: 'print', window: win.id, x: 1, y: 6, text: '   0  .  =', fg: BLACK, bg: WHITE });
            sendCmd(sessionId, { cmd: 'bring_to_front', id: win.id });
            sendCmd(sessionId, { cmd: 'flush', force_full: false });
        }, 50);
    } else if (item === 'New Folder') {
        createWindow(sessionId, 'untitled folder', []);
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

    // Draw content with cursor
    // Use same margins as file listing: x:1, width-4 (1 cell padding each side)
    const contentHeight = win.height - 4;  // Leave room for status bar
    const contentWidth = win.width - 4;    // 1 cell margin on each side
    const cursorScreenY = win.cursorY - win.scrollY;  // Cursor position relative to scroll

    for (let i = 0; i < contentHeight; i++) {
        const lineIdx = i + win.scrollY;
        const line = win.content[lineIdx] || '';
        const displayLine = line.substring(0, contentWidth).padEnd(contentWidth, ' ');

        // Check if cursor is on this line
        if (i === cursorScreenY && win.cursorX < contentWidth) {
            // Draw line with cursor (inverted character at cursor position)
            const beforeCursor = displayLine.substring(0, win.cursorX);
            const cursorChar = displayLine[win.cursorX] || ' ';
            const afterCursor = displayLine.substring(win.cursorX + 1);

            // Draw before cursor
            if (beforeCursor) {
                sendCmd(sessionId, {
                    cmd: 'print',
                    window: win.id,
                    x: 1, y: i,
                    text: beforeCursor,
                    fg: BLACK,
                    bg: WHITE
                });
            }

            // Draw cursor (inverted)
            sendCmd(sessionId, {
                cmd: 'print',
                window: win.id,
                x: 1 + win.cursorX, y: i,
                text: cursorChar,
                fg: WHITE,
                bg: BLACK
            });

            // Draw after cursor
            if (afterCursor) {
                sendCmd(sessionId, {
                    cmd: 'print',
                    window: win.id,
                    x: 1 + win.cursorX + 1, y: i,
                    text: afterCursor,
                    fg: BLACK,
                    bg: WHITE
                });
            }
        } else {
            // Normal line (no cursor)
            sendCmd(sessionId, {
                cmd: 'print',
                window: win.id,
                x: 1, y: i,
                text: displayLine,
                fg: BLACK,
                bg: WHITE
            });
        }
    }

    // Status bar at bottom of content area
    const status = `Ln ${win.cursorY + 1}, Col ${win.cursorX + 1}  [Ctrl+S=Save]`;
    sendCmd(sessionId, {
        cmd: 'print',
        window: win.id,
        x: 1, y: win.height - 4,
        text: status.substring(0, contentWidth).padEnd(contentWidth, ' '),
        fg: GRAY,
        bg: WHITE
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
    console.log('Press Q to quit\n');

    await apu.connect();
    await apu.init();

    // Initial window creation now happens per-session when clients connect
    // See client_connect handler in processBuffer()

    console.log('Demo started - waiting for clients...');
}

main().catch(console.error);
