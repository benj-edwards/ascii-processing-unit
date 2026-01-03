/**
 * MacWrite App
 * Text editor for creating and editing documents
 */

const BLACK = 0, WHITE = 7, GRAY = 8;

class MacWriteApp {
    constructor(context) {
        this.context = context;
        this.window = context.window;
        this.apu = context.apu;
        this.fs = context.fs;
        this.session = context.session;

        // Editor state
        this.fileName = 'Untitled.txt';
        this.filePath = null;
        this.content = [''];  // Array of lines
        this.cursorX = 0;
        this.cursorY = 0;
        this.scrollY = 0;
        this.dirty = false;

        // Selection
        this.selectionStart = null;
        this.selectionEnd = null;
        this.isSelecting = false;
    }

    onInit() {
        this.draw();
    }

    onFocus() {
        this.draw(true);
    }

    onBlur() {
        this.draw(false);
    }

    onResize(width, height) {
        this.window.width = width;
        this.window.height = height;
        this.draw();
    }

    onClose() {
        if (this.dirty) {
            // TODO: Show save dialog
            // For now, allow close
        }
        return true;
    }

    onDestroy() {}

    onKeyPress(key, modifiers) {
        const contentHeight = this.window.height - 4;

        // Clear selection on navigation
        const clearSelection = () => {
            this.selectionStart = null;
            this.selectionEnd = null;
        };

        // Handle control keys
        if (modifiers.ctrl) {
            switch (key.toLowerCase()) {
                case 's':
                    this.save();
                    return;
                case 'c':
                    this.copy();
                    return;
                case 'x':
                    this.cut();
                    return;
                case 'v':
                    this.paste();
                    return;
                case 'a':
                    this.selectAll();
                    return;
            }
        }

        // Handle special keys
        switch (key) {
            case 'ArrowUp':
                if (this.cursorY > 0) {
                    this.cursorY--;
                    this.cursorX = Math.min(this.cursorX, this.content[this.cursorY].length);
                    clearSelection();
                }
                break;

            case 'ArrowDown':
                if (this.cursorY < this.content.length - 1) {
                    this.cursorY++;
                    this.cursorX = Math.min(this.cursorX, this.content[this.cursorY].length);
                    clearSelection();
                }
                break;

            case 'ArrowLeft':
                if (this.cursorX > 0) {
                    this.cursorX--;
                } else if (this.cursorY > 0) {
                    this.cursorY--;
                    this.cursorX = this.content[this.cursorY].length;
                }
                clearSelection();
                break;

            case 'ArrowRight':
                if (this.cursorX < this.content[this.cursorY].length) {
                    this.cursorX++;
                } else if (this.cursorY < this.content.length - 1) {
                    this.cursorY++;
                    this.cursorX = 0;
                }
                clearSelection();
                break;

            case 'Home':
                this.cursorX = 0;
                clearSelection();
                break;

            case 'End':
                this.cursorX = this.content[this.cursorY].length;
                clearSelection();
                break;

            case 'PageUp':
                this.cursorY = Math.max(0, this.cursorY - contentHeight);
                this.cursorX = Math.min(this.cursorX, this.content[this.cursorY].length);
                clearSelection();
                break;

            case 'PageDown':
                this.cursorY = Math.min(this.content.length - 1, this.cursorY + contentHeight);
                this.cursorX = Math.min(this.cursorX, this.content[this.cursorY].length);
                clearSelection();
                break;

            case 'Enter':
                this.deleteSelection();
                const lineAfter = this.content[this.cursorY].substring(this.cursorX);
                this.content[this.cursorY] = this.content[this.cursorY].substring(0, this.cursorX);
                this.content.splice(this.cursorY + 1, 0, lineAfter);
                this.cursorY++;
                this.cursorX = 0;
                this.dirty = true;
                break;

            case 'Backspace':
                if (this.hasSelection()) {
                    this.deleteSelection();
                } else if (this.cursorX > 0) {
                    this.content[this.cursorY] =
                        this.content[this.cursorY].substring(0, this.cursorX - 1) +
                        this.content[this.cursorY].substring(this.cursorX);
                    this.cursorX--;
                    this.dirty = true;
                } else if (this.cursorY > 0) {
                    const prevLine = this.content[this.cursorY - 1];
                    this.cursorX = prevLine.length;
                    this.content[this.cursorY - 1] = prevLine + this.content[this.cursorY];
                    this.content.splice(this.cursorY, 1);
                    this.cursorY--;
                    this.dirty = true;
                }
                break;

            case 'Delete':
                if (this.hasSelection()) {
                    this.deleteSelection();
                } else if (this.cursorX < this.content[this.cursorY].length) {
                    this.content[this.cursorY] =
                        this.content[this.cursorY].substring(0, this.cursorX) +
                        this.content[this.cursorY].substring(this.cursorX + 1);
                    this.dirty = true;
                } else if (this.cursorY < this.content.length - 1) {
                    this.content[this.cursorY] += this.content[this.cursorY + 1];
                    this.content.splice(this.cursorY + 1, 1);
                    this.dirty = true;
                }
                break;

            default:
                // Printable character
                if (key.length === 1 && key.charCodeAt(0) >= 32) {
                    this.deleteSelection();
                    this.content[this.cursorY] =
                        this.content[this.cursorY].substring(0, this.cursorX) +
                        key +
                        this.content[this.cursorY].substring(this.cursorX);
                    this.cursorX++;
                    this.dirty = true;
                }
        }

        this.draw();
        this.apu.send({ cmd: 'flush' });
    }

