/**
 * Desktop Environment
 * Manages desktop, menu bar, file manager windows, and app launching
 */

// Color constants
const BLACK = 0, WHITE = 7, GRAY = 8, BRIGHT_WHITE = 15;

class Desktop {
    constructor(sessionManager, appLoader, vfs, apuConnection) {
        this.sessionManager = sessionManager;
        this.appLoader = appLoader;
        this.vfs = vfs;
        this.apu = apuConnection;

        // Screen dimensions
        this.COLS = 80;
        this.ROWS = 24;

        // Desktop patterns
        this.patterns = ['░', '▒', '▓', '█', ' ', '·', ':', '∙'];
    }

    /**
     * Send APU command for a session
     */
    sendCmd(sessionId, cmd) {
        this.apu.sendTo(sessionId, cmd);
    }

    // ============== Initialization ==============

    /**
     * Initialize a new session's display
     */
    initSession(sessionId) {
        const session = this.sessionManager.getSession(sessionId);

        // Initialize APU display
        this.sendCmd(sessionId, { cmd: 'init', cols: this.COLS, rows: this.ROWS });
        this.sendCmd(sessionId, { cmd: 'enable_mouse', mode: 'any' });

        // Create initial Finder window
        this.createFinderWindow(sessionId, 'Macintosh HD', '/');

        // Draw everything
        this.redrawSession(sessionId);
    }

    /**
     * Full redraw of session
     */
    redrawSession(sessionId) {
        const session = this.sessionManager.getSession(sessionId);

        // Draw desktop background
        this.drawDesktopBackground(sessionId);

        // Draw menu bar
        this.drawMenuBar(sessionId);

        // Draw all windows
        for (const win of session.windows) {
            this.drawWindow(sessionId, win, win.id === session.activeWindow);
        }

        // Draw cursor
        this.drawCursor(sessionId);

        this.sendCmd(sessionId, { cmd: 'flush', force_full: true });
    }

    // ============== Drawing ==============

    /**
     * Draw desktop background pattern
     */
    drawDesktopBackground(sessionId) {
        const session = this.sessionManager.getSession(sessionId);
        const pattern = this.patterns[session.prefs.desktopPattern] || '░';

        // Fill screen with pattern (below menu bar)
        this.sendCmd(sessionId, {
            cmd: 'fill',
            x: 0, y: 1,
            width: this.COLS,
            height: this.ROWS - 1,
            char: pattern,
            fg: GRAY,
            bg: WHITE
        });
    }

