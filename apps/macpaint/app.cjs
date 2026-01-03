// MacPaint - ASCII Art Drawing Application
// A modular component for the Mac 1984 Finder demo

class MacPaint {
    constructor(sendCmd) {
        this.sendCmd = sendCmd;
        this.windows = new Map();  // Track MacPaint windows by session
    }

    // Open a new MacPaint window for a session
    open(sessionId, windowId, x = 5, y = 2) {
        const canvasWidth = 40;
        const canvasHeight = 16;

        // Create empty canvas
        const canvas = [];
        for (let row = 0; row < canvasHeight; row++) {
            canvas.push(new Array(canvasWidth).fill(' '));
        }

        const win = {
            id: windowId,
            title: 'MacPaint - Untitled',
            x: x,
            y: y,
            width: 52,   // 8 toolbar + 2 borders + 40 canvas + 2 canvas borders
            height: 20,
            isMacPaint: true,
            canvas: canvas,
            canvasWidth: canvasWidth,
            canvasHeight: canvasHeight,
            currentTool: 'pencil',
            currentChar: '█',
            charIndex: 0,
            tools: ['pencil', 'brush', 'eraser', 'line', 'rect', 'fill'],
            patterns: [
                '█', '▓', '▒', '░',      // Density patterns
                '●', '○', '◐', '◑',      // Circles
                '■', '□', '▪', '▫',      // Squares
                '▲', '▼', '◄', '►',      // Triangles
                '◆', '◇', '★', '☆',      // Diamonds/Stars
                '♦', '♠', '♣', '♥',      // Card suits
                '╳', '╱', '╲', '─',      // Lines
                '│', '┼', '╭', '╮',      // Box drawing
            ],
            // Line/rect tool state
            lineStart: null,
            drawing: false,
            // File state
            fileName: null,
            dirty: false
        };

        // Store window state
        if (!this.windows.has(sessionId)) {
            this.windows.set(sessionId, new Map());
        }
        this.windows.get(sessionId).set(windowId, win);

        return win;
    }

    // Get a MacPaint window
    getWindow(sessionId, windowId) {
        const sessionWindows = this.windows.get(sessionId);
        if (!sessionWindows) return null;
        return sessionWindows.get(windowId);
    }

    // Close a MacPaint window
    close(sessionId, windowId) {
        const sessionWindows = this.windows.get(sessionId);
        if (sessionWindows) {
            sessionWindows.delete(windowId);
        }
    }

    // Draw the MacPaint interface with Mac-style chrome and paperwhite style
    draw(sessionId, win, isFocused = true) {
        const WHITE = 7, BLACK = 0, GRAY = 8, BRIGHT_WHITE = 15;

        // Create window with no border - we draw custom Mac chrome
        this.sendCmd(sessionId, {
            cmd: 'create_window',
            id: win.id,
            x: win.x, y: win.y,
            width: win.width, height: win.height,
            border: 'none',
            closable: true,
            resizable: true,
            draggable: true,
            min_width: 25,
            min_height: 10
        });

        // Fill entire window with white background (paperwhite style)
        this.sendCmd(sessionId, {
            cmd: 'fill',
            window: win.id,
            x: 0, y: 0,
            width: win.width,
            height: win.height,
            char: ' ',
            fg: BLACK,
            bg: WHITE
        });

        // === TITLE BAR (row 0) - Mac style ===
        const titleText = win.title || 'MacPaint';
        if (isFocused) {
            // Focused: show lines with close box
            let titleBar = '═☐';
            for (let i = 2; i < win.width; i++) titleBar += '═';
            this.sendCmd(sessionId, { cmd: 'print', window: win.id, x: 0, y: 0, text: titleBar, fg: BLACK, bg: WHITE });
        } else {
            // Unfocused: solid white bar, no close box
            let titleBar = '';
            for (let i = 0; i < win.width; i++) titleBar += ' ';
            this.sendCmd(sessionId, { cmd: 'print', window: win.id, x: 0, y: 0, text: titleBar, fg: BLACK, bg: WHITE });
        }

        const paddedTitle = ' ' + titleText + ' ';
        const titleX = Math.floor((win.width - paddedTitle.length) / 2);
        this.sendCmd(sessionId, { cmd: 'print', window: win.id, x: titleX, y: 0, text: paddedTitle, fg: BLACK, bg: WHITE });

        // === SIDE BORDERS ===
        for (let by = 1; by < win.height - 1; by++) {
            this.sendCmd(sessionId, { cmd: 'set_cell', window: win.id, x: 0, y: by, char: '│', fg: BLACK, bg: WHITE });
            this.sendCmd(sessionId, { cmd: 'set_cell', window: win.id, x: win.width - 1, y: by, char: '│', fg: BLACK, bg: WHITE });
        }

        // === BOTTOM BORDER with resize handle ===
        this.sendCmd(sessionId, { cmd: 'set_cell', window: win.id, x: 0, y: win.height - 1, char: '└', fg: BLACK, bg: WHITE });
        for (let bx = 1; bx < win.width - 1; bx++) {
            this.sendCmd(sessionId, { cmd: 'set_cell', window: win.id, x: bx, y: win.height - 1, char: '─', fg: BLACK, bg: WHITE });
        }
        // Only show resize handle when focused
        const resizeChar = isFocused ? '■' : '┘';
        this.sendCmd(sessionId, { cmd: 'set_cell', window: win.id, x: win.width - 1, y: win.height - 1, char: resizeChar, fg: BLACK, bg: WHITE });

        // === TOOLBAR (left side, 8 chars wide, starting at row 1) ===
        this.drawToolbar(sessionId, win);

        // === SEPARATOR ===
        for (let row = 1; row < win.height - 1; row++) {
            this.sendCmd(sessionId, {
                cmd: 'print', window: win.id,
                x: 8, y: row,
                text: '│', fg: BLACK, bg: WHITE
            });
        }

        // === CANVAS ===
        this.drawCanvas(sessionId, win);

        this.sendCmd(sessionId, { cmd: 'bring_to_front', id: win.id });
    }