    onMouseClick(x, y, button, event) {
        const contentWidth = this.window.width - 4;
        const contentHeight = this.window.height - 4;

        // Clamp to content area
        x = Math.max(0, Math.min(contentWidth - 1, x));
        y = Math.max(0, Math.min(contentHeight - 1, y));

        const wrappedLines = this.buildWrappedContent(contentWidth);
        const displayLineIdx = y + this.scrollY;

        if (displayLineIdx < wrappedLines.length) {
            const wl = wrappedLines[displayLineIdx];
            const newCursorY = wl.lineIdx;
            const newCursorX = Math.min(wl.startCol + x, this.content[wl.lineIdx].length);

            if (event === 'press') {
                this.cursorY = newCursorY;
                this.cursorX = newCursorX;
                this.selectionStart = { line: newCursorY, col: newCursorX };
                this.selectionEnd = null;
                this.isSelecting = true;
            } else if (event === 'drag' && this.isSelecting) {
                this.cursorY = newCursorY;
                this.cursorX = newCursorX;
                this.selectionEnd = { line: newCursorY, col: newCursorX };
            } else if (event === 'release') {
                this.isSelecting = false;
                if (this.selectionEnd &&
                    this.selectionStart.line === this.selectionEnd.line &&
                    this.selectionStart.col === this.selectionEnd.col) {
                    this.selectionStart = null;
                    this.selectionEnd = null;
                }
            }
        }

        this.draw();
        this.apu.send({ cmd: 'flush' });
    }

    onMenuAction(action, data) {
        switch (action) {
            case 'new':
                this.newDocument();
                break;
            case 'open':
                // TODO: Show file picker
                break;
            case 'save':
                this.save();
                break;
            case 'saveAs':
                // TODO: Show save dialog
                break;
            case 'cut':
                this.cut();
                break;
            case 'copy':
                this.copy();
                break;
            case 'paste':
                this.paste();
                break;
            case 'selectAll':
                this.selectAll();
                break;
            case 'close':
                this.window.close();
                break;
        }
    }

    onOpenFile(path, content) {
        this.filePath = path;
        this.fileName = path.split('/').pop();
        this.content = content.split('\n');
        if (this.content.length === 0) this.content = [''];
        this.cursorX = 0;
        this.cursorY = 0;
        this.scrollY = 0;
        this.dirty = false;
        this.window.setTitle(this.fileName);
        this.draw();
    }