    /**
     * Draw menu bar
     */
    drawMenuBar(sessionId) {
        const session = this.sessionManager.getSession(sessionId);

        // Get menus based on active app
        const menus = this.getMenusForApp(session.menuBarApp);

        // White bar
        this.sendCmd(sessionId, {
            cmd: 'fill',
            x: 0, y: 0,
            width: this.COLS, height: 1,
            char: ' ', fg: BLACK, bg: WHITE
        });

        // Apple menu
        this.sendCmd(sessionId, {
            cmd: 'print',
            x: 1, y: 0,
            text: '@',
            fg: BLACK, bg: WHITE
        });

        // App menus
        let x = 4;
        for (const menu of menus) {
            this.sendCmd(sessionId, {
                cmd: 'print',
                x: x, y: 0,
                text: menu.label,
                fg: BLACK, bg: WHITE
            });
            x += menu.label.length + 2;
        }

        // Clock on right side
        const time = new Date().toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });
        this.sendCmd(sessionId, {
            cmd: 'print',
            x: this.COLS - time.length - 1, y: 0,
            text: time,
            fg: BLACK, bg: WHITE
        });
    }

    /**
     * Get menus for current app
     */
    getMenusForApp(appId) {
        if (appId === 'finder') {
            return [
                { label: 'File', items: ['New Folder', 'Open', 'Close Window', '-', 'Get Info'] },
                { label: 'Edit', items: ['Undo', '-', 'Cut', 'Copy', 'Paste', 'Clear', 'Select All'] },
                { label: 'View', items: ['by Icon', 'by Name', 'by Date', 'by Size'] },
                { label: 'Special', items: ['Clean Up', 'Empty Trash', '-', 'Restart', 'Shut Down'] }
            ];
        }

        // Get menus from app manifest
        const manifest = this.appLoader.getManifest(appId);
        if (manifest && manifest.menu) {
            return manifest.menu;
        }

        return [];
    }

    /**
     * Draw Mac-style window chrome
     */
    drawWindowChrome(sessionId, windowId, x, y, width, height, title, options = {}) {
        const isFocused = options.isFocused !== false;
        const resizable = options.resizable !== false;

        // Create window in APU
        this.sendCmd(sessionId, {
            cmd: 'create_window',
            id: windowId,
            x, y, width, height,
            border: 'none',
            closable: true,
            resizable: resizable,
            draggable: true,
            min_width: options.minWidth || 15,
            min_height: options.minHeight || 5
        });

        // Fill with white background
        this.sendCmd(sessionId, {
            cmd: 'fill',
            window: windowId,
            x: 0, y: 0,
            width, height,
            char: ' ', fg: BLACK, bg: WHITE
        });

        // Border
        const borderChar = isFocused ? '█' : '░';
        const borderFg = isFocused ? BLACK : GRAY;

        // Top border
        for (let i = 0; i < width; i++) {
            this.sendCmd(sessionId, {
                cmd: 'set_cell', window: windowId,
                x: i, y: 0,
                char: i === 0 ? '┌' : (i === width - 1 ? '┐' : '─'),
                fg: borderFg, bg: WHITE
            });
        }

        // Bottom border
        for (let i = 0; i < width; i++) {
            this.sendCmd(sessionId, {
                cmd: 'set_cell', window: windowId,
                x: i, y: height - 1,
                char: i === 0 ? '└' : (i === width - 1 ? '┘' : '─'),
                fg: borderFg, bg: WHITE
            });
        }

        // Side borders
        for (let i = 1; i < height - 1; i++) {
            this.sendCmd(sessionId, {
                cmd: 'set_cell', window: windowId,
                x: 0, y: i, char: '│', fg: borderFg, bg: WHITE
            });
            this.sendCmd(sessionId, {
                cmd: 'set_cell', window: windowId,
                x: width - 1, y: i, char: '│', fg: borderFg, bg: WHITE
            });
        }

        // Close box (top left, inside border)
        this.sendCmd(sessionId, {
            cmd: 'print', window: windowId,
            x: 1, y: 0,
            text: '[■]',
            fg: BLACK, bg: WHITE
        });

        // Title (centered)
        const maxTitleWidth = width - 10;
        let displayTitle = title;
        if (displayTitle.length > maxTitleWidth) {
            displayTitle = displayTitle.substring(0, maxTitleWidth - 1) + '…';
        }
        const titleX = Math.floor((width - displayTitle.length) / 2);
        this.sendCmd(sessionId, {
            cmd: 'print', window: windowId,
            x: titleX, y: 0,
            text: displayTitle,
            fg: BLACK, bg: WHITE
        });

        // Resize handle (bottom right)
        if (resizable) {
            this.sendCmd(sessionId, {
                cmd: 'set_cell', window: windowId,
                x: width - 2, y: height - 1,
                char: '◢', fg: BLACK, bg: WHITE
            });
        }
    }

    /**
     * Draw a window (dispatches to appropriate drawer based on type)
     */
    drawWindow(sessionId, win, isFocused) {
        const app = this.sessionManager.getApp(sessionId, win.id);

        if (app && app.draw) {
            // App handles its own drawing
            app.draw(isFocused);
        } else if (win.isFinderWindow) {
            // Finder window
            this.drawFinderWindow(sessionId, win, isFocused);
        } else {
            // Generic window
            this.drawWindowChrome(sessionId, win.id, win.x, win.y, win.width, win.height, win.title, {
                isFocused,
                resizable: win.resizable
            });
        }
    }

    /**
     * Draw cursor
     */
    drawCursor(sessionId) {
        // Cursor is handled by APU's cursor window
    }

    // ============== Finder Windows ==============

    /**
     * Create a Finder window showing a directory
     */
    createFinderWindow(sessionId, title, virtualPath) {
        const session = this.sessionManager.getSession(sessionId);

        const win = this.sessionManager.createWindow(sessionId, {
            title: title,
            x: 3 + session.windows.length * 2,
            y: 3 + session.windows.length,
            width: 35,
            height: 12,
            resizable: true,
            custom: {
                isFinderWindow: true,
                folderPath: virtualPath,
                viewMode: 'icon',
                scrollX: 0,
                scrollY: 0,
                selectedFile: -1
            }
        });

        return win;
    }

    /**
     * Draw Finder window contents
     */
    drawFinderWindow(sessionId, win, isFocused) {
        // Draw chrome
        this.drawWindowChrome(sessionId, win.id, win.x, win.y, win.width, win.height, win.title, {
            isFocused,
            resizable: true
        });

        // Get directory contents
        const session = this.sessionManager.getSession(sessionId);
        const files = this.vfs.readDir(session.ip, win.folderPath);

        // Draw files in icon view
        const iconWidth = 10;
        const iconHeight = 4;
        const contentWidth = win.width - 2;
        const contentHeight = win.height - 2;
        const iconsPerRow = Math.floor(contentWidth / iconWidth);

        let idx = 0;
        for (const file of files) {
            const col = idx % iconsPerRow;
            const row = Math.floor(idx / iconsPerRow);

            const iconX = 1 + col * iconWidth;
            const iconY = 1 + row * iconHeight;

            if (iconY + iconHeight > win.height - 1) break;  // Don't draw past window

            const isSelected = idx === win.selectedFile;
            this.drawIcon(sessionId, win.id, iconX, iconY, file, isSelected);

            idx++;
        }
    }

    /**
     * Draw a file/folder icon
     */
    drawIcon(sessionId, windowId, x, y, file, isSelected) {
        const fg = isSelected ? WHITE : BLACK;
        const bg = isSelected ? BLACK : WHITE;

        // Icon character
        let iconChar;
        if (file.type === 'folder') {
            iconChar = '▓▓\n█▀█\n▀▀▀';
        } else if (file.type === 'app') {
            iconChar = file.icon ? file.icon.char : '◆';
        } else {
            iconChar = '┌─╮\n│ │\n└─┘';
        }

        // Draw icon (simplified - just the char)
        this.sendCmd(sessionId, {
            cmd: 'print', window: windowId,
            x: x + 3, y: y,
            text: file.type === 'folder' ? '▓' : (file.type === 'app' ? '◆' : '□'),
            fg: fg, bg: bg
        });

        // Draw name (truncated)
        let name = file.name;
        if (name.length > 9) {
            name = name.substring(0, 8) + '…';
        }

        this.sendCmd(sessionId, {
            cmd: 'print', window: windowId,
            x: x, y: y + 2,
            text: name.padEnd(9),
            fg: fg, bg: bg
        });
    }

    // ============== App Launching ==============

    /**
     * Launch an app
     */
    launchApp(sessionId, appId, options = {}) {
        const app = this.appLoader.getApp(appId);
        if (!app) {
            console.error(`Unknown app: ${appId}`);
            return null;
        }

        const manifest = app.manifest;
        const session = this.sessionManager.getSession(sessionId);

        // Create window for app
        const win = this.sessionManager.createWindow(sessionId, {
            title: manifest.name,
            x: options.x || (5 + session.windows.length * 2),
            y: options.y || (2 + session.windows.length),
            width: options.width || manifest.window.defaultWidth,
            height: options.height || manifest.window.defaultHeight,
            minWidth: manifest.window.minWidth,
            minHeight: manifest.window.minHeight,
            resizable: manifest.window.resizable,
            closable: manifest.window.closable,
            appId: appId
        });

        // Create app context
        const context = this.createAppContext(sessionId, win, appId);

        // Create app instance
        const appInstance = this.appLoader.createInstance(appId, context);

        // Register app
        this.sessionManager.registerApp(sessionId, win.id, appInstance);

        // Set menu bar to this app
        session.menuBarApp = appId;

        // Initialize app
        if (appInstance.onInit) {
            appInstance.onInit();
        }

        // Redraw menu bar
        this.drawMenuBar(sessionId);
        this.sendCmd(sessionId, { cmd: 'flush' });

        return win;
    }

    /**
     * Create app context object
     */
    createAppContext(sessionId, win, appId) {
        const self = this;
        const session = this.sessionManager.getSession(sessionId);

        return {
            window: {
                id: win.id,
                get title() { return win.title; },
                get x() { return win.x; },
                get y() { return win.y; },
                get width() { return win.width; },
                get height() { return win.height; },

                setTitle(title) {
                    win.title = title;
                    self.drawWindow(sessionId, win, true);
                },

                close() {
                    self.closeWindow(sessionId, win.id);
                }
            },

            apu: {
                send: (cmd) => {
                    cmd.session = sessionId;
                    if (!cmd.window) cmd.window = win.id;
                    self.sendCmd(sessionId, cmd);
                }
            },

            fs: {
                readFile: (path) => self.vfs.readFile(session.ip, path),
                writeFile: (path, content) => self.vfs.writeFile(session.ip, path, content),
                readDir: (path) => self.vfs.readDir(session.ip, path),
                exists: (path) => self.vfs.exists(session.ip, path),
                mkdir: (path) => self.vfs.mkdir(session.ip, path),
                delete: (path) => self.vfs.delete(session.ip, path)
            },

            session: {
                id: sessionId,
                ip: session.ip,
                get clipboard() { return session.clipboard; },
                set clipboard(val) { session.clipboard = val; }
            },

            drawWindowChrome: (id, x, y, w, h, title, opts) => {
                self.drawWindowChrome(sessionId, id, x, y, w, h, title, opts);
            },

            launchApp: (appId, opts) => self.launchApp(sessionId, appId, opts)
        };
    }

    // ============== Window Operations ==============

    /**
     * Close a window
     */
    closeWindow(sessionId, windowId) {
        const app = this.sessionManager.getApp(sessionId, windowId);

        // Ask app if close is OK
        if (app && app.onClose) {
            const allowClose = app.onClose();
            if (allowClose === false) {
                return false;
            }
        }

        // Remove window from APU
        this.sendCmd(sessionId, { cmd: 'remove_window', id: windowId });

        // Remove from session
        this.sessionManager.removeWindow(sessionId, windowId);

        // Update menu bar if needed
        const session = this.sessionManager.getSession(sessionId);
        if (session.windows.length === 0) {
            session.menuBarApp = 'finder';
        } else {
            const activeWin = this.sessionManager.getActiveWindow(sessionId);
            if (activeWin && activeWin.appId) {
                session.menuBarApp = activeWin.appId;
            } else {
                session.menuBarApp = 'finder';
            }
        }

        this.drawMenuBar(sessionId);
        this.sendCmd(sessionId, { cmd: 'flush' });

        return true;
    }

    /**
     * Handle window focus change
     */
    focusWindow(sessionId, windowId) {
        const session = this.sessionManager.getSession(sessionId);
        const prevActive = session.activeWindow;

        if (prevActive === windowId) return;

        // Blur previous
        if (prevActive) {
            const prevApp = this.sessionManager.getApp(sessionId, prevActive);
            if (prevApp && prevApp.onBlur) {
                prevApp.onBlur();
            }
        }

        // Bring to front and focus
        this.sessionManager.bringToFront(sessionId, windowId);

        // Focus new
        const newApp = this.sessionManager.getApp(sessionId, windowId);
        if (newApp && newApp.onFocus) {
            newApp.onFocus();
        }

        // Update menu bar
        const win = this.sessionManager.getWindow(sessionId, windowId);
        if (win && win.appId) {
            session.menuBarApp = win.appId;
        } else {
            session.menuBarApp = 'finder';
        }

        this.drawMenuBar(sessionId);
        this.sendCmd(sessionId, { cmd: 'flush' });
    }

    // ============== Input Handling ==============

    /**
     * Handle input event from APU
     */
    handleInput(sessionId, event) {
        this.sessionManager.touch(sessionId);

        if (event.type === 'key') {
            this.handleKeyPress(sessionId, event);
        } else if (event.type === 'mouse') {
            this.handleMouse(sessionId, event);
        }
    }

    /**
     * Handle key press
     */
    handleKeyPress(sessionId, event) {
        const activeApp = this.sessionManager.getActiveApp(sessionId);

        if (activeApp && activeApp.onKeyPress) {
            activeApp.onKeyPress(event.key, {
                ctrl: event.ctrl || false,
                alt: event.alt || false,
                shift: event.shift || false
            });
        }
    }

    /**
     * Handle mouse event
     */
    handleMouse(sessionId, event) {
        const session = this.sessionManager.getSession(sessionId);

        // Find window at click position
        const win = this.sessionManager.getWindowAt(sessionId, event.x, event.y);

        if (win) {
            // Focus window on click
            if (event.button === 'left' && event.event === 'press') {
                this.focusWindow(sessionId, win.id);
            }

            // Pass to app
            const app = this.sessionManager.getApp(sessionId, win.id);
            if (app && app.onMouseClick) {
                // Convert to window-local coordinates
                const localX = event.x - win.x;
                const localY = event.y - win.y;
                app.onMouseClick(localX, localY, event.button, event.event);
            }
        }
    }
}

module.exports = Desktop;
