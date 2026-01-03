#!/usr/bin/env node
/**
 * APU Hello World Example
 *
 * Demonstrates basic APU usage:
 * - Connecting to APU server
 * - Drawing text directly to screen
 * - Creating a window
 * - Handling input events
 *
 * Usage:
 *   1. Start APU server: ./target/release/apu-server 6121 6123
 *   2. Run this example: node examples/hello.js
 *   3. Connect with telnet: telnet localhost 6123
 */

const net = require('net');

const APU_HOST = process.env.APU_HOST || 'localhost';
const APU_PORT = parseInt(process.env.APU_PORT || '6121');

// Connect to APU
const socket = net.createConnection(APU_PORT, APU_HOST, () => {
    console.log('Connected to APU server');
    init();
});

// Send JSON command to APU
function send(cmd) {
    socket.write(JSON.stringify(cmd) + '\n');
}

// Initialize display
function init() {
    // Set up 80x24 display
    send({ cmd: 'init', cols: 80, rows: 24 });

    // Enable mouse support
    send({ cmd: 'enable_mouse', mode: 'any' });

    // Draw background pattern
    for (let y = 0; y < 24; y++) {
        for (let x = 0; x < 80; x++) {
            const char = (x + y) % 2 === 0 ? '░' : '▒';
            send({ cmd: 'set_direct', x, y, char, fg: 8, bg: 0 });
        }
    }

    // Create main window
    send({
        cmd: 'create_window',
        id: 'main',
        x: 20,
        y: 6,
        width: 40,
        height: 12,
        border: 'double',
        title: 'Hello APU!',
        closable: true,
        draggable: true,
        resizable: true
    });

    // Draw content in window
    send({ cmd: 'print', window: 'main', x: 2, y: 2, text: 'Welcome to APU!', fg: 11 });
    send({ cmd: 'print', window: 'main', x: 2, y: 4, text: 'APU is a universal character-cell', fg: 7 });
    send({ cmd: 'print', window: 'main', x: 2, y: 5, text: 'display engine for terminal apps.', fg: 7 });
    send({ cmd: 'print', window: 'main', x: 2, y: 7, text: 'Try:', fg: 14 });
    send({ cmd: 'print', window: 'main', x: 4, y: 8, text: '- Drag the window title bar', fg: 7 });
    send({ cmd: 'print', window: 'main', x: 4, y: 9, text: '- Resize from bottom-right corner', fg: 7 });
    send({ cmd: 'print', window: 'main', x: 4, y: 10, text: '- Press Q to quit', fg: 7 });

    // Flush to render
    send({ cmd: 'flush', force_full: true });

    console.log('Display initialized. Connect with: telnet localhost 6123');
}

// Handle events from APU
let buffer = '';
socket.on('data', (data) => {
    buffer += data.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
        if (!line.trim()) continue;

        try {
            const event = JSON.parse(line);
            handleEvent(event);
        } catch (e) {
            console.error('Invalid JSON:', line);
        }
    }
});

function handleEvent(event) {
    switch (event.type) {
        case 'client_connect':
            console.log('Client connected:', event.session);
            // Re-send display to new client
            send({ cmd: 'flush', force_full: true });
            break;

        case 'client_disconnect':
            console.log('Client disconnected:', event.session);
            break;

        case 'input':
            handleInput(event.session, event.event);
            break;

        case 'window_moved':
            console.log(`Window ${event.window} moved to ${event.x}, ${event.y}`);
            break;

        case 'window_resized':
            console.log(`Window ${event.window} resized to ${event.width}x${event.height}`);
            break;

        case 'window_close_requested':
            console.log(`Window ${event.window} close requested`);
            if (event.window === 'main') {
                console.log('Main window closed, exiting...');
                process.exit(0);
            }
            break;
    }
}

function handleInput(session, input) {
    if (input.key) {
        console.log(`Key: ${input.key}`);

        // Quit on 'q' or 'Q'
        if (input.key === 'q' || input.key === 'Q') {
            console.log('Quit requested');
            send({ cmd: 'shutdown' });
            process.exit(0);
        }
    }

    if (input.mouse) {
        // Mouse events are handled by APU for window dragging/resizing
        // You can add custom mouse handling here
    }
}

socket.on('close', () => {
    console.log('Disconnected from APU');
    process.exit(0);
});

socket.on('error', (err) => {
    console.error('Connection error:', err.message);
    console.log('Make sure APU server is running: ./target/release/apu-server 6121 6123');
    process.exit(1);
});

// Handle Ctrl+C
process.on('SIGINT', () => {
    console.log('\nShutting down...');
    send({ cmd: 'shutdown' });
    socket.end();
    process.exit(0);
});
