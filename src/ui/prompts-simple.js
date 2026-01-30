/**
 * @fileoverview Simple CLI prompts - Windows compatible
 */

import { createInterface } from 'readline';

// Simple colors that work on Windows
const Color = {
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

const Symbols = {
  pointer: '>',
  success: '[OK]',
  error: '[X]',
};

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
 * Simple text input
 */
async function input(options = {}) {
  const { message = 'Input:', default: defaultVal = '' } = options;
  
  return new Promise((resolve) => {
    const rl = createRL();
    const prompt = `${Color.cyan(Symbols.pointer)} ${message}${defaultVal ? ` (${defaultVal})` : ''}: `;
    
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultVal);
    });
  });
}

/**
 * Yes/No confirm
 */
async function confirm(options = {}) {
  const { message = 'Confirm?', default: defaultVal = true } = options;
  
  return new Promise((resolve) => {
    const rl = createRL();
    const hint = defaultVal ? 'Y/n' : 'y/N';
    const prompt = `${Color.cyan(Symbols.pointer)} ${message} (${hint}): `;
    
    rl.question(prompt, (answer) => {
      rl.close();
      const input = answer.trim().toLowerCase();
      
      if (input === '') {
        resolve(defaultVal);
      } else if (input === 'y' || input === 'yes') {
        resolve(true);
      } else if (input === 'n' || input === 'no') {
        resolve(false);
      } else {
        console.log(Color.red('  Please enter y or n'));
        resolve(confirm(options));
      }
    });
  });
}

/**
 * Number input
 */
async function number(options = {}) {
  const { message = 'Enter number:', default: defaultVal = 0, min = 0, max = Infinity } = options;
  
  return new Promise((resolve) => {
    const rl = createRL();
    const prompt = `${Color.cyan(Symbols.pointer)} ${message} (${defaultVal}): `;
    
    rl.question(prompt, (answer) => {
      rl.close();
      
      if (answer.trim() === '') {
        resolve(defaultVal);
        return;
      }
      
      const num = parseInt(answer.trim(), 10);
      
      if (isNaN(num)) {
        console.log(Color.red('  Please enter a valid number'));
        resolve(number(options));
        return;
      }
      
      if (num < min || num > max) {
        console.log(Color.red(`  Number must be between ${min} and ${max}`));
        resolve(number(options));
        return;
      }
      
      resolve(num);
    });
  });
}

/**
 * Select from list (simple numbered version)
 */
async function select(options = {}) {
  const { message = 'Select:', choices = [] } = options;
  
  console.log(`\n${Color.cyan(Symbols.pointer)} ${message}`);
  console.log(Color.dim('  Enter the number of your choice:\n'));
  
  choices.forEach((choice, index) => {
    const label = choice.name || choice.label || choice;
    const value = choice.value !== undefined ? choice.value : choice;
    console.log(`  ${Color.cyan(index + 1)}. ${label}`);
  });
  
  console.log();
  
  return new Promise((resolve) => {
    const rl = createRL();
    
    rl.question(`${Color.cyan(Symbols.pointer)} Enter number (1-${choices.length}): `, (answer) => {
      rl.close();
      
      const num = parseInt(answer.trim(), 10);
      
      if (isNaN(num) || num < 1 || num > choices.length) {
        console.log(Color.red(`  Please enter a number between 1 and ${choices.length}`));
        resolve(select(options));
        return;
      }
      
      const choice = choices[num - 1];
      const value = choice.value !== undefined ? choice.value : choice;
      const label = choice.name || choice.label || choice;
      
      console.log(Color.green(`  Selected: ${label}\n`));
      resolve(value);
    });
  });
}

/**
 * Multi-select from list (simple numbered version)
 */
async function multiSelect(options = {}) {
  const { message = 'Select:', choices = [], default: defaultVal = [] } = options;
  
  console.log(`\n${Color.cyan(Symbols.pointer)} ${message}`);
  console.log(Color.dim('  Enter numbers separated by commas (e.g., 1,3,5) or "all":\n'));
  
  choices.forEach((choice, index) => {
    const label = choice.name || choice.label || choice;
    console.log(`  ${Color.cyan(index + 1)}. ${label}`);
  });
  
  console.log();
  
  return new Promise((resolve) => {
    const rl = createRL();
    
    rl.question(`${Color.cyan(Symbols.pointer)} Enter numbers (or "all"): `, (answer) => {
      rl.close();
      
      const input = answer.trim().toLowerCase();
      
      if (input === '' && defaultVal.length > 0) {
        resolve(defaultVal);
        return;
      }
      
      if (input === 'all' || input === 'a') {
        const allValues = choices.map(c => c.value !== undefined ? c.value : c);
        console.log(Color.green(`  Selected: All (${choices.length} items)\n`));
        resolve(allValues);
        return;
      }
      
      const nums = input.split(',').map(s => parseInt(s.trim(), 10));
      const invalid = nums.some(n => isNaN(n) || n < 1 || n > choices.length);
      
      if (invalid) {
        console.log(Color.red(`  Please enter valid numbers between 1 and ${choices.length}`));
        resolve(multiSelect(options));
        return;
      }
      
      const selected = nums.map(n => {
        const choice = choices[n - 1];
        return choice.value !== undefined ? choice.value : choice;
      });
      
      const labels = nums.map(n => {
        const choice = choices[n - 1];
        return choice.name || choice.label || choice;
      });
      
      console.log(Color.green(`  Selected: ${labels.join(', ')}\n`));
      resolve(selected);
    });
  });
}

/**
 * Run a series of prompts
 */
async function series(prompts) {
  const results = {};
  const promptFns = { input, confirm, number, select, multiSelect };
  
  for (const [name, config] of Object.entries(prompts)) {
    const type = config.type || 'input';
    const fn = promptFns[type];
    
    if (!fn) {
      throw new Error(`Unknown prompt type: ${type}`);
    }
    
    // Support conditional prompts
    if (config.when && !config.when(results)) {
      continue;
    }
    
    results[name] = await fn(config);
  }
  
  return results;
}

export const Prompt = {
  input,
  confirm,
  number,
  select,
  multiSelect,
  series,
};

export { Input, Confirm, NumberPrompt, Select, MultiSelect } from './prompts.js';
export default Prompt;
