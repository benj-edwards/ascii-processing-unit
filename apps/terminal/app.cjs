/**
 * Terminal App
 * Telnet terminal emulator for connecting to remote hosts
 */

const BLACK = 0, WHITE = 7, GRAY = 8;

class TerminalApp {
    constructor(context) {
        this.context = context;
        this.window = context.window;
        this.apu = context.apu;
        this.session = context.session;

        // Terminal state
        this.connected = false;
        this.host = null;
        this.port = null;
        this.localEcho = false;
        this.lineEnding = 'cr';  // 'cr' or 'crlf'

        // Fullscreen state
        this.isFullscreen = false;
        this.savedX = null;
        this.savedY = null;
        this.savedWidth = null;
        this.savedHeight = null;
    }

    onInit() {
        this.draw();
    }

    onFocus() {
        this.draw();
    }

    onBlur() {
        this.draw(false);
    }

    onResize(width, height) {
        this.window.width = width;
        this.window.height = height;

        if (this.connected) {
            // Resize the APU terminal
            this.apu.send({
                cmd: 'resize_terminal',
                id: this.window.id,
                x: this.isFullscreen ? 0 : this.window.x,
                y: this.isFullscreen ? 1 : this.window.y,
                width: width,
                height: height,
                border: this.isFullscreen ? 'none' : 'single',
                title: this.isFullscreen ? null : `${this.host}:${this.port}`,
                closable: !this.isFullscreen,
                resizable: !this.isFullscreen,
                draggable: !this.isFullscreen
            });
        } else {
            this.draw();
        }
    }

    onClose() {
        if (this.connected) {
            this.disconnect();
        }
        return true; // Allow close
    }

    onDestroy() {
        if (this.connected) {
            this.disconnect();
        }
    }

    onKeyPress(key, modifiers) {
        // Keys are forwarded to APU terminal automatically when connected
        // This handler is for when terminal is not connected
        if (!this.connected) {
            // Could implement keyboard shortcuts here
        }
    }

    onMouseClick(x, y, button) {
        // Mouse events forwarded to APU terminal when connected
    }

    onMenuAction(action, data) {
        switch (action) {
            case 'newWindow':
                this.context.launchApp('terminal');
                break;

            case 'connect':
                if (data && data.host && data.port) {
                    this.connect(data.host, data.port);
                }
                break;

            case 'customConnect':
                // TODO: Show connection dialog
                break;

            case 'disconnect':
                this.disconnect();
                break;

            case 'toggleLocalEcho':
                this.localEcho = !this.localEcho;
                if (this.connected) {
                    this.apu.send({
                        cmd: 'terminal_settings',
                        id: this.window.id,
                        local_echo: this.localEcho
                    });
                }
                break;

            case 'setLineEnding':
                this.lineEnding = data;
                if (this.connected) {
                    this.apu.send({
                        cmd: 'terminal_settings',
                        id: this.window.id,
                        line_ending: this.lineEnding
                    });
                }
                break;

            case 'toggleFullscreen':
                this.toggleFullscreen();
                break;

            case 'close':
                this.window.close();
                break;
        }
    }

    // Connect to a remote host
    connect(host, port) {
        if (this.connected) {
            this.disconnect();
        }

        this.host = host;
        this.port = port;

        // Remove placeholder window
        this.apu.send({ cmd: 'remove_window', id: this.window.id });

        // Create APU terminal
        this.apu.send({
            cmd: 'create_terminal',
            id: this.window.id,
            host: host,
            port: port,
            x: this.isFullscreen ? 0 : this.window.x,
            y: this.isFullscreen ? 1 : this.window.y,
            width: this.isFullscreen ? 80 : this.window.width,
            height: this.isFullscreen ? 23 : this.window.height,
            terminal_type: 'ansi',
            border: this.isFullscreen ? 'none' : 'single',
            title: this.isFullscreen ? null : `${host}:${port}`,
            closable: !this.isFullscreen,
            resizable: !this.isFullscreen
        });

        this.connected = true;
        console.log(`Terminal connecting to ${host}:${port}`);
    }

