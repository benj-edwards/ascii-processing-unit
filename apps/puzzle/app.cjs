/**
 * Puzzle App
 * Classic 15-tile sliding puzzle game
 */

const BLACK = 0, WHITE = 7, GRAY = 8;

class PuzzleApp {
    constructor(context) {
        this.context = context;
        this.window = context.window;
        this.apu = context.apu;

        // Game state
        this.board = this.createShuffledPuzzle();
        this.moves = 0;
        this.solved = false;
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
        // Puzzle is fixed size
    }

    onClose() {
        return true;
    }

    onDestroy() {}

    onKeyPress(key, modifiers) {
        // Find empty space
        let emptyRow = -1, emptyCol = -1;
        for (let r = 0; r < 4; r++) {
            for (let c = 0; c < 4; c++) {
                if (this.board[r][c] === 0) {
                    emptyRow = r;
                    emptyCol = c;
                    break;
                }
            }
        }

        let moved = false;

        // Arrow keys move tiles into the empty space
        switch (key) {
            case 'ArrowUp':
                // Move tile from below into empty space
                if (emptyRow < 3) {
                    this.board[emptyRow][emptyCol] = this.board[emptyRow + 1][emptyCol];
                    this.board[emptyRow + 1][emptyCol] = 0;
                    moved = true;
                }
                break;
            case 'ArrowDown':
                // Move tile from above into empty space
                if (emptyRow > 0) {
                    this.board[emptyRow][emptyCol] = this.board[emptyRow - 1][emptyCol];
                    this.board[emptyRow - 1][emptyCol] = 0;
                    moved = true;
                }
                break;
            case 'ArrowLeft':
                // Move tile from right into empty space
                if (emptyCol < 3) {
                    this.board[emptyRow][emptyCol] = this.board[emptyRow][emptyCol + 1];
                    this.board[emptyRow][emptyCol + 1] = 0;
                    moved = true;
                }
                break;
            case 'ArrowRight':
                // Move tile from left into empty space
                if (emptyCol > 0) {
                    this.board[emptyRow][emptyCol] = this.board[emptyRow][emptyCol - 1];
                    this.board[emptyRow][emptyCol - 1] = 0;
                    moved = true;
                }
                break;
        }

        if (moved) {
            this.moves++;
            this.solved = this.isPuzzleSolved();
            this.draw();
            this.apu.send({ cmd: 'flush' });
        }
    }

    onMouseClick(x, y, button) {
        // Adjust for title bar (content starts at row 1)
        const adjustedY = y - 1;
        if (adjustedY < 0) return;

        // Determine which tile was clicked (4 chars wide, 3 chars tall per tile)
        const col = Math.floor(x / 4);
        const row = Math.floor(adjustedY / 3);

        if (col < 0 || col > 3 || row < 0 || row > 3) return;

        // Find empty space
        let emptyRow = -1, emptyCol = -1;
        for (let r = 0; r < 4; r++) {
            for (let c = 0; c < 4; c++) {
                if (this.board[r][c] === 0) {
                    emptyRow = r;
                    emptyCol = c;
                    break;
                }
            }
        }

        // Check if clicked tile is adjacent to empty space
        const isAdjacent = (
            (Math.abs(row - emptyRow) === 1 && col === emptyCol) ||
            (Math.abs(col - emptyCol) === 1 && row === emptyRow)
        );

        if (isAdjacent) {
            // Swap clicked tile with empty space
            this.board[emptyRow][emptyCol] = this.board[row][col];
            this.board[row][col] = 0;
            this.moves++;
            this.solved = this.isPuzzleSolved();

            this.draw();
            this.apu.send({ cmd: 'flush' });
        }
    }

    onMenuAction(action, data) {
        switch (action) {
            case 'newGame':
                this.newGame();
                break;
        }
    }

    newGame() {
        this.board = this.createShuffledPuzzle();
        this.moves = 0;
        this.solved = false;
        this.draw();
        this.apu.send({ cmd: 'flush' });
    }

    createShuffledPuzzle() {
        // Create solved board: 1-15, 0 (empty)
        const board = [
            [1, 2, 3, 4],
            [5, 6, 7, 8],
            [9, 10, 11, 12],
            [13, 14, 15, 0]
        ];

        // Shuffle by making random valid moves (ensures solvability)
        let emptyRow = 3, emptyCol = 3;
        for (let i = 0; i < 100; i++) {
            const moves = [];
            if (emptyRow > 0) moves.push([-1, 0]);
            if (emptyRow < 3) moves.push([1, 0]);
            if (emptyCol > 0) moves.push([0, -1]);
            if (emptyCol < 3) moves.push([0, 1]);

            const [dr, dc] = moves[Math.floor(Math.random() * moves.length)];
            const newRow = emptyRow + dr;
            const newCol = emptyCol + dc;

            board[emptyRow][emptyCol] = board[newRow][newCol];
            board[newRow][newCol] = 0;
            emptyRow = newRow;
            emptyCol = newCol;
        }

        return board;
    }

    isPuzzleSolved() {
        const expected = [
            [1, 2, 3, 4],
            [5, 6, 7, 8],
            [9, 10, 11, 12],
            [13, 14, 15, 0]
        ];
        for (let r = 0; r < 4; r++) {
            for (let c = 0; c < 4; c++) {
                if (this.board[r][c] !== expected[r][c]) return false;
            }
        }
        return true;
    }

    draw(isFocused = true) {
        const win = this.window;

        // Draw window chrome
        this.context.drawWindowChrome(win.id, win.x, win.y, win.width, win.height, 'Puzzle', {
            resizable: false,
            isFocused: isFocused
        });

        // Draw the 4x4 grid - each tile is 4 wide x 3 tall
        for (let row = 0; row < 4; row++) {
            for (let col = 0; col < 4; col++) {
                const val = this.board[row][col];
                const x = 1 + col * 4;
                const y = 1 + row * 3;  // +1 for title bar

                if (val === 0) {
                    // Empty space
                    this.apu.send({ cmd: 'print', window: win.id, x, y, text: '    ', fg: BLACK, bg: WHITE });
                    this.apu.send({ cmd: 'print', window: win.id, x, y: y + 1, text: '    ', fg: BLACK, bg: WHITE });
                    this.apu.send({ cmd: 'print', window: win.id, x, y: y + 2, text: '    ', fg: BLACK, bg: WHITE });
                } else {
                    // Tile with number
                    const numStr = val.toString().padStart(2);
                    this.apu.send({ cmd: 'print', window: win.id, x, y, text: '┌──┐', fg: BLACK, bg: WHITE });
                    this.apu.send({ cmd: 'print', window: win.id, x, y: y + 1, text: `│${numStr}│`, fg: BLACK, bg: WHITE });
                    this.apu.send({ cmd: 'print', window: win.id, x, y: y + 2, text: '└──┘', fg: BLACK, bg: WHITE });
                }
            }
        }

        // Moves counter
        const status = `Moves: ${this.moves}`;
        this.apu.send({ cmd: 'print', window: win.id, x: 1, y: 13, text: status.padEnd(16), fg: GRAY, bg: WHITE });

        // Check for win
        if (this.solved) {
            this.apu.send({ cmd: 'print', window: win.id, x: 5, y: 14, text: 'YOU WIN!', fg: BLACK, bg: WHITE });
        }

        this.apu.send({ cmd: 'bring_to_front', id: win.id });
    }
}

module.exports = PuzzleApp;
