/**
 * @fileoverview Session manager - orchestrates the entire browser warming session
 */

import { EventEmitter } from 'events';
import { Config } from '../utils/config.js';
import { Sites } from '../utils/sites.js';
import { createLogger } from '../utils/logger.js';
import { Random, Timing, Behavior } from '../utils/random.js';
import { BrowserController, createBrowser } from './browser.js';
import { PageActions, createActions } from './actions.js';

const log = createLogger({ name: 'session' });

/**
 * Session state enum
 */
export const SessionState = {
  IDLE: 'idle',
  STARTING: 'starting',
  RUNNING: 'running',
  PAUSED: 'paused',
  STOPPING: 'stopping',
  STOPPED: 'stopped',
  ERROR: 'error',
};

/**
 * Session Manager Class
 */
export class SessionManager extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = options;
    this.browser = null;
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
    };
    
    // Session control
    this._shouldStop = false;
    this._isPaused = false;
    this._pausePromise = null;
    this._pauseResolve = null;
    this._currentSite = null;
    this._siteQueue = [];
  }

  /**
   * Initialize the session
   */
  async initialize() {
    log.info('Initializing session...');
    
    this.state = SessionState.STARTING;
    this.emit('stateChange', this.state);
    
    try {
      // Load sites configuration
      await Sites.load(this.options.sitesConfig);
      
      // Create browser instance
      this.browser = createBrowser(this.options.browser);
      
      // Set up browser event handlers
      this.browser.on('disconnected', () => {
        if (this.state === SessionState.RUNNING) {
          log.error('Browser disconnected unexpectedly');
          this._handleError(new Error('Browser disconnected'));
        }
      });
      
      this.browser.on('navigated', ({ url, status }) => {
        this.emit('pageVisited', { url, status });
      });
      
      this.browser.on('navigationFailed', ({ url, error }) => {
        this.stats.errors.push({ type: 'navigation', url, error: error.message, time: new Date() });
      });
      
      // Launch browser
      await this.browser.launch();
      
      // Create actions handler
      this.actions = createActions(this.browser.getPage(), this.options.actions);
      
      log.info('Session initialized', {
        profile: this.browser.getProfile().userAgent.substring(0, 50) + '...',
        viewport: this.browser.getProfile().viewport,
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
    
    log.info('Starting session', {
      sites: this._siteQueue.length,
      categories: config.sites.categories.join(', '),
      searches: config.behavior.searches ? config.behavior.searchCount : 0,
    });
    
    this.state = SessionState.RUNNING;
    this.stats.startTime = new Date();
    this.emit('stateChange', this.state);
    this.emit('started', { siteCount: this._siteQueue.length });
    
    try {
      // Perform initial searches if enabled
      if (config.behavior.searches && config.behavior.searchCount > 0) {
        await this._performSearches(config.behavior.searchCount);
      }
      
      // Visit sites
      await this._visitSites();
      
      // Session complete
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
          
          // Stay on results page briefly
          await this.actions.stayOnPage('search');
        }
        
        // Wait between searches
        if (i < count - 1) {
          const delay = await this._waitBetweenSites();
          log.debug('Wait before next search', { delay: `${(delay / 1000).toFixed(1)}s` });
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
      
      // Check session limits
      if (config.session.maxPages > 0 && this.stats.pagesViewed >= config.session.maxPages) {
        log.info('Max pages limit reached', { limit: config.session.maxPages });
        break;
      }
      
      if (config.session.maxDuration > 0) {
        const elapsed = (Date.now() - this.stats.startTime.getTime()) / 1000 / 60;
        if (elapsed >= config.session.maxDuration) {
          log.info('Max duration reached', { minutes: elapsed.toFixed(1) });
          break;
        }
      }
      
      const site = this._siteQueue[i];
      this._currentSite = site;
      
      // Check for scheduled break
      if (config.session.breakInterval > 0) {
        const elapsed = (Date.now() - this.stats.startTime.getTime()) / 1000 / 60;
        const breaksDue = Math.floor(elapsed / config.session.breakInterval);
        const breaksTaken = Math.floor(this.stats.sitesVisited / 10); // Rough estimate
        
        if (breaksDue > breaksTaken && this.stats.sitesVisited > 0) {
          await this._takeBreak(config.session.breakDuration);
        }
      }
      
      // Visit the site
      await this._visitSite(site, i + 1, totalSites);
      
      // Wait between sites
      if (i < this._siteQueue.length - 1 && !this._shouldStop) {
        const delay = await this._waitBetweenSites();
        log.debug('Wait before next site', { delay: `${(delay / 1000).toFixed(1)}s` });
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
      // Navigate to site
      await this.browser.goto(url);
      this.stats.pagesViewed++;
      this.stats.visitedUrls.push(url);
      
      // Dismiss any popups
      await this.actions.dismissPopups();
      
      // Check for captcha
      const hasCaptcha = await this.actions.hasCaptcha();
      if (hasCaptcha) {
        log.warn('Captcha detected, skipping site', { url });
        this.stats.sitesFailed++;
        this.emit('captchaDetected', { url });
        return;
      }
      
      // Get page info for content type detection
      const pageInfo = await this.actions.getPageInfo();
      const contentType = Sites.getContentType(url);
      
      // Stay on page with natural behavior
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
      
      // Follow links if enabled and we navigated away
      if (stayResult.navigatedAway) {
        this.stats.pagesViewed++;
        await this._followLinks(1);
      }
      
      const duration = Date.now() - startTime;
      this.stats.sitesSuccessful++;
      
      log.info('Site visit complete', { 
        url: url.substring(0, 40), 
        duration: `${(duration / 1000).toFixed(1)}s`,
      });
      
      this.emit('siteComplete', { 
        url, 
        duration, 
        pageInfo,
        current, 
        total,
      });
      
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
        duration: `${(duration / 1000).toFixed(1)}s`,
      });
      
      this.emit('siteFailed', { url, error: error.message, duration });
    }
  }

  /**
   * Follow internal links
   */
  async _followLinks(depth) {
    const config = Config.get();
    
    if (depth >= config.behavior.maxDepth) {
      return;
    }
    
    if (!config.behavior.clickLinks) {
      return;
    }
    
    // Decide whether to follow more links
    const shouldFollow = Random.bool(0.3 / depth); // Less likely at deeper levels
    
    if (!shouldFollow) {
      return;
    }
    
    log.debug('Following links', { depth });
    
    // Get content type and stay on page
    const url = this.browser.getPage().url();
    const contentType = Sites.getContentType(url);
    
    const stayResult = await this.actions.stayOnPage(contentType);
    this.stats.pagesViewed++;
    
    if (stayResult.navigatedAway) {
      await this._followLinks(depth + 1);
    }
  }

  /**
   * Wait between sites with natural timing
   */
  async _waitBetweenSites() {
    const config = Config.get();
    const delay = Timing.betweenSitesDelay();
    
    // Clamp to config bounds
    const clampedDelay = Math.max(
      config.timing.minWait * 1000,
      Math.min(config.timing.maxWait * 1000, delay)
    );
    
    await Timing.sleep(clampedDelay);
    return clampedDelay;
  }

  /**
   * Take a break
   */
  async _takeBreak(durationConfig) {
    const duration = Random.int(durationConfig.min * 1000, durationConfig.max * 1000);
    
    log.info('Taking a break', { duration: `${(duration / 1000 / 60).toFixed(1)} minutes` });
    this.emit('breakStart', { duration });
    
    await Timing.sleep(duration);
    
    log.info('Break complete, resuming');
    this.emit('breakEnd');
  }

  /**
   * Check if paused and wait
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
    this.stats.errors.push({ 
      type: 'fatal', 
      error: error.message, 
      time: new Date(),
    });
    
    this.emit('stateChange', this.state);
    this.emit('error', error);
    
    log.error('Session error', { error: error.message });
  }

  /**
   * Pause the session
   */
  pause() {
    if (this.state !== SessionState.RUNNING) {
      return false;
    }
    
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
   * Resume the session
   */
  resume() {
    if (this.state !== SessionState.PAUSED) {
      return false;
    }
    
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
   * Stop the session
   */
  async stop() {
    if (this.state === SessionState.STOPPED || this.state === SessionState.STOPPING) {
      return;
    }
    
    log.info('Stopping session...');
    
    this._shouldStop = true;
    this.state = SessionState.STOPPING;
    this.emit('stateChange', this.state);
    
    // If paused, resume to allow stopping
    if (this._isPaused) {
      this.resume();
    }
    
    // Close browser
    if (this.browser) {
      await this.browser.close();
    }
    
    this.stats.endTime = new Date();
    this.state = SessionState.STOPPED;
    this.emit('stateChange', this.state);
    this.emit('stopped', this.getStats());
    
    log.info('Session stopped');
  }

  /**
   * Get current session statistics
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

  /**
   * Get current state
   */
  getState() {
    return this.state;
  }

  /**
   * Check if running
   */
  isRunning() {
    return this.state === SessionState.RUNNING;
  }

  /**
   * Check if paused
   */
  isPaused() {
    return this.state === SessionState.PAUSED;
  }

  /**
   * Get browser profile
   */
  getBrowserProfile() {
    return this.browser?.getProfile();
  }

  /**
   * Take screenshot
   */
  async screenshot(options = {}) {
    if (!this.browser) {
      throw new Error('Browser not initialized');
    }
    return await this.browser.screenshot(options);
  }
}

/**
 * Create a new session
 */
export function createSession(options = {}) {
  return new SessionManager(options);
}
