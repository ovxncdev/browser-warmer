/**
 * @fileoverview Single source of truth for all paths across environments
 * Handles Docker, Linux, macOS, Windows seamlessly
 */

import { existsSync, statSync } from 'fs';
import { homedir, platform, tmpdir } from 'os';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

// ES Module __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Environment detection
 */
export const Environment = {
  isDocker: () => {
    try {
      // Check for .dockerenv file
      if (existsSync('/.dockerenv')) return true;
      
      // Check cgroup for docker/container references
      if (existsSync('/proc/1/cgroup')) {
        const cgroup = execSync('cat /proc/1/cgroup 2>/dev/null', { encoding: 'utf-8' });
        if (cgroup.includes('docker') || cgroup.includes('kubepods') || cgroup.includes('containerd')) {
          return true;
        }
      }
      
      // Check for Kubernetes
      if (process.env.KUBERNETES_SERVICE_HOST) return true;
      
      return false;
    } catch {
      return false;
    }
  },
  
  isCI: () => {
    return !!(
      process.env.CI ||
      process.env.GITHUB_ACTIONS ||
      process.env.GITLAB_CI ||
      process.env.JENKINS_URL ||
      process.env.TRAVIS ||
      process.env.CIRCLECI
    );
  },
  
  isWSL: () => {
    try {
      if (platform() !== 'linux') return false;
      const release = execSync('uname -r', { encoding: 'utf-8' }).toLowerCase();
      return release.includes('microsoft') || release.includes('wsl');
    } catch {
      return false;
    }
  },
  
  platform: () => platform(),
  
  isWindows: () => platform() === 'win32',
  isMac: () => platform() === 'darwin',
  isLinux: () => platform() === 'linux',
};

/**
 * Chrome/Chromium executable paths by platform
 */
