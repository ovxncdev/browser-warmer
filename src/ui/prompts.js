/**
 * @fileoverview Interactive CLI prompts with beautiful styling
 */

import { createInterface } from 'readline';
import { Color, UI, Symbols, Cursor } from './components.js';

/**
 * Create readline interface
 */
function createRL() {
  return createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

/**
 * Base prompt class
 */
class BasePrompt {
  constructor(options = {}) {
    this.message = options.message || 'Input:';
    this.default = options.default;
    this.validate = options.validate || (() => true);
    this.transform = options.transform || ((v) => v);
  }

  formatMessage() {
    let msg = Color.cyan(Symbols.pointer) + ' ' + Color.bold(this.message);
    if (this.default !== undefined) {
      msg += Color.dim(` (${this.default})`);
    }
    return msg + ' ';
  }
}

/**
 * Text input prompt
 */
export class Input extends BasePrompt {
  constructor(options = {}) {
    super(options);
    this.placeholder = options.placeholder || '';
    this.mask = options.mask || null;
  }

  async run() {
    return new Promise((resolve) => {
      const rl = createRL();
      
      process.stdout.write(this.formatMessage());
      
      rl.question('', (answer) => {
        rl.close();
        
        let value = answer.trim() || this.default || '';
        value = this.transform(value);
        
        const validation = this.validate(value);
        if (validation !== true) {
          console.log(Color.red(`  ${Symbols.error} ${validation}`));
          resolve(this.run()); // Retry
          return;
        }
        
        resolve(value);
      });
    });
  }
}

/**
 * Password input (masked)
 */
export class Password extends BasePrompt {
  constructor(options = {}) {
    super(options);
    this.mask = options.mask || '*';
  }

  async run() {
    return new Promise((resolve) => {
      const rl = createRL();
      
      process.stdout.write(this.formatMessage());
      
      // Mask input
      const stdin = process.stdin;
      const wasRaw = stdin.isRaw;
      
      if (stdin.setRawMode) {
        stdin.setRawMode(true);
      }
      stdin.resume();
      
      let value = '';
      
      const onData = (char) => {
        const c = char.toString();
        
        switch (c) {
          case '\n':
          case '\r':
          case '\u0004': // Ctrl+D
            stdin.removeListener('data', onData);
            if (stdin.setRawMode) {
              stdin.setRawMode(wasRaw);
            }
            console.log();
            rl.close();
            resolve(value);
            break;
            
          case '\u0003': // Ctrl+C
            process.exit();
            break;
            
          case '\u007F': // Backspace
            if (value.length > 0) {
              value = value.slice(0, -1);
              process.stdout.write('\b \b');
            }
            break;
            
          default:
            value += c;
            process.stdout.write(this.mask);
        }
      };
      
      stdin.on('data', onData);
    });
  }
}

/**
 * Confirm (yes/no) prompt
 */
export class Confirm extends BasePrompt {
  constructor(options = {}) {
    super(options);
    this.default = options.default !== false;
  }

  formatMessage() {
    const hint = this.default ? 'Y/n' : 'y/N';
    return Color.cyan(Symbols.pointer) + ' ' + Color.bold(this.message) + Color.dim(` (${hint})`) + ' ';
  }

  async run() {
    return new Promise((resolve) => {
      const rl = createRL();
      
      process.stdout.write(this.formatMessage());
      
      rl.question('', (answer) => {
        rl.close();
        
        const input = answer.trim().toLowerCase();
        
        if (input === '') {
          resolve(this.default);
        } else if (input === 'y' || input === 'yes') {
          resolve(true);
        } else if (input === 'n' || input === 'no') {
          resolve(false);
        } else {
          console.log(Color.red(`  ${Symbols.error} Please enter y or n`));
          resolve(this.run()); // Retry
        }
      });
    });
  }
}

/**
 * Number input
 */
export class NumberPrompt extends BasePrompt {
  constructor(options = {}) {
    super(options);
    this.min = options.min ?? -Infinity;
    this.max = options.max ?? Infinity;
    this.float = options.float || false;
  }

  async run() {
    return new Promise((resolve) => {
      const rl = createRL();
      
      process.stdout.write(this.formatMessage());
      
      rl.question('', (answer) => {
        rl.close();
        
        let value = answer.trim();
        
        if (value === '' && this.default !== undefined) {
          resolve(this.default);
          return;
        }
        
        const num = this.float ? parseFloat(value) : parseInt(value, 10);
        
        if (isNaN(num)) {
          console.log(Color.red(`  ${Symbols.error} Please enter a valid number`));
          resolve(this.run());
          return;
        }
        
        if (num < this.min || num > this.max) {
          console.log(Color.red(`  ${Symbols.error} Number must be between ${this.min} and ${this.max}`));
          resolve(this.run());
          return;
        }
        
        resolve(num);
      });
    });
  }
}

/**
 * Select (single choice) prompt
 */
export class Select extends BasePrompt {
  constructor(options = {}) {
    super(options);
    this.choices = options.choices || [];
    this.pageSize = options.pageSize || 10;
    this._selectedIndex = options.default ? 
      this.choices.findIndex(c => (c.value || c) === options.default) : 0;
    if (this._selectedIndex < 0) this._selectedIndex = 0;
  }

  async run() {
    return new Promise((resolve) => {
      if (this.choices.length === 0) {
        resolve(null);
        return;
      }

      const stdin = process.stdin;
      const wasRaw = stdin.isRaw;
      
      if (stdin.setRawMode) {
        stdin.setRawMode(true);
      }
      stdin.resume();
      stdin.setEncoding('utf8');
      
      Cursor.hide();
      
      console.log(Color.cyan(Symbols.pointer) + ' ' + Color.bold(this.message));
      console.log(Color.dim('  Use arrow keys to navigate, Enter to select'));
      console.log();
      
      const startLine = 3;
      this._render();
      
      const onKeypress = (key) => {
        // Arrow up
        if (key === '\u001b[A' || key === 'k') {
          this._selectedIndex = Math.max(0, this._selectedIndex - 1);
          this._render();
        }
        // Arrow down
        else if (key === '\u001b[B' || key === 'j') {
          this._selectedIndex = Math.min(this.choices.length - 1, this._selectedIndex + 1);
          this._render();
        }
        // Enter
        else if (key === '\r' || key === '\n') {
          stdin.removeListener('data', onKeypress);
          if (stdin.setRawMode) {
            stdin.setRawMode(wasRaw);
          }
          Cursor.show();
          
          // Clear the menu
          for (let i = 0; i < this.choices.length; i++) {
            Cursor.up();
            Cursor.clearLine();
          }
          Cursor.up();
          Cursor.clearLine();
          Cursor.up();
          Cursor.clearLine();
          Cursor.up();
          Cursor.clearLine();
          
          const choice = this.choices[this._selectedIndex];
          const value = choice.value !== undefined ? choice.value : choice;
          const label = choice.name || choice.label || choice;
          
          console.log(Color.cyan(Symbols.pointer) + ' ' + Color.bold(this.message) + ' ' + Color.green(label));
          
          resolve(value);
        }
        // Ctrl+C
        else if (key === '\u0003') {
          Cursor.show();
          process.exit();
        }
      };
      
      stdin.on('data', onKeypress);
    });
  }

  _render() {
    // Move cursor up to redraw
    for (let i = 0; i < this.choices.length; i++) {
      Cursor.up();
      Cursor.clearLine();
    }
    
    // Render choices
    this.choices.forEach((choice, index) => {
      const isSelected = index === this._selectedIndex;
      const label = choice.name || choice.label || choice;
      const hint = choice.hint ? Color.dim(` - ${choice.hint}`) : '';
      
      if (isSelected) {
        console.log(Color.cyan(`  ${Symbols.pointer} ${label}`) + hint);
      } else {
        console.log(Color.dim(`    ${label}`) + hint);
      }
    });
  }
}

/**
 * Multi-select (checkbox) prompt
 */
export class MultiSelect extends BasePrompt {
  constructor(options = {}) {
    super(options);
    this.choices = options.choices || [];
    this.min = options.min || 0;
    this.max = options.max || Infinity;
    this._selectedIndex = 0;
    this._selected = new Set(options.default || []);
  }

  async run() {
    return new Promise((resolve) => {
      if (this.choices.length === 0) {
        resolve([]);
        return;
      }

      const stdin = process.stdin;
      const wasRaw = stdin.isRaw;
      
      if (stdin.setRawMode) {
        stdin.setRawMode(true);
      }
      stdin.resume();
      stdin.setEncoding('utf8');
      
      Cursor.hide();
      
      console.log(Color.cyan(Symbols.pointer) + ' ' + Color.bold(this.message));
      console.log(Color.dim('  Use arrows to move, Space to toggle, Enter to confirm'));
      console.log();
      
      this._render();
      
      const onKeypress = (key) => {
        // Arrow up
        if (key === '\u001b[A' || key === 'k') {
          this._selectedIndex = Math.max(0, this._selectedIndex - 1);
          this._render();
        }
        // Arrow down
        else if (key === '\u001b[B' || key === 'j') {
          this._selectedIndex = Math.min(this.choices.length - 1, this._selectedIndex + 1);
          this._render();
        }
        // Space (toggle)
        else if (key === ' ') {
          const choice = this.choices[this._selectedIndex];
          const value = choice.value !== undefined ? choice.value : choice;
          
          if (this._selected.has(value)) {
            this._selected.delete(value);
          } else if (this._selected.size < this.max) {
            this._selected.add(value);
          }
          this._render();
        }
        // Enter
        else if (key === '\r' || key === '\n') {
          if (this._selected.size < this.min) {
            // Show error but don't exit
            return;
          }
          
          stdin.removeListener('data', onKeypress);
          if (stdin.setRawMode) {
            stdin.setRawMode(wasRaw);
          }
          Cursor.show();
          
          // Clear the menu
          for (let i = 0; i < this.choices.length; i++) {
            Cursor.up();
            Cursor.clearLine();
          }
          Cursor.up();
          Cursor.clearLine();
          Cursor.up();
          Cursor.clearLine();
          Cursor.up();
          Cursor.clearLine();
          
          const selected = Array.from(this._selected);
          const labels = selected.map(v => {
            const choice = this.choices.find(c => (c.value || c) === v);
            return choice?.name || choice?.label || v;
          });
          
          console.log(Color.cyan(Symbols.pointer) + ' ' + Color.bold(this.message) + ' ' + Color.green(labels.join(', ') || 'None'));
          
          resolve(selected);
        }
        // Ctrl+C
        else if (key === '\u0003') {
          Cursor.show();
          process.exit();
        }
        // 'a' to select all
        else if (key === 'a') {
          if (this._selected.size === this.choices.length) {
            this._selected.clear();
          } else {
            this.choices.forEach(c => {
              const v = c.value !== undefined ? c.value : c;
              if (this._selected.size < this.max) {
                this._selected.add(v);
              }
            });
          }
          this._render();
        }
      };
      
      stdin.on('data', onKeypress);
    });
  }

  _render() {
    // Move cursor up to redraw
    for (let i = 0; i < this.choices.length; i++) {
      Cursor.up();
      Cursor.clearLine();
    }
    
    // Render choices
    this.choices.forEach((choice, index) => {
      const isSelected = index === this._selectedIndex;
      const value = choice.value !== undefined ? choice.value : choice;
      const isChecked = this._selected.has(value);
      const label = choice.name || choice.label || choice;
      
      const checkbox = isChecked ? Color.green(Symbols.success) : Color.dim(Symbols.circle);
      const pointer = isSelected ? Color.cyan(Symbols.pointer) : ' ';
      const text = isSelected ? Color.cyan(label) : label;
      
      console.log(`  ${pointer} ${checkbox} ${text}`);
    });
  }
}

/**
 * Autocomplete prompt
 */
export class Autocomplete extends BasePrompt {
  constructor(options = {}) {
    super(options);
    this.choices = options.choices || [];
    this.limit = options.limit || 10;
    this._input = '';
    this._filtered = this.choices.slice(0, this.limit);
    this._selectedIndex = 0;
  }

  _filter() {
    if (!this._input) {
      this._filtered = this.choices.slice(0, this.limit);
    } else {
      const lower = this._input.toLowerCase();
      this._filtered = this.choices
        .filter(c => {
          const label = (c.name || c.label || c).toLowerCase();
          return label.includes(lower);
        })
        .slice(0, this.limit);
    }
    this._selectedIndex = Math.min(this._selectedIndex, Math.max(0, this._filtered.length - 1));
  }

  async run() {
    return new Promise((resolve) => {
      const stdin = process.stdin;
      const wasRaw = stdin.isRaw;
      
      if (stdin.setRawMode) {
        stdin.setRawMode(true);
      }
      stdin.resume();
      stdin.setEncoding('utf8');
      
      Cursor.hide();
      
      this._renderPrompt();
      this._render();
      
      const onKeypress = (key) => {
        // Arrow up
        if (key === '\u001b[A') {
          this._selectedIndex = Math.max(0, this._selectedIndex - 1);
          this._render();
        }
        // Arrow down
        else if (key === '\u001b[B') {
          this._selectedIndex = Math.min(this._filtered.length - 1, this._selectedIndex + 1);
          this._render();
        }
        // Enter
        else if (key === '\r' || key === '\n') {
          stdin.removeListener('data', onKeypress);
          if (stdin.setRawMode) {
            stdin.setRawMode(wasRaw);
          }
          Cursor.show();
          
          // Clear
          for (let i = 0; i < this._filtered.length + 1; i++) {
            Cursor.up();
            Cursor.clearLine();
          }
          
          const choice = this._filtered[this._selectedIndex];
          if (choice) {
            const value = choice.value !== undefined ? choice.value : choice;
            const label = choice.name || choice.label || choice;
            console.log(Color.cyan(Symbols.pointer) + ' ' + Color.bold(this.message) + ' ' + Color.green(label));
            resolve(value);
          } else {
            resolve(this._input);
          }
        }
        // Backspace
        else if (key === '\u007F') {
          this._input = this._input.slice(0, -1);
          this._filter();
          this._renderPrompt();
          this._render();
        }
        // Ctrl+C
        else if (key === '\u0003') {
          Cursor.show();
          process.exit();
        }
        // Regular character
        else if (key.length === 1 && key >= ' ') {
          this._input += key;
          this._filter();
          this._renderPrompt();
          this._render();
        }
      };
      
      stdin.on('data', onKeypress);
    });
  }

  _renderPrompt() {
    Cursor.clearLine();
    Cursor.toColumn(1);
    process.stdout.write(Color.cyan(Symbols.pointer) + ' ' + Color.bold(this.message) + ' ' + this._input);
  }

  _render() {
    // Clear old options
    for (let i = 0; i < this.limit; i++) {
      console.log();
    }
    for (let i = 0; i < this.limit; i++) {
      Cursor.up();
      Cursor.clearLine();
    }
    
    // Render filtered options
    this._filtered.forEach((choice, index) => {
      const isSelected = index === this._selectedIndex;
      const label = choice.name || choice.label || choice;
      
      if (isSelected) {
        console.log(Color.cyan(`  ${Symbols.pointer} ${label}`));
      } else {
        console.log(Color.dim(`    ${label}`));
      }
    });
    
    // Pad remaining lines
    for (let i = this._filtered.length; i < this.limit; i++) {
      console.log();
    }
    
    // Move cursor back to input line
    for (let i = 0; i < this.limit; i++) {
      Cursor.up();
    }
    Cursor.up();
    Cursor.toColumn(this.message.length + this._input.length + 4);
  }
}

/**
 * Convenient prompt factory
 */
export const Prompt = {
  input: (options) => new Input(options).run(),
  password: (options) => new Password(options).run(),
  confirm: (options) => new Confirm(options).run(),
  number: (options) => new NumberPrompt(options).run(),
  select: (options) => new Select(options).run(),
  multiSelect: (options) => new MultiSelect(options).run(),
  autocomplete: (options) => new Autocomplete(options).run(),
  
  /**
   * Run a series of prompts
   */
  async series(prompts) {
    const results = {};
    
    for (const [name, config] of Object.entries(prompts)) {
      const type = config.type || 'input';
      const promptFn = this[type];
      
      if (!promptFn) {
        throw new Error(`Unknown prompt type: ${type}`);
      }
      
      // Support conditional prompts
      if (config.when && !config.when(results)) {
        continue;
      }
      
      results[name] = await promptFn.call(this, config);
    }
    
    return results;
  },
};

export default Prompt;
