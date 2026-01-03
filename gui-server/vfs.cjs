/**
 * Virtual Filesystem (VFS)
 * Provides sandboxed filesystem for the GUI, backed by real files
 */

const fs = require('fs');
const path = require('path');

class VirtualFilesystem {
    constructor(dataDir, appLoader) {
        this.dataDir = dataDir;
        this.appLoader = appLoader;

        // Directories
        this.vfsRoot = path.join(dataDir, 'vfs');
        this.metaDir = path.join(this.vfsRoot, '.meta');
        this.usersDir = path.join(this.vfsRoot, 'users');
        this.systemDir = path.join(this.vfsRoot, 'system');

        // Ensure directories exist
        this.ensureDir(this.vfsRoot);
        this.ensureDir(this.metaDir);
        this.ensureDir(this.usersDir);
        this.ensureDir(this.systemDir);
        this.ensureDir(path.join(this.systemDir, 'Applications'));

        // In-memory cache for virtual files (per-user)
        this.userCache = new Map();  // ip -> { files, lastSaved }
    }

    ensureDir(dir) {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }

    /**
     * Get the real path for a user's home directory
     */
    getUserHome(userId) {
        const safeId = userId.replace(/[^a-zA-Z0-9.-]/g, '_');
        const userDir = path.join(this.usersDir, safeId);
        this.ensureDir(userDir);
        return userDir;
    }

    /**
     * Resolve a virtual path to real path
     * Virtual paths start with / and map to real storage
     */
    resolvePath(userId, virtualPath) {
        // Normalize path
        virtualPath = virtualPath.replace(/\\/g, '/');
        if (!virtualPath.startsWith('/')) {
            virtualPath = '/' + virtualPath;
        }

        // Remove double slashes, resolve . and ..
        const parts = virtualPath.split('/').filter(p => p && p !== '.');
        const resolved = [];
        for (const part of parts) {
            if (part === '..') {
                resolved.pop();
            } else {
                resolved.push(part);
            }
        }

        const cleanPath = '/' + resolved.join('/');

        // Map virtual paths to real paths
        if (cleanPath === '/' || cleanPath === '/Macintosh HD') {
            // Root - return virtual root marker
            return { type: 'virtual', path: '/' };
        }

        if (cleanPath.startsWith('/System/Applications')) {
            // Applications folder - virtual, populated from app loader
            return { type: 'apps', path: cleanPath };
        }

        if (cleanPath.startsWith('/System')) {
            // Other system paths
            const realPath = path.join(this.systemDir, cleanPath.substring(7));
            return { type: 'real', path: realPath };
        }

        // User paths (Documents, Desktop, etc.)
        const userHome = this.getUserHome(userId);
        const realPath = path.join(userHome, cleanPath.substring(1));
        return { type: 'real', path: realPath };
    }

    /**
     * List contents of a directory
     */
    readDir(userId, virtualPath) {
        const resolved = this.resolvePath(userId, virtualPath);

        if (resolved.type === 'virtual' && resolved.path === '/') {
            // Root directory - show standard folders
            return [
                { name: 'System', type: 'folder' },
                { name: 'Applications', type: 'folder' },
                { name: 'Documents', type: 'folder' },
                { name: 'Desktop', type: 'folder' },
                { name: 'My Artwork', type: 'folder' }
            ];
        }

        if (resolved.type === 'apps') {
            // Applications folder - populated from app loader
            return this.appLoader.getAppsForFilesystem();
        }

        if (resolved.type === 'real') {
            // Real filesystem
            this.ensureDir(resolved.path);

            try {
                const entries = fs.readdirSync(resolved.path, { withFileTypes: true });
                return entries
                    .filter(e => !e.name.startsWith('.'))  // Hide dotfiles
                    .map(e => ({
                        name: e.name,
                        type: e.isDirectory() ? 'folder' : 'file'
                    }))
                    .sort((a, b) => {
                        // Folders first, then files
                        if (a.type !== b.type) {
                            return a.type === 'folder' ? -1 : 1;
                        }
                        return a.name.localeCompare(b.name);
                    });
            } catch (err) {
                console.error(`Error reading directory ${resolved.path}:`, err.message);
                return [];
            }
        }

        return [];
    }

    /**
     * Check if path exists
     */
    exists(userId, virtualPath) {
        const resolved = this.resolvePath(userId, virtualPath);

        if (resolved.type === 'virtual') {
            return true;
        }

        if (resolved.type === 'apps') {
            return true;
        }

        if (resolved.type === 'real') {
            return fs.existsSync(resolved.path);
        }

        return false;
    }

    /**
     * Check if path is a directory
     */
    isDirectory(userId, virtualPath) {
        const resolved = this.resolvePath(userId, virtualPath);

        if (resolved.type === 'virtual' || resolved.type === 'apps') {
            return true;
        }

        if (resolved.type === 'real') {
            try {
                return fs.statSync(resolved.path).isDirectory();
            } catch {
                return false;
            }
        }

        return false;
    }

