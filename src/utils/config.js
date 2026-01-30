/**
 * @fileoverview Configuration management with YAML/JSON support, validation, and environment overrides
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { Paths, Environment } from './paths.js';
import { createLogger } from './logger.js';

const log = createLogger({ name: 'config' });

/**
 * Default configuration schema with descriptions
 */
export const DEFAULT_CONFIG = {
  // Browser settings
  browser: {
    headless: false,
    executablePath: null, // Auto-detected if null
    profilePath: './browser-profile',
    args: [],
    viewport: {
      width: 1366,
      height: 768,
    },
    userAgent: null, // Auto-generated if null
    locale: 'en-US',
    timezone: null, // System default if null
  },
  
  // Timing settings (in seconds)
  timing: {
    minStay: 10,
    maxStay: 60,
    minWait: 5,
    maxWait: 30,
    pageTimeout: 30,
    navigationTimeout: 30,
  },
  
  // Behavior settings
  behavior: {
    scroll: true,
    clickLinks: true,
    mouseMoves: true,
    typing: false,
    searches: true,
    searchCount: 3,
    maxDepth: 2, // How many links deep to follow
  },
  
  // Site settings
  sites: {
    categories: ['all'],
    custom: [],
    exclude: [],
    maxSites: 0, // 0 = unlimited
    shuffleSites: true,
  },
  
  // Session settings
  session: {
    maxDuration: 0, // 0 = unlimited (in minutes)
    maxPages: 0, // 0 = unlimited
    breakInterval: 0, // Take breaks every N minutes (0 = no breaks)
    breakDuration: { min: 60, max: 300 }, // Break duration in seconds
  },
  
  // Logging settings
  logging: {
    level: 'info',
    file: true,
    console: true,
    pretty: true,
  },
  
  // WebSocket server settings
  websocket: {
    enabled: false,
    port: 8765,
    host: 'localhost',
  },
  
  // Stealth settings
  stealth: {
    enabled: true,
    evasions: [
      'chrome.app',
      'chrome.csi',
      'chrome.loadTimes',
      'chrome.runtime',
      'navigator.hardwareConcurrency',
      'navigator.languages',
      'navigator.permissions',
      'navigator.plugins',
      'navigator.webdriver',
      'window.outerdimensions',
    ],
  },
};

/**
 * Environment variable mappings
 */
const ENV_MAPPINGS = {
  BROWSER_WARMER_HEADLESS: { path: 'browser.headless', type: 'boolean' },
  BROWSER_WARMER_CHROME_PATH: { path: 'browser.executablePath', type: 'string' },
  BROWSER_WARMER_PROFILE: { path: 'browser.profilePath', type: 'string' },
  BROWSER_WARMER_LOG_LEVEL: { path: 'logging.level', type: 'string' },
  BROWSER_WARMER_WS_ENABLED: { path: 'websocket.enabled', type: 'boolean' },
  BROWSER_WARMER_WS_PORT: { path: 'websocket.port', type: 'number' },
  BROWSER_WARMER_MIN_STAY: { path: 'timing.minStay', type: 'number' },
  BROWSER_WARMER_MAX_STAY: { path: 'timing.maxStay', type: 'number' },
};

/**
 * Deep merge objects
 */
function deepMerge(target, source) {
  const result = { ...target };
  
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(result[key] || {}, source[key]);
    } else if (source[key] !== undefined) {
      result[key] = source[key];
    }
  }
  
  return result;
}

/**
 * Set nested value by path
 */
function setByPath(obj, path, value) {
  const parts = path.split('.');
  let current = obj;
  
  for (let i = 0; i < parts.length - 1; i++) {
    if (!current[parts[i]]) {
      current[parts[i]] = {};
    }
    current = current[parts[i]];
  }
  
  current[parts[parts.length - 1]] = value;
}

/**
 * Get nested value by path
 */
