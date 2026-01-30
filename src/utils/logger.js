/**
 * @fileoverview Advanced logging system with structured logs, file rotation, and pretty console output
 */

import { createWriteStream, existsSync, mkdirSync, readdirSync, unlinkSync, statSync } from 'fs';
import { join } from 'path';
import { EventEmitter } from 'events';

/**
 * Log levels with numeric priority
 */
export const LogLevel = {
  TRACE: 10,
  DEBUG: 20,
  INFO: 30,
  WARN: 40,
  ERROR: 50,
  FATAL: 60,
  SILENT: 100,
};

/**
 * ANSI color codes for terminal output
 */
const Colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  underline: '\x1b[4m',
  
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
  
  // Bright colors
  brightRed: '\x1b[91m',
  brightGreen: '\x1b[92m',
  brightYellow: '\x1b[93m',
  brightBlue: '\x1b[94m',
  brightMagenta: '\x1b[95m',
  brightCyan: '\x1b[96m',
  
  // Background colors
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
};

/**
 * Level configurations with ASCII/Unicode symbols (no emojis)
 */
const LevelConfig = {
  trace: { priority: LogLevel.TRACE, color: Colors.gray, label: 'TRACE', icon: '○' },
  debug: { priority: LogLevel.DEBUG, color: Colors.cyan, label: 'DEBUG', icon: '◆' },
  info: { priority: LogLevel.INFO, color: Colors.green, label: 'INFO ', icon: '●' },
  warn: { priority: LogLevel.WARN, color: Colors.yellow, label: 'WARN ', icon: '▲' },
  error: { priority: LogLevel.ERROR, color: Colors.red, label: 'ERROR', icon: '✖' },
  fatal: { priority: LogLevel.FATAL, color: Colors.brightRed, label: 'FATAL', icon: '◈' },
};

/**
 * Format timestamp
 */
function formatTimestamp(date = new Date()) {
  return date.toISOString();
}

/**
 * Format timestamp for console (shorter)
 */
function formatTimeShort(date = new Date()) {
  return date.toLocaleTimeString('en-US', { 
    hour12: false, 
    hour: '2-digit', 
    minute: '2-digit', 
    second: '2-digit' 
  });
}

/**
 * Safely stringify objects with circular reference handling
 */
function safeStringify(obj, indent = 0) {
  const seen = new WeakSet();
  
  return JSON.stringify(obj, (key, value) => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) {
        return '[Circular]';
      }
      seen.add(value);
    }
    
    // Handle special types
    if (value instanceof Error) {
      return {
        name: value.name,
        message: value.message,
        stack: value.stack,
        ...value,
      };
    }
    
    if (typeof value === 'bigint') {
      return value.toString();
    }
    
    if (typeof value === 'function') {
      return `[Function: ${value.name || 'anonymous'}]`;
    }
    
    return value;
  }, indent);
}

/**
 * Format object for console display
 */
function formatObject(obj, indent = 2) {
  if (obj === null || obj === undefined) return '';
  if (typeof obj !== 'object') return String(obj);
  
  try {
    const lines = safeStringify(obj, indent).split('\n');
    return lines.map(line => `${Colors.dim}${line}${Colors.reset}`).join('\n');
  } catch {
    return '[Object]';
  }
}

/**
 * Logger class with advanced features
 */
