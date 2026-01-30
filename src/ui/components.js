/**
 * @fileoverview Beautiful console UI utilities with colors, spinners, tables, and prompts
 */

import { createRequire } from 'module';

// For terminal width detection
const getTerminalWidth = () => process.stdout.columns || 80;

/**
 * ANSI escape codes for styling
 */
export const Style = {
  // Reset
  reset: '\x1b[0m',
  
  // Text styles
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  underline: '\x1b[4m',
  blink: '\x1b[5m',
  inverse: '\x1b[7m',
  hidden: '\x1b[8m',
  strikethrough: '\x1b[9m',
  
  // Foreground colors
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
  grey: '\x1b[90m',
  
  // Bright foreground
  brightRed: '\x1b[91m',
  brightGreen: '\x1b[92m',
  brightYellow: '\x1b[93m',
  brightBlue: '\x1b[94m',
  brightMagenta: '\x1b[95m',
  brightCyan: '\x1b[96m',
  brightWhite: '\x1b[97m',
  
  // Background colors
  bgBlack: '\x1b[40m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m',
  bgCyan: '\x1b[46m',
  bgWhite: '\x1b[47m',
  
  // Bright backgrounds
  bgBrightRed: '\x1b[101m',
  bgBrightGreen: '\x1b[102m',
  bgBrightYellow: '\x1b[103m',
  bgBrightBlue: '\x1b[104m',
};

/**
 * Cursor control
 */
export const Cursor = {
  hide: () => process.stdout.write('\x1b[?25l'),
  show: () => process.stdout.write('\x1b[?25h'),
  up: (n = 1) => process.stdout.write(`\x1b[${n}A`),
  down: (n = 1) => process.stdout.write(`\x1b[${n}B`),
  forward: (n = 1) => process.stdout.write(`\x1b[${n}C`),
  back: (n = 1) => process.stdout.write(`\x1b[${n}D`),
  toColumn: (n) => process.stdout.write(`\x1b[${n}G`),
  clearLine: () => process.stdout.write('\x1b[2K'),
  clearDown: () => process.stdout.write('\x1b[J'),
  saveCursor: () => process.stdout.write('\x1b[s'),
  restoreCursor: () => process.stdout.write('\x1b[u'),
};

/**
 * Color utility functions
 */
