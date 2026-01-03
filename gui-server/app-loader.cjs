/**
 * App Loader
 * Discovers and loads apps from the apps/ directory
 */

const fs = require('fs');
const path = require('path');

class AppLoader {
    constructor(appsDir) {
        this.appsDir = appsDir;
        this.apps = new Map();  // id -> { manifest, AppClass, iconPath }
    }

    /**
     * Scan apps directory and load all valid apps
     */
    discover() {
        console.log(`Scanning for apps in: ${this.appsDir}`);
        this.apps.clear();

        if (!fs.existsSync(this.appsDir)) {
            console.warn(`Apps directory does not exist: ${this.appsDir}`);
            return;
        }

        const entries = fs.readdirSync(this.appsDir, { withFileTypes: true });

        for (const entry of entries) {
            if (!entry.isDirectory()) continue;

            const appDir = path.join(this.appsDir, entry.name);
            const manifestPath = path.join(appDir, 'manifest.json');
            const appPath = path.join(appDir, 'app.cjs');

            // Check for required files
            if (!fs.existsSync(manifestPath)) {
                console.warn(`Skipping ${entry.name}: no manifest.json`);
                continue;
            }

            if (!fs.existsSync(appPath)) {
                console.warn(`Skipping ${entry.name}: no app.cjs`);
                continue;
            }

            try {
                // Load manifest
                const manifestData = fs.readFileSync(manifestPath, 'utf8');
                const manifest = JSON.parse(manifestData);

                // Validate required fields
                if (!manifest.id || !manifest.name) {
                    console.warn(`Skipping ${entry.name}: manifest missing id or name`);
                    continue;
                }

                // Load app class
                const AppClass = require(appPath);

                // Check for icon
                const iconPath = path.join(appDir, 'icon.txt');
                const hasIcon = fs.existsSync(iconPath);

                // Register app
                this.apps.set(manifest.id, {
                    manifest,
                    AppClass,
                    iconPath: hasIcon ? iconPath : null,
                    appDir
                });

                console.log(`Loaded app: ${manifest.name} (${manifest.id})`);

            } catch (err) {
                console.error(`Error loading app ${entry.name}:`, err.message);
            }
        }

        console.log(`Loaded ${this.apps.size} apps`);
    }

    /**
     * Get all loaded apps
     */
    getApps() {
        return this.apps;
    }

    /**
     * Get a specific app by ID
     */
    getApp(id) {
        return this.apps.get(id);
    }

    /**
     * Get app manifest by ID
     */
    getManifest(id) {
        const app = this.apps.get(id);
        return app ? app.manifest : null;
    }

    /**
     * Get list of app IDs
     */
    getAppIds() {
        return Array.from(this.apps.keys());
    }

    /**
     * Get apps as array for display in Applications folder
     */
    getAppsForFilesystem() {
        const apps = [];
        for (const [id, app] of this.apps) {
            apps.push({
                name: app.manifest.name,
                type: 'app',
                appId: id,
                icon: app.manifest.icon || { char: '?', fg: 0, bg: 7 }
            });
        }
        // Sort alphabetically
        apps.sort((a, b) => a.name.localeCompare(b.name));
        return apps;
    }

    /**
     * Load icon art from file
     */
    loadIcon(id) {
        const app = this.apps.get(id);
        if (!app || !app.iconPath) return null;

        try {
            return fs.readFileSync(app.iconPath, 'utf8');
        } catch (err) {
            return null;
        }
    }

    /**
     * Create an instance of an app
     */
    createInstance(id, context) {
        const app = this.apps.get(id);
        if (!app) {
            throw new Error(`Unknown app: ${id}`);
        }

        return new app.AppClass(context);
    }

    /**
     * Check if an app can open a file type
     */
    getAppForFileType(extension) {
        for (const [id, app] of this.apps) {
            const fileTypes = app.manifest.fileTypes || [];
            if (fileTypes.includes(extension)) {
                return id;
            }
        }
        return null;
    }

    /**
     * Reload a specific app (for development)
     */
    reloadApp(id) {
        const app = this.apps.get(id);
        if (!app) return false;

        const appPath = path.join(app.appDir, 'app.cjs');

        // Clear require cache
        delete require.cache[require.resolve(appPath)];

        try {
            const AppClass = require(appPath);
            app.AppClass = AppClass;
            console.log(`Reloaded app: ${id}`);
            return true;
        } catch (err) {
            console.error(`Error reloading app ${id}:`, err.message);
            return false;
        }
    }

    /**
     * Reload all apps
     */
    reloadAll() {
        // Clear all cached app modules
        for (const [id, app] of this.apps) {
            const appPath = path.join(app.appDir, 'app.cjs');
            delete require.cache[require.resolve(appPath)];
        }

        // Re-discover
        this.discover();
    }
}

module.exports = AppLoader;
