/**
 * Calculator App
 * Simple desk calculator with basic operations
 */

const BLACK = 0, WHITE = 7;

class CalculatorApp {
    constructor(context) {
        this.context = context;
        this.window = context.window;
        this.apu = context.apu;

        // Calculator state
        this.display = '0';
        this.pending = null;
        this.operator = null;
        this.clear = true;
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
        // Calculator is fixed size
    }

    onClose() {
        return true;
    }

    onDestroy() {}

    onKeyPress(key, modifiers) {
        // Support keyboard input
        if (key >= '0' && key <= '9') {
            this.pressButton(key);
        } else if (key === '.') {
            this.pressButton('.');
        } else if (key === '+' || key === '-' || key === '*' || key === '/') {
            this.pressButton(key);
        } else if (key === '=' || key === 'Enter') {
            this.pressButton('=');
        } else if (key === 'c' || key === 'C' || key === 'Escape') {
            this.pressButton('C');
        }
    }

    onMouseClick(x, y, button) {
        // Button layout (x is 0-based inside content area):
        // Row 3: C(1)  ((4)  )(7)  /(10)
        // Row 4: 7(1)  8(4)  9(7)  *(10)
        // Row 5: 4(1)  5(4)  6(7)  -(10)
        // Row 6: 1(1)  2(4)  3(7)  +(10)
        // Row 7: 0(1)      .(7)  =(10)

        const buttons = {
            3: { 1: 'C', 4: '(', 7: ')', 10: '/' },
            4: { 1: '7', 4: '8', 7: '9', 10: '*' },
            5: { 1: '4', 4: '5', 7: '6', 10: '-' },
            6: { 1: '1', 4: '2', 7: '3', 10: '+' },
            7: { 1: '0', 7: '.', 10: '=' }
        };

        const row = buttons[y];
        if (!row) return;

        // Find which button was clicked
        let btn = null;
        for (const [col, b] of Object.entries(row)) {
            const c = parseInt(col);
            if (x >= c && x < c + 2) {
                btn = b;
                break;
            }
        }

        if (btn) {
            this.pressButton(btn);
        }
    }

    onMenuAction(action, data) {
        // No menus
    }

    pressButton(btn) {
        if (btn === 'C') {
            this.display = '0';
            this.pending = null;
            this.operator = null;
            this.clear = true;
        } else if (btn >= '0' && btn <= '9') {
            if (this.clear || this.display === '0') {
                this.display = btn;
                this.clear = false;
            } else {
                this.display += btn;
            }
        } else if (btn === '.') {
            if (!this.display.includes('.')) {
                this.display += '.';
                this.clear = false;
            }
        } else if (btn === '+' || btn === '-' || btn === '*' || btn === '/') {
            if (this.pending !== null && this.operator) {
                this.display = String(this.calculate(this.pending, parseFloat(this.display), this.operator));
            }
            this.pending = parseFloat(this.display);
            this.operator = btn;
            this.clear = true;
        } else if (btn === '=') {
            if (this.pending !== null && this.operator) {
                this.display = String(this.calculate(this.pending, parseFloat(this.display), this.operator));
                this.pending = null;
                this.operator = null;
                this.clear = true;
            }
        }

        this.draw();
        this.apu.send({ cmd: 'flush' });
    }

    calculate(a, b, op) {
        switch (op) {
            case '+': return a + b;
            case '-': return a - b;
            case '*': return a * b;
            case '/': return b !== 0 ? a / b : 'Error';
            default: return b;
        }
    }

    draw(isFocused = true) {
        const win = this.window;

        // Draw window chrome
        this.context.drawWindowChrome(win.id, win.x, win.y, win.width, win.height, 'Calculator', {
            resizable: false,
            isFocused: isFocused
        });

        // Display - right-aligned, max 9 chars
        const display = this.display.length > 9 ? this.display.slice(-9) : this.display;
        this.apu.send({
            cmd: 'print',
            window: win.id,
            x: 2, y: 1,
            text: '[' + display.padStart(9) + ']',
            fg: BLACK,
            bg: WHITE
        });

        // Buttons
        this.apu.send({ cmd: 'print', window: win.id, x: 2, y: 3, text: 'C  (  )  /', fg: BLACK, bg: WHITE });
        this.apu.send({ cmd: 'print', window: win.id, x: 2, y: 4, text: '7  8  9  *', fg: BLACK, bg: WHITE });
        this.apu.send({ cmd: 'print', window: win.id, x: 2, y: 5, text: '4  5  6  -', fg: BLACK, bg: WHITE });
        this.apu.send({ cmd: 'print', window: win.id, x: 2, y: 6, text: '1  2  3  +', fg: BLACK, bg: WHITE });
        this.apu.send({ cmd: 'print', window: win.id, x: 2, y: 7, text: '0     .  =', fg: BLACK, bg: WHITE });

        this.apu.send({ cmd: 'bring_to_front', id: win.id });
    }
}

module.exports = CalculatorApp;
