/**
 * @fileoverview Browser controller with stealth mode, auto-detection, and robust error handling
 */

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { EventEmitter } from 'events';
import { existsSync, mkdirSync } from 'fs';
import { resolve as pathResolve } from 'path';
import { Paths, findChrome, Environment } from '../utils/paths.js';
import { Config } from '../utils/config.js';
import { createLogger } from '../utils/logger.js';
import { Random } from '../utils/random.js';

const log = createLogger({ name: 'browser' });

// Apply stealth plugin
puppeteer.use(StealthPlugin());

/**
 * Common user agents by platform
 */
const USER_AGENTS = {
  windows: [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Edg/122.0.0.0',
  ],
  mac: [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:123.0) Gecko/20100101 Firefox/123.0',
  ],
  linux: [
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64; rv:123.0) Gecko/20100101 Firefox/123.0',
    'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:123.0) Gecko/20100101 Firefox/123.0',
  ],
};

/**
 * Common screen resolutions
 */
const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
  { width: 1536, height: 864 },
  { width: 1440, height: 900 },
  { width: 1280, height: 720 },
  { width: 1600, height: 900 },
  { width: 2560, height: 1440 },
];

/**
 * Common timezones
 */
const TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Phoenix',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Australia/Sydney',
];

/**
 * Browser Controller Class
 */
