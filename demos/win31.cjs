#!/usr/bin/env node
/**
 * Windows 3.1 ASCII Desktop Demo
 * A colorful simulation of the Windows 3.1 Program Manager using APU.
 */

const net = require('net');

const GAME_PORT = process.argv[2] || 6122;
const COLS = 80;
const ROWS = 24;

// Windows 3.1 Color Palette
const BLACK = 0;
const BLUE = 1;
const GREEN = 2;
const CYAN = 3;
const RED = 4;
const MAGENTA = 5;
const BROWN = 3;      // Yellow/brown
const LIGHT_GRAY = 7;
const DARK_GRAY = 8;
const LIGHT_BLUE = 9;
const LIGHT_GREEN = 10;
const LIGHT_CYAN = 11;
const LIGHT_RED = 12;
const LIGHT_MAGENTA = 13;
const YELLOW = 11;
const WHITE = 15;

// Windows 3.1 specific colors
const DESKTOP_BG = BLUE;           // Classic blue desktop
const TITLE_BAR_ACTIVE = BLUE;     // Active window title
const TITLE_BAR_INACTIVE = DARK_GRAY;
const TITLE_TEXT = WHITE;
const WINDOW_BG = LIGHT_GRAY;      // Window background (gray)
const WINDOW_CONTENT_BG = WHITE;   // Content area
const BUTTON_BG = LIGHT_GRAY;
const TEXT_COLOR = BLACK;
const HIGHLIGHT = LIGHT_BLUE;

// Per-session state
const sessions = new Map();

function getSessionState(sessionId) {
    if (!sessions.has(sessionId)) {
        sessions.set(sessionId, {
            menuOpen: null,
            activeWindow: 'progman',
            windows: [
                { id: 'progman', title: 'Program Manager', x: 0, y: 1, width: 80, height: 22, minimized: false },
            ],
            programGroups: [
                { id: 'main', name: 'Main', x: 2, y: 3, width: 36, height: 10, icons: [
                    { name: 'File Manager', icon: '\u2590', color: YELLOW },
                    { name: 'Control Panel', icon: '\u2592', color: LIGHT_CYAN },
                    { name: 'Print Manager', icon: '\u2593', color: LIGHT_GREEN },
                    { name: 'Clipboard', icon: '\u25A1', color: LIGHT_GRAY },
                    { name: 'MS-DOS Prompt', icon: '\u25A0', color: WHITE },
                    { name: 'Windows Setup', icon: '\u263A', color: LIGHT_BLUE },
                ]},
                { id: 'accessories', name: 'Accessories', x: 40, y: 3, width: 36, height: 10, icons: [
                    { name: 'Write', icon: '\u270E', color: LIGHT_BLUE },
                    { name: 'Paintbrush', icon: '\u2593', color: LIGHT_RED },
                    { name: 'Terminal', icon: '\u25A4', color: LIGHT_GREEN },
                    { name: 'Notepad', icon: '\u25A1', color: YELLOW },
                    { name: 'Calculator', icon: '\u253C', color: LIGHT_GRAY },
                    { name: 'Clock', icon: '\u25CB', color: LIGHT_CYAN },
                ]},
                { id: 'games', name: 'Games', x: 2, y: 14, width: 36, height: 7, icons: [
                    { name: 'Solitaire', icon: '\u2660', color: LIGHT_GREEN },
                    { name: 'Minesweeper', icon: '\u263B', color: LIGHT_RED },
                    { name: 'Reversi', icon: '\u25CF', color: WHITE },
                ]},
                { id: 'apps', name: 'Applications', x: 40, y: 14, width: 36, height: 7, icons: [
                    { name: 'Word', icon: 'W', color: LIGHT_BLUE },
                    { name: 'Excel', icon: 'X', color: LIGHT_GREEN },
                    { name: 'PowerPoint', icon: 'P', color: LIGHT_RED },
                ]},
            ],
            selectedIcon: null,
            nextWindowId: 10,
        });
    }
    return sessions.get(sessionId);
}