    /**
     * Check if path is a file
     */
    isFile(userId, virtualPath) {
        const resolved = this.resolvePath(userId, virtualPath);

        if (resolved.type === 'virtual' || resolved.type === 'apps') {
            return false;
        }

        if (resolved.type === 'real') {
            try {
                return fs.statSync(resolved.path).isFile();
            } catch {
                return false;
            }
        }

        return false;
    }

    /**
     * Read file contents
     */
    readFile(userId, virtualPath) {
        const resolved = this.resolvePath(userId, virtualPath);

        if (resolved.type !== 'real') {
            throw new Error('Cannot read virtual path as file');
        }

        try {
            return fs.readFileSync(resolved.path, 'utf8');
        } catch (err) {
            throw new Error(`Cannot read file: ${err.message}`);
        }
    }

    /**
     * Write file contents
     */
    writeFile(userId, virtualPath, content) {
        const resolved = this.resolvePath(userId, virtualPath);

        if (resolved.type !== 'real') {
            throw new Error('Cannot write to virtual path');
        }

        // Ensure parent directory exists
        const parentDir = path.dirname(resolved.path);
        this.ensureDir(parentDir);

        try {
            fs.writeFileSync(resolved.path, content, 'utf8');
            return true;
        } catch (err) {
            throw new Error(`Cannot write file: ${err.message}`);
        }
    }

    /**
     * Create directory
     */
    mkdir(userId, virtualPath) {
        const resolved = this.resolvePath(userId, virtualPath);

        if (resolved.type !== 'real') {
            throw new Error('Cannot create directory in virtual path');
        }

        try {
            fs.mkdirSync(resolved.path, { recursive: true });
            return true;
        } catch (err) {
            throw new Error(`Cannot create directory: ${err.message}`);
        }
    }

    /**
     * Delete file or directory
     */
    delete(userId, virtualPath) {
        const resolved = this.resolvePath(userId, virtualPath);

        if (resolved.type !== 'real') {
            throw new Error('Cannot delete virtual path');
        }

        try {
            const stat = fs.statSync(resolved.path);
            if (stat.isDirectory()) {
                fs.rmSync(resolved.path, { recursive: true });
            } else {
                fs.unlinkSync(resolved.path);
            }
            return true;
        } catch (err) {
            throw new Error(`Cannot delete: ${err.message}`);
        }
    }

    /**
     * Rename/move file or directory
     */
    rename(userId, fromPath, toPath) {
        const resolvedFrom = this.resolvePath(userId, fromPath);
        const resolvedTo = this.resolvePath(userId, toPath);

        if (resolvedFrom.type !== 'real' || resolvedTo.type !== 'real') {
            throw new Error('Cannot rename virtual paths');
        }

        try {
            // Ensure destination parent exists
            const parentDir = path.dirname(resolvedTo.path);
            this.ensureDir(parentDir);

            fs.renameSync(resolvedFrom.path, resolvedTo.path);
            return true;
        } catch (err) {
            throw new Error(`Cannot rename: ${err.message}`);
        }
    }

    /**
     * Copy file or directory
     */
    copy(userId, fromPath, toPath) {
        const resolvedFrom = this.resolvePath(userId, fromPath);
        const resolvedTo = this.resolvePath(userId, toPath);

        if (resolvedFrom.type !== 'real' || resolvedTo.type !== 'real') {
            throw new Error('Cannot copy virtual paths');
        }

        try {
            // Ensure destination parent exists
            const parentDir = path.dirname(resolvedTo.path);
            this.ensureDir(parentDir);

            fs.cpSync(resolvedFrom.path, resolvedTo.path, { recursive: true });
            return true;
        } catch (err) {
            throw new Error(`Cannot copy: ${err.message}`);
        }
    }

    /**
     * Get file/directory stats
     */
    stat(userId, virtualPath) {
        const resolved = this.resolvePath(userId, virtualPath);

        if (resolved.type === 'virtual') {
            return {
                name: virtualPath.split('/').pop() || 'Macintosh HD',
                type: 'folder',
                size: 0,
                mtime: new Date()
            };
        }

        if (resolved.type === 'apps') {
            return {
                name: 'Applications',
                type: 'folder',
                size: 0,
                mtime: new Date()
            };
        }

        if (resolved.type === 'real') {
            try {
                const stat = fs.statSync(resolved.path);
                return {
                    name: path.basename(resolved.path),
                    type: stat.isDirectory() ? 'folder' : 'file',
                    size: stat.size,
                    mtime: stat.mtime
                };
            } catch (err) {
                return null;
            }
        }

        return null;
    }

    /**
     * Get real path for a virtual path (for advanced operations)
     */
    getRealPath(userId, virtualPath) {
        const resolved = this.resolvePath(userId, virtualPath);
        if (resolved.type === 'real') {
            return resolved.path;
        }
        return null;
    }
}

module.exports = VirtualFilesystem;