export class BrowserController extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = options;
    this.browser = null;
    this.page = null;
    this.context = null;
    this._isConnected = false;
    this._launchConfig = null;
    this._profile = null;
  }

  /**
   * Initialize and launch browser
   */
  async launch() {
    const config = Config.get();
    const browserConfig = config.browser;
    
    log.info('Preparing browser launch...');
    
    // Find Chrome executable
    let executablePath = browserConfig.executablePath;
    if (!executablePath) {
      const chrome = await findChrome();
      if (chrome) {
        executablePath = chrome.path;
        log.info('Found Chrome', { path: executablePath, source: chrome.source });
      } else {
        log.warn('Chrome not found, using Puppeteer bundled Chromium');
      }
    }
    
    // Prepare profile directory
    const profilePath = this._resolveProfilePath(browserConfig.profilePath);
    if (!existsSync(profilePath)) {
      mkdirSync(profilePath, { recursive: true });
      log.debug('Created profile directory', { path: profilePath });
    }
    
    // Generate browser fingerprint
    this._profile = this._generateProfile(browserConfig);
    
    // Build launch arguments
    const args = this._buildLaunchArgs(browserConfig, this._profile);
    
    // Launch configuration
    this._launchConfig = {
      headless: browserConfig.headless ? 'new' : false,
      executablePath: executablePath || undefined,
      userDataDir: profilePath,
      args,
      defaultViewport: null,
      ignoreDefaultArgs: ['--enable-automation'],
      handleSIGINT: true,
      handleSIGTERM: true,
      handleSIGHUP: true,
      timeout: 60000,
    };
    
    // Docker-specific adjustments
    if (Environment.isDocker()) {
      this._launchConfig.args.push('--no-sandbox');
      this._launchConfig.args.push('--disable-setuid-sandbox');
      this._launchConfig.args.push('--disable-dev-shm-usage');
      
      if (!process.env.DISPLAY) {
        this._launchConfig.headless = 'new';
        log.info('Forcing headless mode (no DISPLAY in Docker)');
      }
    }
    
    log.debug('Launch config', { 
      headless: this._launchConfig.headless,
      profile: profilePath,
      argsCount: args.length,
    });
    
    try {
      this.browser = await puppeteer.launch(this._launchConfig);
      this._isConnected = true;
      
      // Set up event handlers
      this.browser.on('disconnected', () => {
        this._isConnected = false;
        log.warn('Browser disconnected');
        this.emit('disconnected');
      });
      
      // Create initial page
      const pages = await this.browser.pages();
      this.page = pages[0] || await this.browser.newPage();
      
      // Configure the page
      await this._configurePage(this.page);
      
      log.info('Browser launched successfully', {
        headless: this._launchConfig.headless,
        viewport: `${this._profile.viewport.width}x${this._profile.viewport.height}`,
        userAgent: this._profile.userAgent.substring(0, 50) + '...',
      });
      
      this.emit('launched', { browser: this.browser, page: this.page });
      
      return { browser: this.browser, page: this.page };
      
    } catch (error) {
      log.error('Failed to launch browser', { error: error.message });
      throw this._enhanceError(error);
    }
  }

  /**
   * Generate a realistic browser profile
   */
  _generateProfile(config) {
    const platform = Environment.isWindows() ? 'windows' : 
                     Environment.isMac() ? 'mac' : 'linux';
    
    const userAgent = config.userAgent || Random.pick(USER_AGENTS[platform]);
    const viewport = config.viewport?.width ? config.viewport : Random.pick(VIEWPORTS);
    const timezone = config.timezone || Random.pick(TIMEZONES);
    const locale = config.locale || 'en-US';
    
    const webglVendor = 'Google Inc. (NVIDIA)';
    const webglRenderer = Random.pick([
      'ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 Direct3D11 vs_5_0 ps_5_0)',
      'ANGLE (NVIDIA, NVIDIA GeForce GTX 1080 Direct3D11 vs_5_0 ps_5_0)',
      'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0)',
      'ANGLE (AMD, AMD Radeon RX 6800 XT Direct3D11 vs_5_0 ps_5_0)',
    ]);
    
    return {
      platform,
      userAgent,
      viewport,
      timezone,
      locale,
      webglVendor,
      webglRenderer,
      hardwareConcurrency: Random.pick([4, 8, 12, 16]),
      deviceMemory: Random.pick([4, 8, 16, 32]),
    };
  }

  /**
   * Build Chrome launch arguments
   */
  _buildLaunchArgs(config, profile) {
    const args = [
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-blink-features=AutomationControlled',
      '--disable-hang-monitor',
      '--disable-ipc-flooding-protection',
      '--disable-popup-blocking',
      '--disable-prompt-on-repost',
      '--disable-sync',
      '--disable-translate',
      `--window-size=${profile.viewport.width},${profile.viewport.height}`,
      '--password-store=basic',
      '--use-mock-keychain',
      '--no-first-run',
      '--no-default-browser-check',
    ];
    
    if (config.args && Array.isArray(config.args)) {
      args.push(...config.args);
    }
    
    return [...new Set(args)];
  }

  /**
   * Configure page with stealth settings
   */
  async _configurePage(page) {
    const profile = this._profile;
    const config = Config.get();
    
    await page.setViewport({
      width: profile.viewport.width,
      height: profile.viewport.height,
      deviceScaleFactor: 1,
      hasTouch: false,
      isLandscape: true,
      isMobile: false,
    });
    
    await page.setUserAgent(profile.userAgent);
    
    await page.setExtraHTTPHeaders({
      'Accept-Language': `${profile.locale},en;q=0.9`,
    });
    
    await page.emulateTimezone(profile.timezone);
    
    // Override navigator properties for anti-detection
    await page.evaluateOnNewDocument((profile) => {
      Object.defineProperty(navigator, 'hardwareConcurrency', {
        get: () => profile.hardwareConcurrency,
      });
      
      Object.defineProperty(navigator, 'deviceMemory', {
        get: () => profile.deviceMemory,
      });
      
      Object.defineProperty(navigator, 'languages', {
        get: () => [profile.locale, 'en'],
      });
      
      const platformMap = {
        windows: 'Win32',
        mac: 'MacIntel',
        linux: 'Linux x86_64',
      };
      Object.defineProperty(navigator, 'platform', {
        get: () => platformMap[profile.platform] || 'Win32',
      });
      
      // WebGL spoofing
      const getParameterProxyHandler = {
        apply: function(target, thisArg, args) {
          const param = args[0];
          if (param === 37445) return profile.webglVendor;
          if (param === 37446) return profile.webglRenderer;
          return Reflect.apply(target, thisArg, args);
        }
      };
      
      const origGetParam = WebGLRenderingContext.prototype.getParameter;
      WebGLRenderingContext.prototype.getParameter = new Proxy(origGetParam, getParameterProxyHandler);
      
      if (typeof WebGL2RenderingContext !== 'undefined') {
        const origGetParam2 = WebGL2RenderingContext.prototype.getParameter;
        WebGL2RenderingContext.prototype.getParameter = new Proxy(origGetParam2, getParameterProxyHandler);
      }
      
      // Chrome object
      window.chrome = {
        runtime: {},
        loadTimes: () => ({
          commitLoadTime: Date.now() / 1000,
          connectionInfo: 'http/1.1',
          finishDocumentLoadTime: Date.now() / 1000,
          finishLoadTime: Date.now() / 1000,
          firstPaintAfterLoadTime: 0,
          firstPaintTime: Date.now() / 1000,
          navigationType: 'Other',
          npnNegotiatedProtocol: 'unknown',
          requestTime: Date.now() / 1000,
          startLoadTime: Date.now() / 1000,
          wasAlternateProtocolAvailable: false,
          wasFetchedViaSpdy: false,
          wasNpnNegotiated: false,
        }),
        csi: () => ({
          onloadT: Date.now(),
          startE: Date.now(),
          pageT: Math.random() * 1000,
        }),
        app: {
          isInstalled: false,
          InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
          RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
        },
      };
      
      // Plugins
      Object.defineProperty(navigator, 'plugins', {
        get: () => {
          const plugins = [
            { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
            { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
            { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
          ];
          const arr = Object.create(PluginArray.prototype);
          plugins.forEach((p, i) => {
            const plugin = Object.create(Plugin.prototype);
            Object.defineProperties(plugin, {
              name: { value: p.name }, filename: { value: p.filename },
              description: { value: p.description }, length: { value: 0 },
            });
            arr[i] = plugin;
          });
          Object.defineProperty(arr, 'length', { value: plugins.length });
          arr.item = (i) => arr[i] || null;
          arr.namedItem = (n) => plugins.find(p => p.name === n) || null;
          arr.refresh = () => {};
          return arr;
        },
      });
    }, profile);
    
    page.setDefaultNavigationTimeout(config.timing.navigationTimeout * 1000);
    page.setDefaultTimeout(config.timing.pageTimeout * 1000);
    
    page.on('dialog', async (dialog) => {
      log.debug('Dialog detected', { type: dialog.type(), message: dialog.message() });
      await dialog.dismiss();
    });
    
    if (config.logging.level === 'debug' || config.logging.level === 'trace') {
      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          log.debug('Page console error', { text: msg.text() });
        }
      });
    }
    
    return page;
  }

  /**
   * Resolve profile path
   */
  _resolveProfilePath(configPath) {
    if (!configPath) {
      return Paths.resolve('appData', 'profiles', 'default');
    }
    
    if (configPath.startsWith('/') || /^[A-Z]:\\/.test(configPath)) {
      return configPath;
    }
    
    return pathResolve(process.cwd(), configPath);
  }

  /**
   * Enhance error with helpful information
   */
  _enhanceError(error) {
    const enhanced = new Error(error.message);
    enhanced.stack = error.stack;
    enhanced.original = error;
    
    if (error.message.includes('ENOENT') || error.message.includes('No usable sandbox')) {
      enhanced.hint = 'Chrome executable not found. Install Chrome or set browser.executablePath in config.';
    } else if (error.message.includes('net::ERR_')) {
      enhanced.hint = 'Network error. Check your internet connection.';
    } else if (error.message.includes('Protocol error')) {
      enhanced.hint = 'Browser protocol error. The browser may have crashed.';
    } else if (error.message.includes('Target closed')) {
      enhanced.hint = 'Browser or page was closed unexpectedly.';
    } else if (error.message.includes('sandbox')) {
      enhanced.hint = 'Sandbox error. Try adding --no-sandbox to browser.args in config.';
    }
    
    return enhanced;
  }

  /**
   * Navigate to URL with retry logic
   */
  async goto(url, options = {}) {
    const maxRetries = options.retries || 3;
    const config = Config.get();
    
    let lastError;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        log.debug('Navigating', { url, attempt });
        
        const response = await this.page.goto(url, {
          waitUntil: options.waitUntil || 'domcontentloaded',
          timeout: (options.timeout || config.timing.navigationTimeout) * 1000,
        });
        
        const status = response?.status() || 0;
        
        if (status >= 400) {
          log.warn('HTTP error', { url, status });
          this.emit('httpError', { url, status });
        }
        
        this.emit('navigated', { url, status, attempt });
        return response;
        
      } catch (error) {
        lastError = error;
        log.warn('Navigation failed', { url, attempt, error: error.message });
        
        if (attempt < maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }
    
    this.emit('navigationFailed', { url, error: lastError });
    throw lastError;
  }

  /**
   * Create new page
   */
  async newPage() {
    if (!this.browser) throw new Error('Browser not launched');
    const page = await this.browser.newPage();
    await this._configurePage(page);
    return page;
  }

  getPage() { return this.page; }
  getBrowser() { return this.browser; }
  isConnected() { return this._isConnected && this.browser?.isConnected(); }
  getProfile() { return this._profile; }

  /**
   * Take screenshot
   */
  async screenshot(options = {}) {
    if (!this.page) throw new Error('No active page');
    return await this.page.screenshot({
      type: options.type || 'png',
      fullPage: options.fullPage || false,
      path: options.path,
    });
  }

  /**
   * Get page metrics
   */
  async getMetrics() {
    if (!this.page) return null;
    
    const metrics = await this.page.metrics();
    const performance = await this.page.evaluate(() => {
      const t = performance.timing;
      return {
        loadTime: t.loadEventEnd - t.navigationStart,
        domContentLoaded: t.domContentLoadedEventEnd - t.navigationStart,
        firstPaint: performance.getEntriesByType('paint')[0]?.startTime || 0,
      };
    });
    
    return { ...metrics, ...performance };
  }

  /**
   * Close browser
   */
  async close() {
    if (this.browser) {
      log.info('Closing browser');
      try {
        await this.browser.close();
      } catch (error) {
        log.warn('Error closing browser', { error: error.message });
      }
      this.browser = null;
      this.page = null;
      this._isConnected = false;
      this.emit('closed');
    }
  }

  /**
   * Restart browser
   */
  async restart() {
    await this.close();
    return await this.launch();
  }
}

// Singleton factory
let browserInstance = null;

export function getBrowser(options = {}) {
  if (!browserInstance) {
    browserInstance = new BrowserController(options);
  }
  return browserInstance;
}

export function createBrowser(options = {}) {
  return new BrowserController(options);
}