const CHROME_PATHS = {
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    `${homedir()}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`,
    `${homedir()}/Applications/Chromium.app/Contents/MacOS/Chromium`,
  ],
  
  linux: [
    // Standard locations
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/brave-browser',
    '/usr/bin/microsoft-edge',
    
    // Snap installations
    '/snap/bin/chromium',
    '/snap/bin/google-chrome',
    
    // Flatpak
    '/var/lib/flatpak/exports/bin/com.google.Chrome',
    '/var/lib/flatpak/exports/bin/org.chromium.Chromium',
    
    // Alternative locations
    '/opt/google/chrome/chrome',
    '/opt/google/chrome/google-chrome',
    '/opt/chromium/chromium',
    '/opt/brave.com/brave/brave-browser',
    
    // User local
    `${homedir()}/.local/bin/chrome`,
    `${homedir()}/.local/bin/chromium`,
    
    // NixOS
    '/run/current-system/sw/bin/google-chrome-stable',
    '/run/current-system/sw/bin/chromium',
  ],
  
  win32: [
    // Chrome
    `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env['PROGRAMFILES(X86)']}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
    
    // Chrome Canary
    `${process.env.LOCALAPPDATA}\\Google\\Chrome SxS\\Application\\chrome.exe`,
    
    // Chromium
    `${process.env.PROGRAMFILES}\\Chromium\\Application\\chrome.exe`,
    `${process.env['PROGRAMFILES(X86)']}\\Chromium\\Application\\chrome.exe`,
    
    // Edge
    `${process.env.PROGRAMFILES}\\Microsoft\\Edge\\Application\\msedge.exe`,
    `${process.env['PROGRAMFILES(X86)']}\\Microsoft\\Edge\\Application\\msedge.exe`,
    
    // Brave
    `${process.env.PROGRAMFILES}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`,
    `${process.env.LOCALAPPDATA}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`,
  ],
};

/**
 * Chrome user data directory paths by platform
 */
const CHROME_USER_DATA_PATHS = {
  darwin: [
    `${homedir()}/Library/Application Support/Google/Chrome`,
    `${homedir()}/Library/Application Support/Chromium`,
    `${homedir()}/Library/Application Support/Microsoft Edge`,
    `${homedir()}/Library/Application Support/BraveSoftware/Brave-Browser`,
  ],
  
  linux: [
    `${homedir()}/.config/google-chrome`,
    `${homedir()}/.config/chromium`,
    `${homedir()}/.config/microsoft-edge`,
    `${homedir()}/.config/BraveSoftware/Brave-Browser`,
    // Snap
    `${homedir()}/snap/chromium/common/chromium`,
  ],
  
  win32: [
    `${process.env.LOCALAPPDATA}\\Google\\Chrome\\User Data`,
    `${process.env.LOCALAPPDATA}\\Chromium\\User Data`,
    `${process.env.LOCALAPPDATA}\\Microsoft\\Edge\\User Data`,
    `${process.env.LOCALAPPDATA}\\BraveSoftware\\Brave-Browser\\User Data`,
  ],
};

/**
 * Find Chrome executable with fallback strategies
 */
export async function findChrome() {
  const plat = platform();
  const paths = CHROME_PATHS[plat] || CHROME_PATHS.linux;
  
  // Strategy 1: Check known paths
  for (const chromePath of paths) {
    if (chromePath && existsSync(chromePath)) {
      try {
        const stats = statSync(chromePath);
        if (stats.isFile()) {
          return { path: chromePath, source: 'known-path' };
        }
      } catch {
        continue;
      }
    }
  }
  
  // Strategy 2: Use 'which' command on Unix-like systems
  if (!Environment.isWindows()) {
    const commands = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'brave-browser'];
    for (const cmd of commands) {
      try {
        const result = execSync(`which ${cmd} 2>/dev/null`, { encoding: 'utf-8' }).trim();
        if (result && existsSync(result)) {
          return { path: result, source: 'which-command' };
        }
      } catch {
        continue;
      }
    }
  }
  
  // Strategy 3: Use 'where' command on Windows
  if (Environment.isWindows()) {
    const commands = ['chrome', 'chromium', 'msedge', 'brave'];
    for (const cmd of commands) {
      try {
        const result = execSync(`where ${cmd} 2>nul`, { encoding: 'utf-8' }).split('\n')[0].trim();
        if (result && existsSync(result)) {
          return { path: result, source: 'where-command' };
        }
      } catch {
        continue;
      }
    }
  }
  
  // Strategy 4: Check if Puppeteer has bundled Chromium
  try {
    const puppeteer = await import('puppeteer');
    const execPath = puppeteer.executablePath();
    if (execPath && existsSync(execPath)) {
      return { path: execPath, source: 'puppeteer-bundled' };
    }
  } catch {
    // Puppeteer not installed or no bundled browser
  }
  
  // Strategy 5: Docker-specific paths
  if (Environment.isDocker()) {
    const dockerPaths = [
      '/usr/bin/google-chrome',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/headless-shell/headless-shell',
    ];
    for (const p of dockerPaths) {
      if (existsSync(p)) {
        return { path: p, source: 'docker-path' };
      }
    }
  }
  
  return null;
}

/**
 * Paths singleton - single source of truth
 */
class PathManager {
  constructor() {
    this._cache = new Map();
    this._initialized = false;
  }
  
  /**
   * Initialize and cache all paths
   */
  async initialize() {
    if (this._initialized) return this;
    
    const plat = platform();
    
    // Root directories
    this._cache.set('root', resolve(__dirname, '..', '..'));
    this._cache.set('src', resolve(__dirname, '..'));
    this._cache.set('home', homedir());
    this._cache.set('temp', tmpdir());
    
    // App directories
    const appDataBase = Environment.isWindows()
      ? process.env.APPDATA || join(homedir(), 'AppData', 'Roaming')
      : Environment.isMac()
        ? join(homedir(), 'Library', 'Application Support')
        : process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
    
    const appDir = join(appDataBase, 'browser-warmer');
    this._cache.set('appData', appDir);
    this._cache.set('config', join(appDir, 'config'));
    this._cache.set('logs', join(appDir, 'logs'));
    this._cache.set('profiles', join(appDir, 'profiles'));
    this._cache.set('cache', join(appDir, 'cache'));
    
    // Default config file locations (in priority order)
    this._cache.set('configFiles', [
      join(process.cwd(), 'browser-warmer.yaml'),
      join(process.cwd(), 'browser-warmer.yml'),
      join(process.cwd(), 'browser-warmer.json'),
      join(process.cwd(), '.browser-warmer.yaml'),
      join(appDir, 'config', 'default.yaml'),
    ]);
    
    // Sites config
    this._cache.set('sitesConfig', [
      join(process.cwd(), 'sites.yaml'),
      join(process.cwd(), 'sites.json'),
      join(appDir, 'config', 'sites.yaml'),
      join(__dirname, '..', '..', 'sites.yaml'),
    ]);
    
    // Chrome paths
    const chrome = await findChrome();
    if (chrome) {
      this._cache.set('chrome', chrome.path);
      this._cache.set('chromeSource', chrome.source);
    }
    
    // Chrome user data
    const userDataPaths = CHROME_USER_DATA_PATHS[plat] || CHROME_USER_DATA_PATHS.linux;
    for (const p of userDataPaths) {
      if (p && existsSync(p)) {
        this._cache.set('chromeUserData', p);
        break;
      }
    }
    
    this._initialized = true;
    return this;
  }
  
  /**
   * Get a path by key
   */
  get(key) {
    if (!this._initialized) {
      throw new Error('PathManager not initialized. Call await Paths.initialize() first.');
    }
    return this._cache.get(key);
  }
  
  /**
   * Get all paths as object
   */
  getAll() {
    if (!this._initialized) {
      throw new Error('PathManager not initialized. Call await Paths.initialize() first.');
    }
    return Object.fromEntries(this._cache);
  }
  
  /**
   * Set a custom path
   */
  set(key, value) {
    this._cache.set(key, value);
    return this;
  }
  
  /**
   * Resolve a path relative to a base path key
   */
  resolve(baseKey, ...segments) {
    const base = this.get(baseKey);
    if (!base) throw new Error(`Unknown path key: ${baseKey}`);
    return join(base, ...segments);
  }
  
  /**
   * Ensure a directory exists
   */
  async ensureDir(key) {
    const { mkdir } = await import('fs/promises');
    const dir = typeof key === 'string' && this._cache.has(key) ? this.get(key) : key;
    await mkdir(dir, { recursive: true });
    return dir;
  }
  
  /**
   * Get environment info
   */
  getEnvironmentInfo() {
    return {
      platform: platform(),
      isDocker: Environment.isDocker(),
      isCI: Environment.isCI(),
      isWSL: Environment.isWSL(),
      nodeVersion: process.version,
      arch: process.arch,
    };
  }
}

// Export singleton
export const Paths = new PathManager();

// Export environment utilities
export { CHROME_PATHS, CHROME_USER_DATA_PATHS };
