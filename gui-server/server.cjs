/**
 * GUI Server - Main Entry Point
 * Connects to APU and manages the desktop environment
 */

const net = require('net');
const path = require('path');
const fs = require('fs');

const AppLoader = require('./app-loader.cjs');
const VirtualFilesystem = require('./vfs.cjs');
const SessionManager = require('./session.cjs');
const Desktop = require('./desktop.cjs');

// Configuration
const APU_HOST = process.env.APU_HOST || 'localhost';
const APU_PORT = parseInt(process.env.APU_PORT || '6121');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const APPS_DIR = process.env.APPS_DIR || path.join(__dirname, '..', 'apps');

// Logging
function log(level, category, message, data = {}) {
    const timestamp = new Date().toISOString().slice(11, 19);
    const dataStr = Object.keys(data).length > 0
        ? ' ' + Object.entries(data).map(([k,v]) => `${k}=${v}`).join(' ')
        : '';
    console.log(`[${timestamp}] [${level}] [${category}]${dataStr} ${message}`);
}

class GUIServer {
    constructor() {
        this.apuSocket = null;
        this.connected = false;
        this.reconnectTimer = null;
        this.messageBuffer = '';

        // Ensure data directory exists
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }

        // Initialize components
        this.appLoader = new AppLoader(APPS_DIR);
        this.sessionManager = new SessionManager();
        this.vfs = new VirtualFilesystem(DATA_DIR, this.appLoader);
        this.desktop = null;  // Created after APU connection