function getByPath(obj, path, defaultValue = undefined) {
  const parts = path.split('.');
  let current = obj;
  
  for (const part of parts) {
    if (current === null || current === undefined) {
      return defaultValue;
    }
    current = current[part];
  }
  
  return current !== undefined ? current : defaultValue;
}

/**
 * Parse value by type
 */
function parseValue(value, type) {
  switch (type) {
    case 'boolean':
      return value === 'true' || value === '1' || value === true;
    case 'number':
      return Number(value);
    case 'array':
      return typeof value === 'string' ? value.split(',').map(s => s.trim()) : value;
    default:
      return value;
  }
}

/**
 * Validate configuration
 */
function validateConfig(config) {
  const errors = [];
  const warnings = [];
  
  // Timing validation
  if (config.timing.minStay > config.timing.maxStay) {
    errors.push('timing.minStay cannot be greater than timing.maxStay');
  }
  if (config.timing.minWait > config.timing.maxWait) {
    errors.push('timing.minWait cannot be greater than timing.maxWait');
  }
  if (config.timing.minStay < 1) {
    warnings.push('timing.minStay less than 1 second may trigger bot detection');
  }
  
  // Browser validation
  if (config.browser.viewport.width < 800) {
    warnings.push('Viewport width less than 800px may trigger bot detection');
  }
  if (config.browser.viewport.height < 600) {
    warnings.push('Viewport height less than 600px may trigger bot detection');
  }
  
  // Behavior validation
  if (config.behavior.maxDepth > 5) {
    warnings.push('maxDepth greater than 5 may cause very long sessions');
  }
  
  // WebSocket validation
  if (config.websocket.enabled && config.websocket.port < 1024) {
    warnings.push('WebSocket port below 1024 may require elevated permissions');
  }
  
  return { errors, warnings, valid: errors.length === 0 };
}

/**
 * Configuration Manager Class
 */
class ConfigManager {
  constructor() {
    this._config = null;
    this._configPath = null;
    this._loaded = false;
  }
  
  /**
   * Load configuration from multiple sources
   * Priority: CLI args > Environment > Config file > Defaults
   */
  async load(options = {}) {
    // Start with defaults
    let config = deepMerge({}, DEFAULT_CONFIG);
    
    // Initialize paths if needed
    await Paths.initialize();
    
    // Load from file if specified or found
    const configPath = options.configPath || this._findConfigFile();
    if (configPath && existsSync(configPath)) {
      try {
        const fileConfig = this._loadFile(configPath);
        config = deepMerge(config, fileConfig);
        this._configPath = configPath;
        log.debug('Loaded config from file', { path: configPath });
      } catch (err) {
        log.warn('Failed to load config file', { path: configPath, error: err.message });
      }
    }
    
    // Apply environment variables
    config = this._applyEnvironment(config);
    
    // Apply CLI options (highest priority)
    if (options.overrides) {
      config = deepMerge(config, options.overrides);
    }
    
    // Apply Docker-specific defaults
    if (Environment.isDocker()) {
      config = this._applyDockerDefaults(config);
    }
    
    // Validate
    const validation = validateConfig(config);
    if (!validation.valid) {
      for (const error of validation.errors) {
        log.error('Config validation error', { error });
      }
      throw new Error('Invalid configuration: ' + validation.errors.join(', '));
    }
    
    for (const warning of validation.warnings) {
      log.warn('Config warning', { warning });
    }
    
    this._config = config;
    this._loaded = true;
    
    return config;
  }
  
  /**
   * Find config file in standard locations
   */
  _findConfigFile() {
    const locations = Paths.get('configFiles') || [];
    
    for (const loc of locations) {
      if (existsSync(loc)) {
        return loc;
      }
    }
    
    return null;
  }
  
  /**
   * Load config from file (YAML or JSON)
   */
  _loadFile(filePath) {
    const content = readFileSync(filePath, 'utf-8');
    
    if (filePath.endsWith('.yaml') || filePath.endsWith('.yml')) {
      return parseYaml(content);
    } else if (filePath.endsWith('.json')) {
      return JSON.parse(content);
    } else {
      // Try YAML first, then JSON
      try {
        return parseYaml(content);
      } catch {
        return JSON.parse(content);
      }
    }
  }
  