    // Editor operations
    newDocument() {
        this.fileName = 'Untitled.txt';
        this.filePath = null;
        this.content = [''];
        this.cursorX = 0;
        this.cursorY = 0;
        this.scrollY = 0;
        this.dirty = false;
        this.selectionStart = null;
        this.selectionEnd = null;
        this.window.setTitle(this.fileName);
        this.draw();
    }

    save() {
        if (this.filePath) {
            this.fs.writeFile(this.filePath, this.content.join('\n'));
            this.dirty = false;
            this.draw();
        } else {
            // TODO: Show save dialog
        }
    }

    hasSelection() {
        return this.selectionStart !== null && this.selectionEnd !== null;
    }

    getSelectedText() {
        if (!this.hasSelection()) return '';

        let start = this.selectionStart;
        let end = this.selectionEnd;
        if (start.line > end.line || (start.line === end.line && start.col > end.col)) {
            [start, end] = [end, start];
        }

        if (start.line === end.line) {
            return this.content[start.line].substring(start.col, end.col);
        }

        let text = this.content[start.line].substring(start.col) + '\n';
        for (let i = start.line + 1; i < end.line; i++) {
            text += this.content[i] + '\n';
        }
        text += this.content[end.line].substring(0, end.col);
        return text;
    }

    deleteSelection() {
        if (!this.hasSelection()) return;

        let start = this.selectionStart;
        let end = this.selectionEnd;
        if (start.line > end.line || (start.line === end.line && start.col > end.col)) {
            [start, end] = [end, start];
        }

        if (start.line === end.line) {
            this.content[start.line] =
                this.content[start.line].substring(0, start.col) +
                this.content[start.line].substring(end.col);
        } else {
            const before = this.content[start.line].substring(0, start.col);
            const after = this.content[end.line].substring(end.col);
            this.content.splice(start.line, end.line - start.line + 1, before + after);
        }

        this.cursorY = start.line;
        this.cursorX = start.col;
        this.selectionStart = null;
        this.selectionEnd = null;
        this.dirty = true;
    }

    copy() {
        const text = this.getSelectedText();
        if (text) {
            this.session.clipboard = text;
        }
    }

    cut() {
        this.copy();
        this.deleteSelection();
        this.draw();
        this.apu.send({ cmd: 'flush' });
    }

    paste() {
        const text = this.session.clipboard;
        if (!text) return;

        this.deleteSelection();
        const lines = text.split('\n');

        if (lines.length === 1) {
            this.content[this.cursorY] =
                this.content[this.cursorY].substring(0, this.cursorX) +
                lines[0] +
                this.content[this.cursorY].substring(this.cursorX);
            this.cursorX += lines[0].length;
        } else {
            const after = this.content[this.cursorY].substring(this.cursorX);
            this.content[this.cursorY] = this.content[this.cursorY].substring(0, this.cursorX) + lines[0];
            for (let i = 1; i < lines.length - 1; i++) {
                this.content.splice(this.cursorY + i, 0, lines[i]);
            }
            this.content.splice(this.cursorY + lines.length - 1, 0, lines[lines.length - 1] + after);
            this.cursorY += lines.length - 1;
            this.cursorX = lines[lines.length - 1].length;
        }

        this.dirty = true;
        this.draw();
        this.apu.send({ cmd: 'flush' });
    }

    selectAll() {
        this.selectionStart = { line: 0, col: 0 };
        const lastLine = this.content.length - 1;
        this.selectionEnd = { line: lastLine, col: this.content[lastLine].length };
        this.cursorY = lastLine;
        this.cursorX = this.content[lastLine].length;
        this.draw();
        this.apu.send({ cmd: 'flush' });
    }