const menus = {
    file: { x: 1, label: 'File', items: ['New...', 'Open', 'Move...', 'Copy...', 'Delete', '-', 'Properties...', '-', 'Run...', '-', 'Exit Windows'] },
    options: { x: 7, label: 'Options', items: ['Auto Arrange', 'Minimize on Use', 'Save Settings on Exit'] },
    window: { x: 16, label: 'Window', items: ['Cascade', 'Tile', 'Arrange Icons', '-', '1 Main', '2 Accessories', '3 Games'] },
    help: { x: 24, label: 'Help', items: ['Contents', 'Search for Help on...', 'How to Use Help', '-', 'About Program Manager...'] },
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
            this.socket.on('error', reject);

            this.socket.on('data', (data) => {
                this.buffer += data.toString();
                let lines = this.buffer.split('\n');
                this.buffer = lines.pop();
                for (const line of lines) {
                    if (line.trim()) {
                        try {
                            const event = JSON.parse(line);
                            this.handleEvent(event);
                        } catch (e) {
                            console.error('Parse error:', e.message);
                        }
                    }
                }
            });
        });
    }

    send(obj) {
        if (this.socket && this.socket.writable) {
            this.socket.write(cmd(obj) + '\n');
        }
    }

    handleEvent(event) {
        if (event.type === 'client_connect') {
            console.log('Client connected:', event.session);
            this.initSession(event.session);
        } else if (event.type === 'client_disconnect') {
            console.log('Client disconnected:', event.session);
            sessions.delete(event.session);
        } else if (event.type === 'input') {
            this.handleInput(event.session, event.event);
        } else if (event.type === 'window_close_requested') {
            this.handleWindowClose(event.session, event.id);
        } else if (event.type === 'window_moved') {
            // Handle window move
        } else if (event.type === 'window_focused') {
            const sstate = getSessionState(event.session);
            sstate.activeWindow = event.id;
        }
    }

    initSession(sessionId) {
        // Reset APU display to clear any orphan windows from previous game instance
        this.send({ cmd: 'reset', session: sessionId });
        this.send({ cmd: 'init', session: sessionId, cols: COLS, rows: ROWS });
        this.send({ cmd: 'enable_mouse', session: sessionId, mode: 'sgr' });
        this.drawDesktop(sessionId);
    }

    drawDesktop(sessionId) {
        const sstate = getSessionState(sessionId);

        // Blue desktop background with pattern
        this.send({ cmd: 'clear', session: sessionId });
        const cells = [];
        for (let y = 0; y < ROWS; y++) {
            for (let x = 0; x < COLS; x++) {
                // Subtle pattern on desktop
                const patternChar = ((x + y) % 2 === 0) ? '\u2591' : '\u2592';
                cells.push({ x, y, char: patternChar, fg: LIGHT_BLUE, bg: BLUE });
            }
        }
        this.send({ cmd: 'batch', session: sessionId, cells });

        // Program Manager window (full screen)
        this.drawProgramManager(sessionId);

        this.send({ cmd: 'flush', session: sessionId, force_full: true });
    }

    drawProgramManager(sessionId) {
        const sstate = getSessionState(sessionId);
        const pm = sstate.windows.find(w => w.id === 'progman');

        // Main Program Manager window
        this.send({
            cmd: 'create_window', session: sessionId,
            id: 'progman',
            x: pm.x, y: pm.y,
            width: pm.width, height: pm.height,
            border: 'double',
            title: 'Program Manager',
            closable: true,
            resizable: true,
            draggable: true
        });

        // Fill with gray background
        this.send({
            cmd: 'fill', session: sessionId,
            window: 'progman',
            x: 0, y: 0,
            width: pm.width - 2, height: pm.height - 2,
            char: ' ', fg: BLACK, bg: LIGHT_GRAY
        });

        // Menu bar inside Program Manager
        for (let x = 0; x < pm.width - 2; x++) {
            this.send({
                cmd: 'set_cell', session: sessionId,
                window: 'progman',
                x, y: 0,
                char: ' ', fg: BLACK, bg: LIGHT_GRAY
            });
        }

        // Menu labels
        this.send({ cmd: 'print', session: sessionId, window: 'progman', x: 1, y: 0, text: 'File', fg: BLACK, bg: LIGHT_GRAY });
        this.send({ cmd: 'print', session: sessionId, window: 'progman', x: 7, y: 0, text: 'Options', fg: BLACK, bg: LIGHT_GRAY });
        this.send({ cmd: 'print', session: sessionId, window: 'progman', x: 16, y: 0, text: 'Window', fg: BLACK, bg: LIGHT_GRAY });
        this.send({ cmd: 'print', session: sessionId, window: 'progman', x: 24, y: 0, text: 'Help', fg: BLACK, bg: LIGHT_GRAY });

        // Draw program groups
        for (const group of sstate.programGroups) {
            this.drawProgramGroup(sessionId, group);
        }
    }

    drawProgramGroup(sessionId, group) {
        // Create group window inside program manager
        this.send({
            cmd: 'create_window', session: sessionId,
            id: group.id,
            x: group.x, y: group.y,
            width: group.width, height: group.height,
            border: 'single',
            title: group.name,
            closable: true,
            resizable: true,
            draggable: true
        });

        // White content background
        this.send({
            cmd: 'fill', session: sessionId,
            window: group.id,
            x: 0, y: 0,
            width: group.width - 2, height: group.height - 2,
            char: ' ', fg: BLACK, bg: WHITE
        });

        // Draw icons in grid
        const iconsPerRow = Math.floor((group.width - 4) / 12);
        group.icons.forEach((icon, i) => {
            const row = Math.floor(i / iconsPerRow);
            const col = i % iconsPerRow;
            const ix = 2 + col * 12;
            const iy = 1 + row * 3;

            if (iy < group.height - 4) {
                // Icon character
                this.send({
                    cmd: 'set_cell', session: sessionId,
                    window: group.id,
                    x: ix + 3, y: iy,
                    char: icon.icon, fg: icon.color, bg: WHITE
                });

                // Icon name (truncated)
                const name = icon.name.length > 10 ? icon.name.substring(0, 9) + '.' : icon.name;
                const nameX = ix + 4 - Math.floor(name.length / 2);
                this.send({
                    cmd: 'print', session: sessionId,
                    window: group.id,
                    x: Math.max(1, nameX), y: iy + 1,
                    text: name, fg: BLACK, bg: WHITE
                });
            }
        });
    }

    handleInput(sessionId, event) {
        const sstate = getSessionState(sessionId);

        if (event.type === 'mouse') {
            if (event.event === 'press' && event.button === 'left') {
                // Check menu clicks
                if (event.y === 2) { // Menu bar row (inside progman window)
                    if (event.x >= 1 && event.x <= 4) {
                        this.toggleMenu(sessionId, 'file');
                    } else if (event.x >= 7 && event.x <= 13) {
                        this.toggleMenu(sessionId, 'options');
                    } else if (event.x >= 16 && event.x <= 21) {
                        this.toggleMenu(sessionId, 'window');
                    } else if (event.x >= 24 && event.x <= 27) {
                        this.toggleMenu(sessionId, 'help');
                    } else if (sstate.menuOpen) {
                        this.closeMenu(sessionId);
                    }
                } else if (sstate.menuOpen) {
                    this.handleMenuClick(sessionId, event.x, event.y);
                }
            }
        } else if (event.type === 'key') {
            if (event.key === 'escape' && sstate.menuOpen) {
                this.closeMenu(sessionId);
            }
        }
    }

    toggleMenu(sessionId, menuName) {
        const sstate = getSessionState(sessionId);
        if (sstate.menuOpen === menuName) {
            this.closeMenu(sessionId);
        } else {
            sstate.menuOpen = menuName;
            this.drawMenu(sessionId, menuName);
        }
    }

    drawMenu(sessionId, menuName) {
        const menu = menus[menuName];
        if (!menu) return;

        const w = Math.max(...menu.items.map(i => i.length)) + 4;
        const h = menu.items.length + 2;

        this.send({
            cmd: 'create_window', session: sessionId,
            id: 'dropdown',
            x: menu.x, y: 3,
            width: w, height: h,
            border: 'single',
            closable: false,
            resizable: false,
            draggable: false
        });

        // White background with shadow effect
        this.send({
            cmd: 'fill', session: sessionId,
            window: 'dropdown',
            x: 0, y: 0,
            width: w - 2, height: h - 2,
            char: ' ', fg: BLACK, bg: WHITE
        });

        // Menu items
        menu.items.forEach((item, i) => {
            if (item === '-') {
                this.send({
                    cmd: 'print', session: sessionId,
                    window: 'dropdown',
                    x: 0, y: i,
                    text: '\u2500'.repeat(w - 2), fg: DARK_GRAY, bg: WHITE
                });
            } else {
                this.send({
                    cmd: 'print', session: sessionId,
                    window: 'dropdown',
                    x: 1, y: i,
                    text: item, fg: BLACK, bg: WHITE
                });
            }
        });

        this.send({ cmd: 'bring_to_front', session: sessionId, id: 'dropdown' });
        this.send({ cmd: 'flush', session: sessionId, force_full: false });
    }

    closeMenu(sessionId) {
        const sstate = getSessionState(sessionId);
        sstate.menuOpen = null;
        this.send({ cmd: 'remove_window', session: sessionId, id: 'dropdown' });
        this.send({ cmd: 'flush', session: sessionId, force_full: false });
    }

    handleMenuClick(sessionId, x, y) {
        const sstate = getSessionState(sessionId);
        const menu = menus[sstate.menuOpen];
        if (!menu) return;

        const itemIndex = y - 4; // Adjust for menu position
        if (itemIndex >= 0 && itemIndex < menu.items.length) {
            const item = menu.items[itemIndex];
            if (item !== '-') {
                this.handleMenuAction(sessionId, item);
            }
        }
        this.closeMenu(sessionId);
    }

    handleMenuAction(sessionId, item) {
        const sstate = getSessionState(sessionId);

        if (item === 'About Program Manager...') {
            this.showAboutDialog(sessionId);
        } else if (item === 'Exit Windows') {
            this.exitWindows(sessionId);
        } else if (item === 'Run...') {
            this.showRunDialog(sessionId);
        }
    }

    showAboutDialog(sessionId) {
        const sstate = getSessionState(sessionId);
        const winId = `about_${sstate.nextWindowId++}`;

        this.send({
            cmd: 'create_window', session: sessionId,
            id: winId,
            x: 20, y: 6,
            width: 40, height: 12,
            border: 'double',
            title: 'About Program Manager',
            closable: true,
            resizable: false,
            draggable: true
        });

        this.send({
            cmd: 'fill', session: sessionId,
            window: winId,
            x: 0, y: 0, width: 38, height: 10,
            char: ' ', fg: BLACK, bg: WHITE
        });

        // Windows logo (colored)
        this.send({ cmd: 'print', session: sessionId, window: winId, x: 4, y: 1, text: '\u2588\u2588', fg: RED, bg: WHITE });
        this.send({ cmd: 'print', session: sessionId, window: winId, x: 7, y: 1, text: '\u2588\u2588', fg: GREEN, bg: WHITE });
        this.send({ cmd: 'print', session: sessionId, window: winId, x: 4, y: 2, text: '\u2588\u2588', fg: BLUE, bg: WHITE });
        this.send({ cmd: 'print', session: sessionId, window: winId, x: 7, y: 2, text: '\u2588\u2588', fg: YELLOW, bg: WHITE });

        this.send({ cmd: 'print', session: sessionId, window: winId, x: 12, y: 1, text: 'Microsoft Windows', fg: BLACK, bg: WHITE });
        this.send({ cmd: 'print', session: sessionId, window: winId, x: 12, y: 2, text: 'Version 3.1', fg: BLACK, bg: WHITE });

        this.send({ cmd: 'print', session: sessionId, window: winId, x: 4, y: 4, text: 'Copyright (c) 1985-1992', fg: DARK_GRAY, bg: WHITE });
        this.send({ cmd: 'print', session: sessionId, window: winId, x: 4, y: 5, text: 'Microsoft Corporation', fg: DARK_GRAY, bg: WHITE });

        this.send({ cmd: 'print', session: sessionId, window: winId, x: 4, y: 7, text: 'Memory: 640 KB Total', fg: BLACK, bg: WHITE });
        this.send({ cmd: 'print', session: sessionId, window: winId, x: 4, y: 8, text: 'System: 386 Enhanced Mode', fg: BLACK, bg: WHITE });

        // OK button
        this.send({ cmd: 'print', session: sessionId, window: winId, x: 15, y: 9, text: '[  OK  ]', fg: BLACK, bg: LIGHT_GRAY });

        this.send({ cmd: 'bring_to_front', session: sessionId, id: winId });
        this.send({ cmd: 'flush', session: sessionId, force_full: false });
    }

    showRunDialog(sessionId) {
        const sstate = getSessionState(sessionId);
        const winId = `run_${sstate.nextWindowId++}`;

        this.send({
            cmd: 'create_window', session: sessionId,
            id: winId,
            x: 20, y: 8,
            width: 40, height: 8,
            border: 'single',
            title: 'Run',
            closable: true,
            resizable: false,
            draggable: true
        });

        this.send({
            cmd: 'fill', session: sessionId,
            window: winId,
            x: 0, y: 0, width: 38, height: 6,
            char: ' ', fg: BLACK, bg: LIGHT_GRAY
        });

        this.send({ cmd: 'print', session: sessionId, window: winId, x: 2, y: 1, text: 'Command Line:', fg: BLACK, bg: LIGHT_GRAY });

        // Text input field (white background)
        this.send({
            cmd: 'fill', session: sessionId,
            window: winId,
            x: 2, y: 2, width: 34, height: 1,
            char: ' ', fg: BLACK, bg: WHITE
        });

        // Buttons
        this.send({ cmd: 'print', session: sessionId, window: winId, x: 6, y: 4, text: '[  OK  ]', fg: BLACK, bg: LIGHT_GRAY });
        this.send({ cmd: 'print', session: sessionId, window: winId, x: 18, y: 4, text: '[Cancel]', fg: BLACK, bg: LIGHT_GRAY });
        this.send({ cmd: 'print', session: sessionId, window: winId, x: 28, y: 4, text: '[Help]', fg: BLACK, bg: LIGHT_GRAY });

        this.send({ cmd: 'bring_to_front', session: sessionId, id: winId });
        this.send({ cmd: 'flush', session: sessionId, force_full: false });
    }

    exitWindows(sessionId) {
        // Show exit confirmation
        this.send({ cmd: 'reset', session: sessionId });

        // Blue screen farewell
        const cells = [];
        for (let y = 0; y < ROWS; y++) {
            for (let x = 0; x < COLS; x++) {
                cells.push({ x, y, char: ' ', fg: WHITE, bg: BLUE });
            }
        }
        this.send({ cmd: 'batch', session: sessionId, cells });

        this.send({ cmd: 'print_direct', session: sessionId, x: 25, y: 10, text: 'It is now safe to turn off', fg: YELLOW, bg: BLUE });
        this.send({ cmd: 'print_direct', session: sessionId, x: 28, y: 11, text: 'your computer.', fg: YELLOW, bg: BLUE });

        this.send({ cmd: 'flush', session: sessionId, force_full: true });
    }

    handleWindowClose(sessionId, windowId) {
        if (windowId === 'progman') {
            this.exitWindows(sessionId);
        } else {
            this.send({ cmd: 'remove_window', session: sessionId, id: windowId });
            this.send({ cmd: 'flush', session: sessionId, force_full: false });
        }
    }

    redrawSession(sessionId) {
        this.drawDesktop(sessionId);
    }
}

// Main
const apu = new APUClient();
apu.connect().then(() => {
    console.log('Windows 3.1 demo ready. Connect via telnet on port 6123');
}).catch(err => {
    console.error('Failed to connect:', err.message);
    process.exit(1);
});