    drawToolbar(sessionId, win) {
        const WHITE = 7, BLACK = 0, GRAY = 8;

        // Tool icons
        const toolIcons = {
            'pencil': '✎',
            'brush':  '▓',
            'eraser': '○',
            'line':   '╱',
            'rect':   '□',
            'fill':   '▒'
        };

        // Draw tool buttons in 2 rows of 3 (y offset +1 for title bar)
        this.sendCmd(sessionId, { cmd: 'print', window: win.id, x: 1, y: 1, text: 'Tools:', fg: GRAY, bg: WHITE });

        for (let i = 0; i < win.tools.length; i++) {
            const tool = win.tools[i];
            const col = (i % 3) * 2 + 1;
            const row = Math.floor(i / 3) + 2;  // +2 for title bar + label
            const isSelected = (tool === win.currentTool);

            this.sendCmd(sessionId, {
                cmd: 'print', window: win.id,
                x: col, y: row,
                text: toolIcons[tool] || '?',
                fg: isSelected ? WHITE : BLACK,
                bg: isSelected ? BLACK : WHITE
            });
        }

        // Pattern/character selector
        this.sendCmd(sessionId, { cmd: 'print', window: win.id, x: 1, y: 5, text: 'Brush:', fg: GRAY, bg: WHITE });
        this.sendCmd(sessionId, {
            cmd: 'print', window: win.id,
            x: 1, y: 6,
            text: `< ${win.currentChar} >`,
            fg: BLACK, bg: WHITE
        });

        // Tool help
        this.sendCmd(sessionId, { cmd: 'print', window: win.id, x: 1, y: 8, text: '───────', fg: GRAY, bg: WHITE });

        const toolHelp = {
            'pencil': 'Click to',
            'brush':  '3x3 draw',
            'eraser': 'Erase',
            'line':   'Click 2',
            'rect':   'Click 2',
            'fill':   'Flood'
        };
        this.sendCmd(sessionId, { cmd: 'print', window: win.id, x: 1, y: 9, text: toolHelp[win.currentTool] || '', fg: GRAY, bg: WHITE });
    }

    drawCanvas(sessionId, win) {
        const WHITE = 7, BLACK = 0;
        const canvasX = 9;  // After toolbar and separator
        const canvasStartY = 1;  // After title bar

        // Top border (y offset +1 for title bar)
        this.sendCmd(sessionId, {
            cmd: 'print', window: win.id,
            x: canvasX, y: canvasStartY,
            text: '┌' + '─'.repeat(win.canvasWidth) + '┐',
            fg: BLACK, bg: WHITE
        });

        // Canvas rows - paperwhite style (black drawing on white background)
        for (let row = 0; row < win.canvasHeight; row++) {
            const rowContent = win.canvas[row].join('');
            this.sendCmd(sessionId, {
                cmd: 'print', window: win.id,
                x: canvasX, y: canvasStartY + row + 1,
                text: '│' + rowContent + '│',
                fg: BLACK, bg: WHITE
            });
        }

        // Bottom border
        this.sendCmd(sessionId, {
            cmd: 'print', window: win.id,
            x: canvasX, y: canvasStartY + win.canvasHeight + 1,
            text: '└' + '─'.repeat(win.canvasWidth) + '┘',
            fg: BLACK, bg: WHITE
        });
    }