        // Discover apps
        this.appLoader.discover();
    }

    /**
     * Start the GUI server
     */
    start() {
        log('INFO', 'SERVER', 'GUI Server starting...');
        log('INFO', 'SERVER', `APU target: ${APU_HOST}:${APU_PORT}`);
        log('INFO', 'SERVER', `Data directory: ${DATA_DIR}`);
        log('INFO', 'SERVER', `Apps directory: ${APPS_DIR}`);
        log('INFO', 'SERVER', `Loaded ${this.appLoader.getAppIds().length} apps`);

        this.connectToAPU();
    }

    /**
     * Connect to APU server
     */
    connectToAPU() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        log('INFO', 'APU', `Connecting to APU at ${APU_HOST}:${APU_PORT}...`);

        this.apuSocket = net.createConnection(APU_PORT, APU_HOST, () => {
            this.connected = true;
            log('INFO', 'APU', 'Connected to APU server');

            // Create desktop environment with APU connection
            this.desktop = new Desktop(
                this.sessionManager,
                this.appLoader,
                this.vfs,
                {
                    sendTo: (sessionId, cmd) => this.sendToAPU(sessionId, cmd)
                }
            );

            // Reconnect existing sessions
            for (const sessionId of this.sessionManager.getSessionIds()) {
                log('INFO', 'SESSION', 'Reconnecting session', { session: sessionId });
                this.desktop.initSession(sessionId);
            }
        });

        this.apuSocket.on('data', (data) => {
            this.messageBuffer += data.toString();
            this.processMessages();
        });

        this.apuSocket.on('close', () => {
            this.connected = false;
            log('WARN', 'APU', 'Disconnected from APU server');
            this.scheduleReconnect();
        });

        this.apuSocket.on('error', (err) => {
            if (err.code !== 'ECONNREFUSED') {
                log('ERROR', 'APU', `Socket error: ${err.message}`);
            }
        });
    }

    /**
     * Schedule reconnection to APU
     */
    scheduleReconnect() {
        if (this.reconnectTimer) return;

        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.connectToAPU();
        }, 2000);
    }

    /**
     * Send command to APU for a session
     */
    sendToAPU(sessionId, cmd) {
        if (!this.connected || !this.apuSocket) {
            return;
        }

        const message = {
            session: sessionId,
            ...cmd
        };

        try {
            this.apuSocket.write(JSON.stringify(message) + '\n');
        } catch (err) {
            log('ERROR', 'APU', `Send error: ${err.message}`);
        }
    }

    /**
     * Process incoming messages from APU
     */
    processMessages() {
        const lines = this.messageBuffer.split('\n');
        this.messageBuffer = lines.pop() || '';

        for (const line of lines) {
            if (!line.trim()) continue;

            try {
                const msg = JSON.parse(line);
                this.handleAPUMessage(msg);
            } catch (err) {
                log('ERROR', 'APU', `Invalid message: ${line.substring(0, 100)}`);
            }
        }
    }

    /**
     * Handle message from APU
     */
    handleAPUMessage(msg) {
        switch (msg.type) {
            case 'client_connect':
                this.handleClientConnect(msg);
                break;

            case 'client_disconnect':
                this.handleClientDisconnect(msg);
                break;

            case 'input':
                this.handleInput(msg);
                break;

            case 'window_event':
                this.handleWindowEvent(msg);
                break;

            case 'error':
                log('ERROR', 'APU', msg.message || 'Unknown error');
                break;

            default:
                // Ignore unknown message types
                break;
        }
    }

    /**
     * Handle new client connection
     */
    handleClientConnect(msg) {
        const sessionId = msg.session;
        const ip = this.sessionManager.getIpFromSessionId(sessionId);

        log('INFO', 'CLIENT', 'Connected', { session: sessionId, ip: ip });

        // Initialize session display
        if (this.desktop) {
            this.desktop.initSession(sessionId);
        }
    }

    /**
     * Handle client disconnection
     */
    handleClientDisconnect(msg) {
        const sessionId = msg.session;
        const session = this.sessionManager.getSession(sessionId);
        const ip = session ? session.ip : 'unknown';

        log('INFO', 'CLIENT', 'Disconnected', { session: sessionId, ip: ip });

        // Clean up session
        this.sessionManager.removeSession(sessionId);
    }

    /**
     * Handle input event
     */
    handleInput(msg) {
        const sessionId = msg.session;

        if (!this.sessionManager.hasSession(sessionId)) {
            // Session doesn't exist yet, create it
            this.sessionManager.getSession(sessionId);
            if (this.desktop) {
                this.desktop.initSession(sessionId);
            }
        }

        // Parse input event
        const event = this.parseInputEvent(msg);

        if (event && this.desktop) {
            // Log significant actions
            if (event.type === 'key') {
                const session = this.sessionManager.getSession(sessionId);
                const activeApp = session.menuBarApp || 'finder';
                log('DEBUG', 'INPUT', `Key: ${event.key}`, {
                    session: sessionId.slice(-8),
                    app: activeApp
                });
            }

            this.desktop.handleInput(sessionId, event);
        }
    }

    /**
     * Parse input event from APU message
     */
    parseInputEvent(msg) {
        if (msg.key !== undefined) {
            // Key event
            return {
                type: 'key',
                key: msg.key,
                ctrl: msg.ctrl || false,
                alt: msg.alt || false,
                shift: msg.shift || false
            };
        }

        if (msg.mouse_x !== undefined) {
            // Mouse event
            return {
                type: 'mouse',
                x: msg.mouse_x,
                y: msg.mouse_y,
                button: msg.button || 'left',
                event: msg.event || 'click'
            };
        }

        return null;
    }

    /**
     * Handle window event from APU
     */
    handleWindowEvent(msg) {
        const sessionId = msg.session;
        const windowId = msg.window;
        const eventType = msg.event;

        switch (eventType) {
            case 'close':
                if (this.desktop) {
                    this.desktop.closeWindow(sessionId, windowId);
                }
                break;

            case 'resize':
                const win = this.sessionManager.getWindow(sessionId, windowId);
                if (win) {
                    win.width = msg.width;
                    win.height = msg.height;

                    const app = this.sessionManager.getApp(sessionId, windowId);
                    if (app && app.onResize) {
                        app.onResize(msg.width, msg.height);
                    }
                }
                break;

            case 'move':
                const movedWin = this.sessionManager.getWindow(sessionId, windowId);
                if (movedWin) {
                    movedWin.x = msg.x;
                    movedWin.y = msg.y;
                }
                break;

            case 'focus':
                if (this.desktop) {
                    this.desktop.focusWindow(sessionId, windowId);
                }
                break;
        }
    }

    /**
     * Graceful shutdown
     */
    shutdown() {
        log('INFO', 'SERVER', 'Shutting down...');

        // Clean up all sessions
        for (const sessionId of this.sessionManager.getSessionIds()) {
            this.sessionManager.removeSession(sessionId);
        }

        // Close APU connection
        if (this.apuSocket) {
            this.apuSocket.end();
        }

        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
        }

        log('INFO', 'SERVER', 'Shutdown complete');
        process.exit(0);
    }
}

// Main entry point
const server = new GUIServer();

// Handle signals
process.on('SIGINT', () => server.shutdown());
process.on('SIGTERM', () => server.shutdown());

// Start server
server.start();
