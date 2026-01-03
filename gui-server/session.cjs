/**
 * Session Manager
 * Manages per-client session state including windows, apps, and preferences
 */

class SessionManager {
    constructor() {
        this.sessions = new Map();  // sessionId -> SessionState
    }

    /**
     * Extract IP from session ID (format: session_192_168_1_1_12345)
     */
    getIpFromSessionId(sessionId) {
        const match = sessionId.match(/^session_(.+)_\d+$/);
        if (match) {
            return match[1].replace(/_/g, '.');
        }
        return 'unknown';
    }

    /**
     * Create or get session state
     */
    getSession(sessionId) {
        if (!this.sessions.has(sessionId)) {
            this.sessions.set(sessionId, this.createSession(sessionId));
        }
        return this.sessions.get(sessionId);
    }

    /**
     * Create new session state
     */
    createSession(sessionId) {
        const ip = this.getIpFromSessionId(sessionId);

        return {
            id: sessionId,
            ip: ip,
            connectedAt: new Date().toISOString(),
            lastActivity: Date.now(),

            // Window management
            windows: [],           // Array of window objects
            activeWindow: null,    // Currently focused window ID
            nextWindowId: 1,       // Counter for unique window IDs

            // Running apps
            apps: new Map(),       // windowId -> AppInstance

            // Desktop state
            clipboard: '',         // Copy/paste buffer
            menuBarApp: 'finder',  // Current app controlling menu bar

            // Preferences (loaded from VFS)
            prefs: {
                desktopPattern: 0,
                cursorOffsetX: 0,
                cursorOffsetY: 0
            },

            // Drag state
            dragging: null,        // { type: 'window'|'icon', ... }

            // Selection state
            selectedIcons: [],     // Selected desktop/window icons
        };
    }

    /**
     * Check if session exists
     */
    hasSession(sessionId) {
        return this.sessions.has(sessionId);
    }

    /**
     * Remove session
     */
    removeSession(sessionId) {
        const session = this.sessions.get(sessionId);
        if (session) {
            // Clean up app instances
            for (const [windowId, app] of session.apps) {
                if (app.onDestroy) {
                    try {
                        app.onDestroy();
                    } catch (err) {
                        console.error(`Error destroying app in window ${windowId}:`, err.message);
                    }
                }
            }
            session.apps.clear();
            this.sessions.delete(sessionId);
        }
    }

    /**
     * Get all session IDs
     */
    getSessionIds() {
        return Array.from(this.sessions.keys());
    }

    /**
     * Update last activity time
     */
    touch(sessionId) {
        const session = this.sessions.get(sessionId);
        if (session) {
            session.lastActivity = Date.now();
        }
    }

    // ============== Window Management ==============

    /**
     * Create a new window in session
     */
    createWindow(sessionId, options) {
        const session = this.getSession(sessionId);
        const windowId = options.id || `win_${session.nextWindowId++}`;

        const window = {
            id: windowId,
            title: options.title || 'Window',
            x: options.x || 10,
            y: options.y || 3,
            width: options.width || 40,
            height: options.height || 15,
            minWidth: options.minWidth || 10,
            minHeight: options.minHeight || 5,
            resizable: options.resizable !== false,
            closable: options.closable !== false,
            draggable: options.draggable !== false,
            appId: options.appId || null,
            // Custom properties from options
            ...options.custom
        };

        session.windows.push(window);
        session.activeWindow = windowId;

        return window;
    }

    /**
     * Get window by ID
     */
    getWindow(sessionId, windowId) {
        const session = this.sessions.get(sessionId);
        if (!session) return null;
        return session.windows.find(w => w.id === windowId);
    }

    /**
     * Remove window
     */
    removeWindow(sessionId, windowId) {
        const session = this.sessions.get(sessionId);
        if (!session) return;

        const idx = session.windows.findIndex(w => w.id === windowId);
        if (idx !== -1) {
            session.windows.splice(idx, 1);
        }

        // Clean up app instance
        if (session.apps.has(windowId)) {
            const app = session.apps.get(windowId);
            if (app.onDestroy) {
                try {
                    app.onDestroy();
                } catch (err) {
                    console.error(`Error destroying app:`, err.message);
                }
            }
            session.apps.delete(windowId);
        }

        // Update active window
        if (session.activeWindow === windowId) {
            const topWindow = session.windows[session.windows.length - 1];
            session.activeWindow = topWindow ? topWindow.id : null;
        }
    }

    /**
     * Bring window to front
     */
    bringToFront(sessionId, windowId) {
        const session = this.sessions.get(sessionId);
        if (!session) return;

        const idx = session.windows.findIndex(w => w.id === windowId);
        if (idx !== -1 && idx !== session.windows.length - 1) {
            const win = session.windows.splice(idx, 1)[0];
            session.windows.push(win);
        }

        session.activeWindow = windowId;
    }

    /**
     * Get topmost window at coordinates
     */
    getWindowAt(sessionId, x, y) {
        const session = this.sessions.get(sessionId);
        if (!session) return null;

        // Check windows in reverse order (top to bottom)
        for (let i = session.windows.length - 1; i >= 0; i--) {
            const win = session.windows[i];
            if (x >= win.x && x < win.x + win.width &&
                y >= win.y && y < win.y + win.height) {
                return win;
            }
        }

        return null;
    }

    /**
     * Get active window
     */
    getActiveWindow(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session || !session.activeWindow) return null;
        return session.windows.find(w => w.id === session.activeWindow);
    }

    // ============== App Management ==============

    /**
     * Register app instance for a window
     */
    registerApp(sessionId, windowId, appInstance) {
        const session = this.sessions.get(sessionId);
        if (session) {
            session.apps.set(windowId, appInstance);
        }
    }

    /**
     * Get app instance for a window
     */
    getApp(sessionId, windowId) {
        const session = this.sessions.get(sessionId);
        if (!session) return null;
        return session.apps.get(windowId);
    }

    /**
     * Get active app instance
     */
    getActiveApp(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session || !session.activeWindow) return null;
        return session.apps.get(session.activeWindow);
    }

    // ============== Clipboard ==============

    /**
     * Set clipboard content
     */
    setClipboard(sessionId, content) {
        const session = this.sessions.get(sessionId);
        if (session) {
            session.clipboard = content;
        }
    }

    /**
     * Get clipboard content
     */
    getClipboard(sessionId) {
        const session = this.sessions.get(sessionId);
        return session ? session.clipboard : '';
    }

    // ============== Stats ==============

    /**
     * Get session count
     */
    getSessionCount() {
        return this.sessions.size;
    }

    /**
     * Get session info for status display
     */
    getSessionInfo(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session) return null;

        return {
            id: sessionId,
            ip: session.ip,
            connectedAt: session.connectedAt,
            lastActivity: new Date(session.lastActivity).toISOString(),
            windowCount: session.windows.length,
            appCount: session.apps.size
        };
    }

    /**
     * Get all sessions info
     */
    getAllSessionsInfo() {
        const info = [];
        for (const sessionId of this.sessions.keys()) {
            info.push(this.getSessionInfo(sessionId));
        }
        return info;
    }
}

module.exports = SessionManager;