class Logger extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      name: options.name || 'app',
      level: options.level || 'info',
      pretty: options.pretty !== false,
      colors: options.colors !== false,
      timestamp: options.timestamp !== false,
      icons: options.icons !== false,
      filePath: options.filePath || null,
      maxFiles: options.maxFiles || 5,
      maxFileSize: options.maxFileSize || 10 * 1024 * 1024, // 10MB
      context: options.context || {},
    };
    
    this._fileStream = null;
    this._currentFileSize = 0;
    this._sessionId = this._generateSessionId();
    
    if (this.options.filePath) {
      this._initFileLogging();
    }
  }
  
  /**
   * Generate unique session ID
   */
  _generateSessionId() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }
  
  /**
   * Initialize file logging
   */
  _initFileLogging() {
    const dir = this.options.filePath;
    
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    
    this._rotateLogsIfNeeded();
    this._openLogFile();
  }
  
  /**
   * Open log file for writing
   */
  _openLogFile() {
    const filename = `${this.options.name}-${new Date().toISOString().split('T')[0]}.log`;
    const filepath = join(this.options.filePath, filename);
    
    this._fileStream = createWriteStream(filepath, { flags: 'a' });
    this._currentFilePath = filepath;
    
    if (existsSync(filepath)) {
      this._currentFileSize = statSync(filepath).size;
    }
  }
  
  /**
   * Rotate log files if needed
   */
  _rotateLogsIfNeeded() {
    const dir = this.options.filePath;
    if (!existsSync(dir)) return;
    
    const files = readdirSync(dir)
      .filter(f => f.endsWith('.log'))
      .map(f => ({
        name: f,
        path: join(dir, f),
        time: statSync(join(dir, f)).mtime.getTime(),
      }))
      .sort((a, b) => b.time - a.time);
    
    // Remove old files
    while (files.length >= this.options.maxFiles) {
      const oldest = files.pop();
      try {
        unlinkSync(oldest.path);
      } catch {
        // Ignore deletion errors
      }
    }
  }
  
  /**
   * Check if should log at level
   */
  _shouldLog(level) {
    const config = LevelConfig[level];
    const currentLevel = LevelConfig[this.options.level]?.priority || LogLevel.INFO;
    return config && config.priority >= currentLevel;
  }
  
  /**
   * Format message for console
   */
  _formatConsole(level, message, data) {
    const config = LevelConfig[level];
    const parts = [];
    
    // Timestamp
    if (this.options.timestamp) {
      parts.push(`${Colors.dim}${formatTimeShort()}${Colors.reset}`);
    }
    
    // Icon
    if (this.options.icons) {
      parts.push(config.icon);
    }
    
    // Level
    if (this.options.colors) {
      parts.push(`${config.color}${Colors.bold}${config.label}${Colors.reset}`);
    } else {
      parts.push(config.label);
    }
    
    // Name/context
    if (this.options.name && this.options.name !== 'app') {
      parts.push(`${Colors.magenta}[${this.options.name}]${Colors.reset}`);
    }
    
    // Message
    parts.push(message);
    
    let output = parts.join(' ');
    
    // Data
    if (data && Object.keys(data).length > 0) {
      output += '\n' + formatObject(data);
    }
    
    return output;
  }
  
  /**
   * Format message for file
   */
  _formatFile(level, message, data) {
    const entry = {
      timestamp: formatTimestamp(),
      level: level.toUpperCase(),
      name: this.options.name,
      sessionId: this._sessionId,
      message,
      ...this.options.context,
      ...data,
    };
    
    return safeStringify(entry) + '\n';
  }
  
  /**
   * Write to file
   */
  _writeFile(content) {
    if (!this._fileStream) return;
    
    const bytes = Buffer.byteLength(content);
    
    // Check if rotation needed
    if (this._currentFileSize + bytes > this.options.maxFileSize) {
      this._fileStream.end();
      this._rotateLogsIfNeeded();
      this._openLogFile();
    }
    
    this._fileStream.write(content);
    this._currentFileSize += bytes;
  }
  
  /**
   * Core log method
   */
  _log(level, message, data = {}) {
    if (!this._shouldLog(level)) return;
    
    // Emit event for external handlers
    this.emit('log', { level, message, data, timestamp: new Date() });
    
    // Console output
    if (this.options.pretty) {
      const formatted = this._formatConsole(level, message, data);
      
      if (level === 'error' || level === 'fatal') {
        console.error(formatted);
      } else if (level === 'warn') {
        console.warn(formatted);
      } else {
        console.log(formatted);
      }
    }
    
    // File output
    if (this._fileStream) {
      this._writeFile(this._formatFile(level, message, data));
    }
  }
  
  // Log level methods
  trace(message, data) { this._log('trace', message, data); }
  debug(message, data) { this._log('debug', message, data); }
  info(message, data) { this._log('info', message, data); }
  warn(message, data) { this._log('warn', message, data); }
  error(message, data) { this._log('error', message, data); }
  fatal(message, data) { this._log('fatal', message, data); }
  
  /**
   * Log with explicit level
   */
  log(level, message, data) {
    this._log(level, message, data);
  }
  
  /**
   * Create child logger with additional context
   */
  child(options = {}) {
    return new Logger({
      ...this.options,
      name: options.name || this.options.name,
      context: { ...this.options.context, ...options.context },
      filePath: this.options.filePath, // Share file path
    });
  }
  
  /**
   * Set log level
   */
  setLevel(level) {
    if (LevelConfig[level]) {
      this.options.level = level;
    }
    return this;
  }
  
  /**
   * Add context
   */
  addContext(ctx) {
    this.options.context = { ...this.options.context, ...ctx };
    return this;
  }
  
  /**
   * Create a timer for measuring operations
   */
  timer(label) {
    const start = performance.now();
    
    return {
      done: (message, data = {}) => {
        const duration = performance.now() - start;
        this.info(message || label, { 
          ...data, 
          duration: `${duration.toFixed(2)}ms`,
          durationMs: Math.round(duration),
        });
      },
      
      fail: (message, data = {}) => {
        const duration = performance.now() - start;
        this.error(message || `${label} failed`, { 
          ...data, 
          duration: `${duration.toFixed(2)}ms`,
          durationMs: Math.round(duration),
        });
      },
    };
  }
  
  /**
   * Group related logs
   */
  group(label) {
    console.group(`${Colors.bold}${Colors.blue}► ${label}${Colors.reset}`);
  }
  
  groupEnd() {
    console.groupEnd();
  }
  
  /**
   * Separator line
   */
  separator(char = '─', length = 50) {
    console.log(Colors.dim + char.repeat(length) + Colors.reset);
  }
  
  /**
   * Table output
   */
  table(data, columns) {
    console.table(data, columns);
  }
  
  /**
   * Progress indicator
   */
  progress(current, total, label = '') {
    const percent = Math.round((current / total) * 100);
    const filled = Math.round(percent / 2);
    const empty = 50 - filled;
    
    const bar = `${Colors.green}${'█'.repeat(filled)}${Colors.dim}${'░'.repeat(empty)}${Colors.reset}`;
    const text = `${bar} ${percent}% ${label}`;
    
    process.stdout.write(`\r${text}`);
    
    if (current >= total) {
      console.log();
    }
  }
  
  /**
   * Close file streams
   */
  close() {
    if (this._fileStream) {
      this._fileStream.end();
      this._fileStream = null;
    }
  }
}

/**
 * Default logger instance
 */
let defaultLogger = null;

/**
 * Create or get default logger
 */
export function getLogger(options) {
  if (!defaultLogger || options) {
    defaultLogger = new Logger(options);
  }
  return defaultLogger;
}

/**
 * Create a new logger instance
 */
export function createLogger(options) {
  return new Logger(options);
}

/**
 * Export Logger class for extending
 */
export { Logger, Colors };