export const Color = {
  /**
   * Apply style to text
   */
  apply(text, ...styles) {
    const styleStr = styles.map(s => Style[s] || s).join('');
    return `${styleStr}${text}${Style.reset}`;
  },
  
  // Convenience methods
  red: (text) => Color.apply(text, 'red'),
  green: (text) => Color.apply(text, 'green'),
  yellow: (text) => Color.apply(text, 'yellow'),
  blue: (text) => Color.apply(text, 'blue'),
  magenta: (text) => Color.apply(text, 'magenta'),
  cyan: (text) => Color.apply(text, 'cyan'),
  white: (text) => Color.apply(text, 'white'),
  gray: (text) => Color.apply(text, 'gray'),
  dim: (text) => Color.apply(text, 'dim'),
  bold: (text) => Color.apply(text, 'bold'),
  
  // Combined styles
  success: (text) => Color.apply(text, 'green', 'bold'),
  error: (text) => Color.apply(text, 'red', 'bold'),
  warning: (text) => Color.apply(text, 'yellow'),
  info: (text) => Color.apply(text, 'cyan'),
  highlight: (text) => Color.apply(text, 'bgBlue', 'white', 'bold'),
  
  /**
   * Strip ANSI codes from text
   */
  strip(text) {
    return text.replace(/\x1b\[[0-9;]*m/g, '');
  },
  
  /**
   * Get visible length (without ANSI codes)
   */
  visibleLength(text) {
    return Color.strip(text).length;
  },
};

/**
 * Box drawing characters
 */
const Box = {
  single: {
    topLeft: '┌',
    topRight: '┐',
    bottomLeft: '└',
    bottomRight: '┘',
    horizontal: '─',
    vertical: '│',
    teeLeft: '├',
    teeRight: '┤',
    teeTop: '┬',
    teeBottom: '┴',
    cross: '┼',
  },
  double: {
    topLeft: '╔',
    topRight: '╗',
    bottomLeft: '╚',
    bottomRight: '╝',
    horizontal: '═',
    vertical: '║',
    teeLeft: '╠',
    teeRight: '╣',
    teeTop: '╦',
    teeBottom: '╩',
    cross: '╬',
  },
  rounded: {
    topLeft: '╭',
    topRight: '╮',
    bottomLeft: '╰',
    bottomRight: '╯',
    horizontal: '─',
    vertical: '│',
    teeLeft: '├',
    teeRight: '┤',
    teeTop: '┬',
    teeBottom: '┴',
    cross: '┼',
  },
};

/**
 * UI Components
 */
export const UI = {
  /**
   * Create a horizontal line
   */
  line(char = '─', length = null, color = 'dim') {
    const len = length || getTerminalWidth();
    return Color.apply(char.repeat(len), color);
  },
  
  /**
   * Create a boxed message
   */
  box(text, options = {}) {
    const {
      padding = 1,
      borderStyle = 'rounded',
      borderColor = 'cyan',
      titleColor = 'white',
      title = null,
      width = null,
    } = options;
    
    const chars = Box[borderStyle] || Box.single;
    const lines = text.split('\n');
    const maxLineLength = Math.max(...lines.map(l => Color.visibleLength(l)));
    const boxWidth = width || Math.min(maxLineLength + padding * 2 + 2, getTerminalWidth());
    const innerWidth = boxWidth - 2;
    
    const output = [];
    
    // Top border with optional title
    let topBorder = chars.horizontal.repeat(innerWidth);
    if (title) {
      const titleText = ` ${title} `;
      const titleStart = Math.floor((innerWidth - titleText.length) / 2);
      topBorder = chars.horizontal.repeat(titleStart) + 
                  Color.apply(titleText, titleColor, 'bold') + 
                  chars.horizontal.repeat(innerWidth - titleStart - titleText.length);
    }
    output.push(Color.apply(chars.topLeft, borderColor) + Color.apply(topBorder, borderColor) + Color.apply(chars.topRight, borderColor));
    
    // Padding top
    for (let i = 0; i < padding; i++) {
      output.push(Color.apply(chars.vertical, borderColor) + ' '.repeat(innerWidth) + Color.apply(chars.vertical, borderColor));
    }
    
    // Content lines
    for (const line of lines) {
      const visLen = Color.visibleLength(line);
      const padLeft = ' '.repeat(padding);
      const padRight = ' '.repeat(Math.max(0, innerWidth - visLen - padding));
      output.push(Color.apply(chars.vertical, borderColor) + padLeft + line + padRight + Color.apply(chars.vertical, borderColor));
    }
    
    // Padding bottom
    for (let i = 0; i < padding; i++) {
      output.push(Color.apply(chars.vertical, borderColor) + ' '.repeat(innerWidth) + Color.apply(chars.vertical, borderColor));
    }
    
    // Bottom border
    output.push(Color.apply(chars.bottomLeft + chars.horizontal.repeat(innerWidth) + chars.bottomRight, borderColor));
    
    return output.join('\n');
  },
  
  /**
   * Create a simple table
   */
  table(data, options = {}) {
    const {
      headers = null,
      borderColor = 'dim',
      headerColor = 'cyan',
      cellPadding = 1,
    } = options;
    
    if (!data || data.length === 0) return '';
    
    // Determine columns
    const sampleRow = headers || (Array.isArray(data[0]) ? data[0] : Object.keys(data[0]));
    const columns = sampleRow.length || Object.keys(sampleRow).length;
    
    // Convert objects to arrays if needed
    const rows = data.map(row => {
      if (Array.isArray(row)) return row.map(String);
      return Object.values(row).map(String);
    });
    
    // Calculate column widths
    const colWidths = [];
    for (let i = 0; i < columns; i++) {
      const headerWidth = headers ? Color.visibleLength(String(headers[i])) : 0;
      const maxDataWidth = Math.max(...rows.map(row => Color.visibleLength(row[i] || '')));
      colWidths[i] = Math.max(headerWidth, maxDataWidth) + cellPadding * 2;
    }
    
    const chars = Box.single;
    const output = [];
    
    // Helper to create a row
    const makeRow = (cells, isHeader = false) => {
      const cellStrs = cells.map((cell, i) => {
        const padded = String(cell || '').padEnd(colWidths[i] - cellPadding);
        return ' '.repeat(cellPadding) + (isHeader ? Color.apply(padded, headerColor, 'bold') : padded);
      });
      return Color.apply(chars.vertical, borderColor) + 
             cellStrs.join(Color.apply(chars.vertical, borderColor)) + 
             Color.apply(chars.vertical, borderColor);
    };
    
    // Helper to create separator
    const makeSeparator = (left, mid, right) => {
      const segments = colWidths.map(w => chars.horizontal.repeat(w));
      return Color.apply(left + segments.join(mid) + right, borderColor);
    };
    
    // Build table
    output.push(makeSeparator(chars.topLeft, chars.teeTop, chars.topRight));
    
    if (headers) {
      output.push(makeRow(headers, true));
      output.push(makeSeparator(chars.teeLeft, chars.cross, chars.teeRight));
    }
    
    for (const row of rows) {
      output.push(makeRow(row));
    }
    
    output.push(makeSeparator(chars.bottomLeft, chars.teeBottom, chars.bottomRight));
    
    return output.join('\n');
  },
  
  /**
   * Create a key-value display
   */
  keyValue(data, options = {}) {
    const {
      keyColor = 'cyan',
      valueColor = 'white',
      separator = ':',
      indent = 2,
    } = options;
    
    const entries = Array.isArray(data) ? data : Object.entries(data);
    const maxKeyLen = Math.max(...entries.map(([k]) => k.length));
    
    return entries.map(([key, value]) => {
      const paddedKey = key.padEnd(maxKeyLen);
      return ' '.repeat(indent) + 
             Color.apply(paddedKey, keyColor) + 
             Color.dim(` ${separator} `) + 
             Color.apply(String(value), valueColor);
    }).join('\n');
  },
  
  /**
   * Create a list
   */
  list(items, options = {}) {
    const {
      bullet = '●',
      bulletColor = 'cyan',
      indent = 2,
      numbered = false,
    } = options;
    
    return items.map((item, i) => {
      const marker = numbered ? `${i + 1}.` : bullet;
      return ' '.repeat(indent) + Color.apply(marker, bulletColor) + ' ' + item;
    }).join('\n');
  },
  
  /**
   * Print banner/header
   */
  banner(text, options = {}) {
    const {
      style = 'rounded',
      color = 'cyan',
      width = null,
    } = options;
    
    return UI.box(text, {
      borderStyle: style,
      borderColor: color,
      padding: 1,
      width,
    });
  },
  
  /**
   * Create ASCII art title
   */
  title(text) {
    // Simple block-style title
    const chars = text.toUpperCase().split('');
    return Color.apply(Color.bold(text), 'cyan');
  },
  
  /**
   * Clear the terminal
   */
  clear() {
    process.stdout.write('\x1b[2J\x1b[H');
  },
  
  /**
   * Print with newline
   */
  print(...args) {
    console.log(...args);
  },
  
  /**
   * Print without newline
   */
  write(text) {
    process.stdout.write(text);
  },
  
  /**
   * Print empty line
   */
  newline(count = 1) {
    console.log('\n'.repeat(count - 1));
  },
};

/**
 * Spinner for async operations
 */
export class Spinner {
  constructor(options = {}) {
    this.frames = options.frames || ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    this.interval = options.interval || 80;
    this.color = options.color || 'cyan';
    this.text = options.text || '';
    this.stream = options.stream || process.stdout;
    
    this._frameIndex = 0;
    this._timer = null;
    this._isSpinning = false;
  }
  
  start(text = this.text) {
    if (this._isSpinning) return this;
    
    this.text = text;
    this._isSpinning = true;
    Cursor.hide();
    
    this._timer = setInterval(() => {
      this._render();
      this._frameIndex = (this._frameIndex + 1) % this.frames.length;
    }, this.interval);
    
    return this;
  }
  
  _render() {
    Cursor.clearLine();
    Cursor.toColumn(1);
    const frame = Color.apply(this.frames[this._frameIndex], this.color);
    this.stream.write(`${frame} ${this.text}`);
  }
  
  update(text) {
    this.text = text;
    return this;
  }
  
  stop() {
    if (!this._isSpinning) return this;
    
    clearInterval(this._timer);
    this._timer = null;
    this._isSpinning = false;
    
    Cursor.clearLine();
    Cursor.toColumn(1);
    Cursor.show();
    
    return this;
  }
  
  success(text = this.text) {
    this.stop();
    console.log(`${Color.green('✔')} ${text}`);
    return this;
  }
  
  fail(text = this.text) {
    this.stop();
    console.log(`${Color.red('✖')} ${text}`);
    return this;
  }
  
  warn(text = this.text) {
    this.stop();
    console.log(`${Color.yellow('▲')} ${text}`);
    return this;
  }
  
  info(text = this.text) {
    this.stop();
    console.log(`${Color.blue('●')} ${text}`);
    return this;
  }
}

/**
 * Progress bar
 */
export class ProgressBar {
  constructor(options = {}) {
    this.total = options.total || 100;
    this.width = options.width || 40;
    this.complete = options.complete || '█';
    this.incomplete = options.incomplete || '░';
    this.color = options.color || 'green';
    this.showPercent = options.showPercent !== false;
    this.showCount = options.showCount !== false;
    
    this._current = 0;
    this._startTime = null;
  }
  
  start() {
    this._startTime = Date.now();
    this._current = 0;
    Cursor.hide();
    this._render();
    return this;
  }
  
  update(current, label = '') {
    this._current = Math.min(current, this.total);
    this._render(label);
    return this;
  }
  
  increment(amount = 1, label = '') {
    return this.update(this._current + amount, label);
  }
  
  _render(label = '') {
    const percent = Math.round((this._current / this.total) * 100);
    const filled = Math.round((this._current / this.total) * this.width);
    const empty = this.width - filled;
    
    const bar = Color.apply(this.complete.repeat(filled), this.color) + 
                Color.dim(this.incomplete.repeat(empty));
    
    let status = '';
    if (this.showPercent) status += ` ${percent.toString().padStart(3)}%`;
    if (this.showCount) status += ` (${this._current}/${this.total})`;
    if (label) status += ` ${Color.dim(label)}`;
    
    Cursor.clearLine();
    Cursor.toColumn(1);
    process.stdout.write(`${bar}${status}`);
    
    return this;
  }
  
  stop(message = '') {
    Cursor.clearLine();
    Cursor.toColumn(1);
    Cursor.show();
    
    if (message) {
      console.log(message);
    }
    
    return this;
  }
  
  complete(message = 'Complete!') {
    this.update(this.total);
    const elapsed = ((Date.now() - this._startTime) / 1000).toFixed(1);
    this.stop(`${Color.green('✔')} ${message} ${Color.dim(`(${elapsed}s)`)}`);
    return this;
  }
}

/**
 * Symbols for consistent iconography
 */
export const Symbols = {
  // Status
  success: '✔',
  error: '✖',
  warning: '▲',
  info: '●',
  
  // Progress
  bullet: '●',
  circle: '○',
  square: '■',
  diamond: '◆',
  
  // Arrows
  arrowRight: '→',
  arrowLeft: '←',
  arrowUp: '↑',
  arrowDown: '↓',
  pointer: '►',
  
  // Misc
  star: '★',
  heart: '♥',
  check: '✓',
  cross: '✗',
  ellipsis: '…',
  
  // Lines
  line: '─',
  doubleLine: '═',
  verticalLine: '│',
};

/**
 * Create styled output helper
 */
export function createStyledOutput(prefix = '', color = 'cyan') {
  return {
    log: (...args) => console.log(Color.apply(prefix, color), ...args),
    success: (msg) => console.log(Color.green(Symbols.success), msg),
    error: (msg) => console.log(Color.red(Symbols.error), msg),
    warn: (msg) => console.log(Color.yellow(Symbols.warning), msg),
    info: (msg) => console.log(Color.cyan(Symbols.info), msg),
  };
}