    buildWrappedContent(contentWidth) {
        const lines = [];
        for (let i = 0; i < this.content.length; i++) {
            const line = this.content[i];
            if (line.length === 0) {
                lines.push({ lineIdx: i, startCol: 0, text: '' });
            } else {
                for (let j = 0; j < line.length; j += contentWidth) {
                    lines.push({
                        lineIdx: i,
                        startCol: j,
                        text: line.substring(j, j + contentWidth)
                    });
                }
            }
        }
        return lines;
    }

    isInSelection(line, col) {
        if (!this.selectionStart || !this.selectionEnd) return false;

        let start = this.selectionStart;
        let end = this.selectionEnd;
        if (start.line > end.line || (start.line === end.line && start.col > end.col)) {
            [start, end] = [end, start];
        }

        if (line < start.line || line > end.line) return false;
        if (line === start.line && col < start.col) return false;
        if (line === end.line && col >= end.col) return false;
        return true;
    }

    draw(isFocused = true) {
        const win = this.window;
        const title = this.dirty ? `${this.fileName} *` : this.fileName;

        this.context.drawWindowChrome(win.id, win.x, win.y, win.width, win.height, title, {
            resizable: true,
            isFocused: isFocused
        });

        const contentStartY = 1;
        const contentHeight = win.height - 4;
        const contentWidth = win.width - 4;

        const wrappedLines = this.buildWrappedContent(contentWidth);

        // Find cursor display position
        let cursorDisplayLine = 0;
        let cursorDisplayCol = this.cursorX;

        for (let i = 0; i < wrappedLines.length; i++) {
            const wl = wrappedLines[i];
            if (wl.lineIdx === this.cursorY && this.cursorX <= wl.startCol + wl.text.length) {
                cursorDisplayLine = i;
                cursorDisplayCol = this.cursorX - wl.startCol;
                break;
            }
        }

        // Adjust scroll
        if (cursorDisplayLine < this.scrollY) this.scrollY = cursorDisplayLine;
        if (cursorDisplayLine >= this.scrollY + contentHeight) {
            this.scrollY = cursorDisplayLine - contentHeight + 1;
        }

        // Draw content
        for (let i = 0; i < contentHeight; i++) {
            const displayIdx = i + this.scrollY;
            const wl = wrappedLines[displayIdx];
            const line = wl ? wl.text : '';
            const displayLine = line.padEnd(contentWidth, ' ');
            const lineIdx = wl ? wl.lineIdx : -1;
            const startCol = wl ? wl.startCol : 0;
            const hasCursor = displayIdx === cursorDisplayLine;

            for (let c = 0; c < displayLine.length; c++) {
                const char = displayLine[c];
                const contentCol = startCol + c;
                const isCursor = hasCursor && c === cursorDisplayCol;
                const isSelected = lineIdx >= 0 && this.isInSelection(lineIdx, contentCol);

                let fg = BLACK, bg = WHITE;
                if (isCursor) {
                    fg = WHITE; bg = BLACK;
                } else if (isSelected) {
                    fg = WHITE; bg = GRAY;
                }

                this.apu.send({
                    cmd: 'set_cell',
                    window: win.id,
                    x: 2 + c, y: contentStartY + i,
                    char: char, fg: fg, bg: bg
                });
            }
        }

        // Status bar
        const statusY = win.height - 3;
        for (let x = 1; x < win.width - 1; x++) {
            this.apu.send({ cmd: 'set_cell', window: win.id, x: x, y: statusY, char: '─', fg: BLACK, bg: WHITE });
        }
        const status = `Ln ${this.cursorY + 1}, Col ${this.cursorX + 1}`;
        this.apu.send({
            cmd: 'print', window: win.id,
            x: 2, y: statusY + 1,
            text: status.padEnd(contentWidth, ' '),
            fg: GRAY, bg: WHITE
        });

        this.apu.send({ cmd: 'bring_to_front', id: win.id });
    }
}

module.exports = MacWriteApp;