    // Disconnect from remote host
    disconnect() {
        if (this.connected) {
            this.apu.send({
                cmd: 'close_terminal',
                id: this.window.id
            });
            this.connected = false;
            this.host = null;
            this.port = null;

            // Redraw disconnected state
            this.draw();
            this.apu.send({ cmd: 'flush', force_full: true });
        }
    }

    // Toggle fullscreen mode
    toggleFullscreen() {
        if (this.isFullscreen) {
            // Restore windowed mode
            this.window.x = this.savedX;
            this.window.y = this.savedY;
            this.window.width = this.savedWidth;
            this.window.height = this.savedHeight;
            this.isFullscreen = false;
        } else {
            // Save current size and go fullscreen
            this.savedX = this.window.x;
            this.savedY = this.window.y;
            this.savedWidth = this.window.width;
            this.savedHeight = this.window.height;

            this.window.x = 0;
            this.window.y = 1;  // Below menu bar
            this.window.width = 80;
            this.window.height = 23;
            this.isFullscreen = true;
        }

        if (this.connected) {
            this.apu.send({
                cmd: 'resize_terminal',
                id: this.window.id,
                x: this.window.x,
                y: this.window.y,
                width: this.window.width,
                height: this.window.height,
                border: this.isFullscreen ? 'none' : 'single',
                title: this.isFullscreen ? null : `${this.host}:${this.port}`,
                closable: !this.isFullscreen,
                resizable: !this.isFullscreen,
                draggable: !this.isFullscreen
            });
        } else {
            this.draw();
        }

        this.apu.send({ cmd: 'flush', force_full: true });
    }

    // Draw the terminal window (when not connected)
    draw(isFocused = true) {
        const win = this.window;

        if (this.isFullscreen) {
            // Fullscreen: no border
            this.apu.send({
                cmd: 'create_window',
                id: win.id,
                x: 0, y: 1,
                width: 80, height: 23,
                border: 'none',
                closable: false,
                resizable: false,
                draggable: false
            });

            // Fill with black
            this.apu.send({
                cmd: 'fill',
                window: win.id,
                x: 0, y: 0,
                width: 80, height: 23,
                char: ' ',
                fg: WHITE,
                bg: BLACK
            });
        } else {
            // Windowed: Mac-style chrome
            this.context.drawWindowChrome(win.id, win.x, win.y, win.width, win.height, 'Terminal', {
                resizable: true,
                isFocused: isFocused
            });

            // Fill content with black
            this.apu.send({
                cmd: 'fill',
                window: win.id,
                x: 1, y: 1,
                width: win.width - 2,
                height: win.height - 3,
                char: ' ',
                fg: WHITE,
                bg: BLACK
            });
        }

        // Show connection prompt
        const yOffset = this.isFullscreen ? 0 : 1;
        this.apu.send({
            cmd: 'print',
            window: win.id,
            x: 2, y: yOffset + 1,
            text: 'Terminal Ready',
            fg: WHITE,
            bg: BLACK
        });

        this.apu.send({
            cmd: 'print',
            window: win.id,
            x: 2, y: yOffset + 3,
            text: 'Use Connection menu to connect:',
            fg: GRAY,
            bg: BLACK
        });

        this.apu.send({
            cmd: 'print',
            window: win.id,
            x: 4, y: yOffset + 5,
            text: '* Cave BBS (telnet port 23)',
            fg: GRAY,
            bg: BLACK
        });

        this.apu.send({
            cmd: 'print',
            window: win.id,
            x: 4, y: yOffset + 6,
            text: '* CaveMUSH (port 6116)',
            fg: GRAY,
            bg: BLACK
        });

        this.apu.send({
            cmd: 'print',
            window: win.id,
            x: 4, y: yOffset + 7,
            text: '* Custom host/port',
            fg: GRAY,
            bg: BLACK
        });

        this.apu.send({ cmd: 'bring_to_front', id: win.id });
    }

    // Called when terminal connects
    onTerminalConnected() {
        this.connected = true;
    }

    // Called when terminal disconnects
    onTerminalDisconnected() {
        this.connected = false;
        this.host = null;
        this.port = null;
        this.draw();
        this.apu.send({ cmd: 'flush', force_full: true });
    }
}

module.exports = TerminalApp;