    // Handle mouse click
    // localX and localY are window-relative (0,0 = top-left of window)
    handleClick(sessionId, win, localX, localY) {
        // Tool selection (x: 1-6, y: 2-3 for the two rows of tools)
        if (localX >= 1 && localX < 7 && localY >= 2 && localY <= 3) {
            const toolIndex = (localY - 2) * 3 + Math.floor((localX - 1) / 2);
            if (toolIndex >= 0 && toolIndex < win.tools.length) {
                win.currentTool = win.tools[toolIndex];
                win.lineStart = null;  // Reset line tool state
                return { action: 'redraw' };
            }
        }

        // Pattern selector arrows (y: 6, x: 1-2 for <, x: 4-5 for >)
        if (localY === 6) {
            if (localX >= 1 && localX <= 2) {
                // Previous pattern (< button)
                win.charIndex = (win.charIndex - 1 + win.patterns.length) % win.patterns.length;
                win.currentChar = win.patterns[win.charIndex];
                return { action: 'redraw' };
            } else if (localX >= 4 && localX <= 5) {
                // Next pattern (> button)
                win.charIndex = (win.charIndex + 1) % win.patterns.length;
                win.currentChar = win.patterns[win.charIndex];
                return { action: 'redraw' };
            }
        }

        // Canvas area (starts at x=10 for content, after border at x=9)
        // Canvas content starts at y=2 (after title bar y=0 and canvas border y=1)
        const canvasX = localX - 10;
        const canvasY = localY - 2;  // Canvas content starts at y=2

        if (canvasX >= 0 && canvasX < win.canvasWidth && canvasY >= 0 && canvasY < win.canvasHeight) {
            this.applyTool(win, canvasX, canvasY);
            return { action: 'redraw' };
        }

        return { action: 'none' };
    }

    // Handle mouse drag (for continuous drawing)
    handleDrag(sessionId, win, localX, localY) {
        const canvasX = localX - 10;
        const canvasY = localY - 2;  // Canvas content starts at y=2

        if (canvasX >= 0 && canvasX < win.canvasWidth && canvasY >= 0 && canvasY < win.canvasHeight) {
            // Only pencil, brush, and eraser work on drag
            if (['pencil', 'brush', 'eraser'].includes(win.currentTool)) {
                this.applyTool(win, canvasX, canvasY);
                return { action: 'redraw' };
            }
        }
        return { action: 'none' };
    }

    // Apply the current tool at a position
    applyTool(win, x, y) {
        win.dirty = true;  // Mark as modified
        switch (win.currentTool) {
            case 'pencil':
                this.drawPoint(win, x, y, win.currentChar);
                break;

            case 'brush':
                // 3x3 brush
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        this.drawPoint(win, x + dx, y + dy, win.currentChar);
                    }
                }
                break;

            case 'eraser':
                this.drawPoint(win, x, y, ' ');
                break;

            case 'line':
                if (!win.lineStart) {
                    // First click - set start point
                    win.lineStart = { x, y };
                    this.drawPoint(win, x, y, win.currentChar);
                } else {
                    // Second click - draw line
                    this.drawLine(win, win.lineStart.x, win.lineStart.y, x, y, win.currentChar);
                    win.lineStart = null;
                }
                break;

            case 'rect':
                if (!win.lineStart) {
                    // First click - set corner
                    win.lineStart = { x, y };
                    this.drawPoint(win, x, y, win.currentChar);
                } else {
                    // Second click - draw rectangle
                    this.drawRect(win, win.lineStart.x, win.lineStart.y, x, y, win.currentChar);
                    win.lineStart = null;
                }
                break;

