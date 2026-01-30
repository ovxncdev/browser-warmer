/**
 * @fileoverview Dolphin Anty session - warming session for Dolphin profiles
 */

import { EventEmitter } from 'events';
import { Config } from '../utils/config.js';
import { Sites } from '../utils/sites.js';
import { createLogger } from '../utils/logger.js';
import { Random, Timing } from '../utils/random.js';
import { createDolphinAdapter, findDolphinEndpoint, scanForDolphinProfiles } from './dolphin.js';
import { PageActions, createActions } from '../core/actions.js';
import { SessionState } from '../core/session.js';

const log = createLogger({ name: 'dolphin-session' });

/**
 * Dolphin Session Manager
 * Like regular SessionManager but connects to Dolphin Anty profiles
 */
export class DolphinSessionManager extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = options;
    this.adapter = null;
    this.actions = null;
    this.state = SessionState.IDLE;
    
    // Session statistics
    this.stats = {
      startTime: null,
      endTime: null,
      sitesVisited: 0,
      sitesSuccessful: 0,
      sitesFailed: 0,
      searchesPerformed: 0,
      linksClicked: 0,
      totalScrollDistance: 0,
      pagesViewed: 0,
      errors: [],
      visitedUrls: [],
      profileId: null,
    };
    
    this._shouldStop = false;
    this._isPaused = false;
    this._pausePromise = null;
    this._pauseResolve = null;
    this._currentSite = null;
    this._siteQueue = [];
  }

  /**
   * Initialize session - connect to Dolphin profile
   */
  async initialize() {
    log.info('Initializing Dolphin session...');
    
    this.state = SessionState.STARTING;
    this.emit('stateChange', this.state);
    
    try {
      // Load sites configuration
      await Sites.load(this.options.sitesConfig);
      
      // Create Dolphin adapter
      this.adapter = createDolphinAdapter({
        apiPort: this.options.apiPort || 3001,
        apiHost: this.options.apiHost || 'localhost',
        token: this.options.token || process.env.DOLPHIN_TOKEN,
      });
      
      // Connect based on provided options
      if (this.options.wsEndpoint) {
        // Direct WebSocket URL provided
        log.info('Connecting via WebSocket URL');
        await this.adapter.connectToRunningProfile(this.options.wsEndpoint);
        
      } else if (this.options.port) {
        // Debug port provided - find WebSocket endpoint
        log.info('Connecting via debug port', { port: this.options.port });
        const wsEndpoint = await findDolphinEndpoint(this.options.port, this.options.host);
        await this.adapter.connectToRunningProfile(wsEndpoint);
        
      } else if (this.options.profileId) {
        // Profile ID provided - use API to start
        log.info('Starting profile via Dolphin API', { profileId: this.options.profileId });
        await this.adapter.startProfile(this.options.profileId);
        this.stats.profileId = this.options.profileId;
        
      } else {
        throw new Error(
          'Must provide one of: wsEndpoint, port, or profileId. ' +
          'See --help for usage.'
        );
      }
      
      // Set up disconnect handler
      this.adapter.on('disconnected', () => {
        if (this.state === SessionState.RUNNING) {
          log.error('Dolphin browser disconnected unexpectedly');
          this._handleError(new Error('Browser disconnected'));
        }
      });
      
      // Create actions handler
      this.actions = createActions(this.adapter.getPage());
      
      const connInfo = this.adapter.getConnectionInfo();
      log.info('Dolphin session initialized', {
        profileId: connInfo.profileId,
        connected: connInfo.isConnected,
      });
      
      this.emit('initialized');
      
      return true;
      
    } catch (error) {
      this.state = SessionState.ERROR;
      this.emit('stateChange', this.state);
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Start the warming session
   */
  async start() {
    if (this.state !== SessionState.STARTING && this.state !== SessionState.IDLE) {
      if (this.state === SessionState.IDLE) {
        await this.initialize();
      } else {
        throw new Error(`Cannot start session in state: ${this.state}`);
      }
    }
    
    const config = Config.get();
    
    // Prepare site queue
    this._siteQueue = Sites.getSites(config.sites.categories, {
      custom: config.sites.custom,
      exclude: config.sites.exclude,
      maxSites: config.sites.maxSites,
      shuffle: config.sites.shuffleSites,
    });
    
    if (this._siteQueue.length === 0) {
      throw new Error('No sites to visit. Check your configuration.');
    }
    
    log.info('Starting Dolphin session', {
      sites: this._siteQueue.length,
      categories: config.sites.categories.join(', '),
    });
    
    this.state = SessionState.RUNNING;
    this.stats.startTime = new Date();
    this.emit('stateChange', this.state);
    this.emit('started', { siteCount: this._siteQueue.length });
    
    try {
      // Perform searches if enabled
      if (config.behavior.searches && config.behavior.searchCount > 0) {
        await this._performSearches(config.behavior.searchCount);
      }
      
      // Visit sites
      await this._visitSites();
      
      // Complete
      this.stats.endTime = new Date();
      this.state = SessionState.STOPPED;
      this.emit('stateChange', this.state);
      this.emit('completed', this.getStats());
      
    } catch (error) {
      this._handleError(error);
      throw error;
    }
  }

  /**
   * Perform search warm-up
   */
  async _performSearches(count) {
    log.info('Performing search warm-up', { count });
    
    for (let i = 0; i < count; i++) {
      if (this._shouldStop) break;
      await this._checkPaused();
      
      try {
        const result = await this.actions.performSearch();
        
        if (result.searched) {
          this.stats.searchesPerformed++;
          this.emit('searchPerformed', result);
          await this.actions.stayOnPage('search');
        }
        
        if (i < count - 1) {
          await this._waitBetweenSites();
        }
        
      } catch (error) {
        log.warn('Search failed', { error: error.message });
        this.stats.errors.push({ type: 'search', error: error.message, time: new Date() });
      }
    }
  }

  /**
   * Visit all sites in queue
   */
  async _visitSites() {
    const config = Config.get();
    const totalSites = this._siteQueue.length;
    
    for (let i = 0; i < this._siteQueue.length; i++) {
      if (this._shouldStop) {
        log.info('Session stop requested');
        break;
      }
      
      await this._checkPaused();
      
      // Check limits
      if (config.session.maxPages > 0 && this.stats.pagesViewed >= config.session.maxPages) {
        log.info('Max pages limit reached');
        break;
      }
      
      if (config.session.maxDuration > 0) {
        const elapsed = (Date.now() - this.stats.startTime.getTime()) / 1000 / 60;
        if (elapsed >= config.session.maxDuration) {
          log.info('Max duration reached');
          break;
        }
      }
      
      const site = this._siteQueue[i];
      this._currentSite = site;
      
      await this._visitSite(site, i + 1, totalSites);
      
      if (i < this._siteQueue.length - 1 && !this._shouldStop) {
        await this._waitBetweenSites();
      }
    }
  }

  /**
   * Visit a single site
   */
  async _visitSite(url, current, total) {
    const startTime = Date.now();
    
    log.info('Visiting site', { 
      url: url.substring(0, 60), 
      progress: `${current}/${total}`,
    });
    
    this.stats.sitesVisited++;
    this.emit('siteStart', { url, current, total });
    
    try {
      await this.adapter.goto(url);
      this.stats.pagesViewed++;
      this.stats.visitedUrls.push(url);
      
      await this.actions.dismissPopups();
      
      const hasCaptcha = await this.actions.hasCaptcha();
      if (hasCaptcha) {
        log.warn('Captcha detected, skipping site', { url });
        this.stats.sitesFailed++;
        this.emit('captchaDetected', { url });
        return;
      }
      
      const contentType = Sites.getContentType(url);
      const stayResult = await this.actions.stayOnPage(contentType);
      
      if (stayResult.actions) {
        for (const action of stayResult.actions) {
          if (action.type === 'scroll' && action.totalScrolled) {
            this.stats.totalScrollDistance += action.totalScrolled;
          }
          if (action.type === 'click' && action.clicked) {
            this.stats.linksClicked++;
          }
        }
      }
      
      if (stayResult.navigatedAway) {
        this.stats.pagesViewed++;
      }
      
      const duration = Date.now() - startTime;
      this.stats.sitesSuccessful++;
      
      log.info('Site visit complete', { 
        url: url.substring(0, 40), 
        duration: `${(duration / 1000).toFixed(1)}s`,
      });
      
      this.emit('siteComplete', { url, duration, current, total });
      
    } catch (error) {
      const duration = Date.now() - startTime;
      this.stats.sitesFailed++;
      this.stats.errors.push({ 
        type: 'visit', 
        url, 
        error: error.message, 
        time: new Date(),
      });
      
      log.warn('Site visit failed', { 
        url: url.substring(0, 40), 
        error: error.message,
      });
      
      this.emit('siteFailed', { url, error: error.message, duration });
    }
  }

  /**
   * Wait between sites
   */
  async _waitBetweenSites() {
    const config = Config.get();
    const delay = Timing.betweenSitesDelay();
    
    const clampedDelay = Math.max(
      config.timing.minWait * 1000,
      Math.min(config.timing.maxWait * 1000, delay)
    );
    
    await Timing.sleep(clampedDelay);
    return clampedDelay;
  }

  /**
   * Check if paused
   */
  async _checkPaused() {
    if (this._isPaused) {
      log.info('Session paused, waiting...');
      await this._pausePromise;
      log.info('Session resumed');
    }
  }

  /**
   * Handle errors
   */
  _handleError(error) {
    this.state = SessionState.ERROR;
    this.stats.endTime = new Date();
    this.stats.errors.push({ type: 'fatal', error: error.message, time: new Date() });
    
    this.emit('stateChange', this.state);
    this.emit('error', error);
    
    log.error('Session error', { error: error.message });
  }

  /**
   * Pause session
   */
  pause() {
    if (this.state !== SessionState.RUNNING) return false;
    
    this._isPaused = true;
    this._pausePromise = new Promise(resolve => {
      this._pauseResolve = resolve;
    });
    
    this.state = SessionState.PAUSED;
    this.emit('stateChange', this.state);
    this.emit('paused');
    
    log.info('Session paused');
    return true;
  }

  /**
   * Resume session
   */
  resume() {
    if (this.state !== SessionState.PAUSED) return false;
    
    this._isPaused = false;
    if (this._pauseResolve) {
      this._pauseResolve();
      this._pauseResolve = null;
      this._pausePromise = null;
    }
    
    this.state = SessionState.RUNNING;
    this.emit('stateChange', this.state);
    this.emit('resumed');
    
    log.info('Session resumed');
    return true;
  }

  /**
   * Stop session
   */
  async stop(closeBrowser = false) {
    if (this.state === SessionState.STOPPED || this.state === SessionState.STOPPING) {
      return;
    }
    
    log.info('Stopping Dolphin session...');
    
    this._shouldStop = true;
    this.state = SessionState.STOPPING;
    this.emit('stateChange', this.state);
    
    if (this._isPaused) {
      this.resume();
    }
    
    // Disconnect (but don't close the browser by default)
    if (this.adapter) {
      if (closeBrowser && this.options.profileId) {
        // Only stop profile if we started it via API
        await this.adapter.close(true);
      } else {
        await this.adapter.disconnect();
      }
    }
    
    this.stats.endTime = new Date();
    this.state = SessionState.STOPPED;
    this.emit('stateChange', this.state);
    this.emit('stopped', this.getStats());
    
    log.info('Dolphin session stopped');
  }

  /**
   * Get statistics
   */
  getStats() {
    const now = new Date();
    const duration = this.stats.startTime 
      ? (this.stats.endTime || now).getTime() - this.stats.startTime.getTime()
      : 0;
    
    return {
      ...this.stats,
      duration,
      durationFormatted: this._formatDuration(duration),
      successRate: this.stats.sitesVisited > 0 
        ? ((this.stats.sitesSuccessful / this.stats.sitesVisited) * 100).toFixed(1) + '%'
        : '0%',
      state: this.state,
      currentSite: this._currentSite,
      remainingSites: this._siteQueue.length - this.stats.sitesVisited,
    };
  }

  /**
   * Format duration
   */
  _formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  getState() { return this.state; }
  isRunning() { return this.state === SessionState.RUNNING; }
  isPaused() { return this.state === SessionState.PAUSED; }
  
  async screenshot(options = {}) {
    const page = this.adapter?.getPage();
    if (!page) throw new Error('No active page');
    return await page.screenshot(options);
  }
}

/**
 * Create Dolphin session
 */
export function createDolphinSession(options = {}) {
  return new DolphinSessionManager(options);
}

// Re-export helpers
export { scanForDolphinProfiles, findDolphinEndpoint };
