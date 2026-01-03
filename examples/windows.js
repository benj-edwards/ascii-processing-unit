#!/usr/bin/env node
/**
 * APU Windows Example
 *
 * Demonstrates APU window management:
 * - Multiple overlapping windows
 * - Different border styles
 * - Z-ordering (bring to front)
 * - Window operations (create, move, resize, close)
 *
 * Usage:
 *   1. Start APU server: ./target/release/apu-server 6121 6123
 *   2. Run this example: node examples/windows.js
 *   3. Connect with telnet: telnet localhost 6123
 */

const net = require('net');

const APU_HOST = process.env.APU_HOST || 'localhost';
const APU_PORT = parseInt(process.env.APU_PORT || '6121');

const socket = net.createConnection(APU_PORT, APU_HOST, () => {
    console.log('Connected to APU server');
    init();
});

function send(cmd) {
    socket.write(JSON.stringify(cmd) + '\n');
}

const BORDER_STYLES = ['single', 'double', 'rounded', 'heavy', 'ascii', 'none'];
const COLORS = {
    black: 0, red: 1, green: 2, yellow: 3,
    blue: 4, magenta: 5, cyan: 6, white: 7,
    gray: 8, brightRed: 9, brightGreen: 10, brightYellow: 11,
    brightBlue: 12, brightMagenta: 13, brightCyan: 14, brightWhite: 15
};

let windowCount = 0;

function init() {
    send({ cmd: 'init', cols: 80, rows: 24 });
    send({ cmd: 'enable_mouse', mode: 'any' });

    // Fill background with dots
    send({
        cmd: 'batch',
        ops: Array.from({ length: 80 * 24 }, (_, i) => ({
            cmd: 'set_direct',
            x: i % 80,
            y: Math.floor(i / 80),
            char: '·',
            fg: COLORS.gray,
            bg: COLORS.black
        }))
    });

    // Create help window
    createWindow('help', 2, 1, 30, 8, 'single', 'Help');
    send({ cmd: 'print', window: 'help', x: 1, y: 1, text: 'Keyboard:', fg: COLORS.brightYellow });
    send({ cmd: 'print', window: 'help', x: 1, y: 2, text: 'N - New window', fg: COLORS.white });
    send({ cmd: 'print', window: 'help', x: 1, y: 3, text: 'C - Close top window', fg: COLORS.white });
    send({ cmd: 'print', window: 'help', x: 1, y: 4, text: '1-6 - Change border style', fg: COLORS.white });
    send({ cmd: 'print', window: 'help', x: 1, y: 5, text: 'Q - Quit', fg: COLORS.white });
    send({ cmd: 'print', window: 'help', x: 1, y: 6, text: 'Click window to focus', fg: COLORS.gray });

    // Create some demo windows
    createWindow('demo1', 35, 2, 25, 10, 'double', 'Double Border');
    send({ cmd: 'print', window: 'demo1', x: 1, y: 1, text: 'This window has', fg: COLORS.brightCyan });
    send({ cmd: 'print', window: 'demo1', x: 1, y: 2, text: 'a double border.', fg: COLORS.brightCyan });
    send({ cmd: 'print', window: 'demo1', x: 1, y: 4, text: 'Drag me!', fg: COLORS.brightYellow });

    createWindow('demo2', 10, 10, 30, 8, 'rounded', 'Rounded Corners');
    send({ cmd: 'print', window: 'demo2', x: 1, y: 1, text: 'Rounded border style', fg: COLORS.brightGreen });
    send({ cmd: 'print', window: 'demo2', x: 1, y: 3, text: 'Try resizing from', fg: COLORS.white });
    send({ cmd: 'print', window: 'demo2', x: 1, y: 4, text: 'bottom-right corner!', fg: COLORS.white });

    createWindow('demo3', 45, 13, 28, 9, 'heavy', 'Heavy Border');
    send({ cmd: 'print', window: 'demo3', x: 1, y: 1, text: 'Heavy border style', fg: COLORS.brightMagenta });
    send({ cmd: 'print', window: 'demo3', x: 1, y: 3, text: 'Click the X to close', fg: COLORS.white });

    send({ cmd: 'flush', force_full: true });
    console.log('Windows demo ready. Connect with: telnet localhost 6123');
}

function createWindow(id, x, y, w, h, border, title) {
    send({
        cmd: 'create_window',
        id: id,
        x: x,
        y: y,
        width: w,
        height: h,
        border: border,
        title: title,
        closable: true,
        draggable: true,
        resizable: true,
        min_width: 15,
        min_height: 5
    });
    windowCount++;
}

function createNewWindow() {
    const id = `win_${Date.now()}`;
    const x = 5 + (windowCount % 5) * 8;
    const y = 3 + (windowCount % 4) * 4;
    const border = BORDER_STYLES[windowCount % BORDER_STYLES.length];
    const title = `Window ${windowCount + 1}`;

    createWindow(id, x, y, 28, 10, border, title);

    send({ cmd: 'print', window: id, x: 1, y: 1, text: `Border: ${border}`, fg: COLORS.brightYellow });
    send({ cmd: 'print', window: id, x: 1, y: 3, text: 'This is a new window!', fg: COLORS.white });
    send({ cmd: 'print', window: id, x: 1, y: 5, text: `ID: ${id}`, fg: COLORS.gray });

    send({ cmd: 'flush' });
    console.log(`Created window: ${id}`);
}

let buffer = '';
socket.on('data', (data) => {
    buffer += data.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
        if (!line.trim()) continue;
        try {
            handleEvent(JSON.parse(line));
        } catch (e) {
            console.error('Parse error:', e.message);
        }
    }
});

function handleEvent(event) {
    switch (event.type) {
        case 'client_connect':
            console.log('Client connected:', event.session);
            send({ cmd: 'flush', force_full: true });
            break;

        case 'client_disconnect':
            console.log('Client disconnected:', event.session);
            break;

        case 'input':
            handleInput(event.event);
            break;

        case 'window_close_requested':
            console.log(`Closing window: ${event.window}`);
            send({ cmd: 'remove_window', id: event.window });
            send({ cmd: 'flush' });
            windowCount--;
            break;

        case 'window_moved':
            console.log(`Window ${event.window} moved to (${event.x}, ${event.y})`);
            break;

        case 'window_resized':
            console.log(`Window ${event.window} resized to ${event.width}x${event.height}`);
            break;

        case 'window_focused':
            console.log(`Window ${event.window} focused`);
            break;
    }
}

function handleInput(input) {
    if (!input.key) return;

    const key = input.key.toLowerCase();

    switch (key) {
        case 'n':
            createNewWindow();
            break;

        case 'q':
            console.log('Quitting...');
            send({ cmd: 'shutdown' });
            process.exit(0);
            break;

        case '1':
        case '2':
        case '3':
        case '4':
        case '5':
        case '6':
            const style = BORDER_STYLES[parseInt(key) - 1];
            console.log(`Border style: ${style}`);
            break;
    }
}

socket.on('close', () => {
    console.log('Disconnected');
    process.exit(0);
});

socket.on('error', (err) => {
    console.error('Error:', err.message);
    process.exit(1);
});

process.on('SIGINT', () => {
    send({ cmd: 'shutdown' });
    socket.end();
    process.exit(0);
});