            case 'fill':
                this.floodFill(win, x, y, win.currentChar);
                break;
        }
    }

    // Draw a single point
    drawPoint(win, x, y, char) {
        if (x >= 0 && x < win.canvasWidth && y >= 0 && y < win.canvasHeight) {
            win.canvas[y][x] = char;
        }
    }

    // Bresenham's line algorithm
    drawLine(win, x0, y0, x1, y1, char) {
        const dx = Math.abs(x1 - x0);
        const dy = Math.abs(y1 - y0);
        const sx = x0 < x1 ? 1 : -1;
        const sy = y0 < y1 ? 1 : -1;
        let err = dx - dy;

        while (true) {
            this.drawPoint(win, x0, y0, char);

            if (x0 === x1 && y0 === y1) break;

            const e2 = 2 * err;
            if (e2 > -dy) {
                err -= dy;
                x0 += sx;
            }
            if (e2 < dx) {
                err += dx;
                y0 += sy;
            }
        }
    }

    // Draw rectangle outline
    drawRect(win, x0, y0, x1, y1, char) {
        const minX = Math.min(x0, x1);
        const maxX = Math.max(x0, x1);
        const minY = Math.min(y0, y1);
        const maxY = Math.max(y0, y1);

        // Top and bottom edges
        for (let x = minX; x <= maxX; x++) {
            this.drawPoint(win, x, minY, char);
            this.drawPoint(win, x, maxY, char);
        }
        // Left and right edges
        for (let y = minY; y <= maxY; y++) {
            this.drawPoint(win, minX, y, char);
            this.drawPoint(win, maxX, y, char);
        }
    }

    // Flood fill
    floodFill(win, startX, startY, fillChar) {
        const targetChar = win.canvas[startY][startX];
        if (targetChar === fillChar) return;

        const stack = [[startX, startY]];
        const visited = new Set();
        let iterations = 0;
        const maxIterations = 2000;

        while (stack.length > 0 && iterations < maxIterations) {
            iterations++;
            const [x, y] = stack.pop();
            const key = `${x},${y}`;

            if (visited.has(key)) continue;
            if (x < 0 || x >= win.canvasWidth || y < 0 || y >= win.canvasHeight) continue;
            if (win.canvas[y][x] !== targetChar) continue;

            visited.add(key);
            win.canvas[y][x] = fillChar;

            stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
        }
    }

    // Resize the canvas dynamically when window is resized
    resize(win, newWidth, newHeight) {
        // Calculate new canvas dimensions
        // Window layout: border(1) + toolbar(8) + separator(1) + canvas border(1) + canvas + canvas border(1) + border(1)
        // So canvas width = newWidth - 13
        // Canvas height = newHeight - 4 (top/bottom borders + canvas borders)
        const newCanvasWidth = Math.max(5, newWidth - 13);
        const newCanvasHeight = Math.max(3, newHeight - 4);

        // Create new canvas, preserving existing content
        const newCanvas = [];
        for (let y = 0; y < newCanvasHeight; y++) {
            const row = [];
            for (let x = 0; x < newCanvasWidth; x++) {
                // Copy from old canvas if within bounds
                if (y < win.canvasHeight && x < win.canvasWidth) {
                    row.push(win.canvas[y][x]);
                } else {
                    row.push(' ');
                }
            }
            newCanvas.push(row);
        }

        // Update window state
        win.canvas = newCanvas;
        win.canvasWidth = newCanvasWidth;
        win.canvasHeight = newCanvasHeight;
        win.width = newWidth;
        win.height = newHeight;
    }

    // Clear the canvas
    clearCanvas(win) {
        for (let y = 0; y < win.canvasHeight; y++) {
            for (let x = 0; x < win.canvasWidth; x++) {
                win.canvas[y][x] = ' ';
            }
        }
        win.dirty = true;
    }

    // Flip canvas horizontally (mirror left-right)
    flipHorizontal(win) {
        for (let y = 0; y < win.canvasHeight; y++) {
            win.canvas[y].reverse();
        }
        win.dirty = true;
    }

    // Flip canvas vertically (mirror top-bottom)
    flipVertical(win) {
        win.canvas.reverse();
        win.dirty = true;
    }

    // Export canvas as string array
    exportCanvas(win) {
        return win.canvas.map(row => row.join(''));
    }

    // Import canvas from string array
    importCanvas(win, lines) {
        for (let y = 0; y < Math.min(lines.length, win.canvasHeight); y++) {
            const line = lines[y] || '';
            for (let x = 0; x < win.canvasWidth; x++) {
                win.canvas[y][x] = line[x] || ' ';
            }
        }
    }
}

module.exports = MacPaint;