  /**
   * Apply environment variables
   */
  _applyEnvironment(config) {
    for (const [envVar, mapping] of Object.entries(ENV_MAPPINGS)) {
      const value = process.env[envVar];
      if (value !== undefined) {
        setByPath(config, mapping.path, parseValue(value, mapping.type));
        log.debug('Applied env override', { var: envVar, path: mapping.path });
      }
    }
    
    return config;
  }
  
  /**
   * Apply Docker-specific defaults
   */
  _applyDockerDefaults(config) {
    // Docker usually needs headless mode
    if (config.browser.headless === false && !process.env.DISPLAY) {
      config.browser.headless = true;
      log.info('Enabled headless mode for Docker (no DISPLAY)');
    }
    
    // Add Docker-specific Chrome args
    const dockerArgs = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ];
    
    config.browser.args = [...new Set([...config.browser.args, ...dockerArgs])];
    
    return config;
  }
  
  /**
   * Get current config
   */
  get() {
    if (!this._loaded) {
      throw new Error('Configuration not loaded. Call await Config.load() first.');
    }
    return this._config;
  }
  
  /**
   * Get value by path
   */
  getValue(path, defaultValue) {
    return getByPath(this.get(), path, defaultValue);
  }
  
  /**
   * Set value by path
   */
  setValue(path, value) {
    setByPath(this._config, path, value);
  }
  
  /**
   * Save current config to file
   */
  save(filePath = null) {
    const targetPath = filePath || this._configPath || join(process.cwd(), 'browser-warmer.yaml');
    const dir = dirname(targetPath);
    
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    
    let content;
    if (targetPath.endsWith('.json')) {
      content = JSON.stringify(this._config, null, 2);
    } else {
      content = stringifyYaml(this._config);
    }
    
    writeFileSync(targetPath, content, 'utf-8');
    log.info('Saved config', { path: targetPath });
    
    return targetPath;
  }
  
  /**
   * Generate default config file
   */
  generateDefault(filePath, format = 'yaml') {
    const targetPath = filePath || join(process.cwd(), `browser-warmer.${format === 'json' ? 'json' : 'yaml'}`);
    const dir = dirname(targetPath);
    
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    
    let content;
    if (format === 'json') {
      content = JSON.stringify(DEFAULT_CONFIG, null, 2);
    } else {
      content = stringifyYaml(DEFAULT_CONFIG);
    }
    
    writeFileSync(targetPath, content, 'utf-8');
    log.info('Generated default config', { path: targetPath });
    
    return targetPath;
  }
  
  /**
   * Reset to defaults
   */
  reset() {
    this._config = deepMerge({}, DEFAULT_CONFIG);
    return this._config;
  }
  
  /**
   * Export for CLI display
   */
  toDisplayObject() {
    return {
      'Browser': {
        'Headless': this._config.browser.headless,
        'Profile': this._config.browser.profilePath,
        'Viewport': `${this._config.browser.viewport.width}x${this._config.browser.viewport.height}`,
      },
      'Timing': {
        'Stay': `${this._config.timing.minStay}s - ${this._config.timing.maxStay}s`,
        'Wait': `${this._config.timing.minWait}s - ${this._config.timing.maxWait}s`,
      },
      'Behavior': {
        'Scroll': this._config.behavior.scroll,
        'Click Links': this._config.behavior.clickLinks,
        'Searches': this._config.behavior.searches ? this._config.behavior.searchCount : false,
      },
      'Sites': {
        'Categories': this._config.sites.categories.join(', '),
        'Max Sites': this._config.sites.maxSites || 'Unlimited',
      },
    };
  }
}

// Export singleton
export const Config = new ConfigManager();

// Export utilities
export { deepMerge, getByPath, setByPath, validateConfig };
