/**
 * @fileoverview Page actions for natural, human-like browser interactions
 */

import { Random, Distribution, Timing, Behavior } from '../utils/random.js';
import { Config } from '../utils/config.js';
import { createLogger } from '../utils/logger.js';
import { Sites } from '../utils/sites.js';

const log = createLogger({ name: 'actions' });

/**
 * Page Actions Class - handles all interactions with a page
 */
export class PageActions {
  constructor(page, options = {}) {
    this.page = page;
    this.options = options;
    this._sessionProfile = Behavior.generateSessionProfile();
  }

  /**
   * Get session behavior profile
   */
  getSessionProfile() {
    return this._sessionProfile;
  }

  /**
   * Wait with human-like timing
   */
  async wait(minMs, maxMs) {
    const delay = Timing.humanDelay(minMs, maxMs);
    log.trace('Waiting', { delay: `${delay}ms` });
    await Timing.sleep(delay);
    return delay;
  }

  /**
   * Perform natural scrolling
   */
  async scroll(options = {}) {
    const config = Config.get();
    if (!config.behavior.scroll) return { scrolled: false };

    try {
      const pageInfo = await this.page.evaluate(() => ({
        scrollHeight: document.documentElement.scrollHeight,
        viewportHeight: window.innerHeight,
        currentScroll: window.scrollY,
      }));

      if (pageInfo.scrollHeight <= pageInfo.viewportHeight) {
        log.debug('Page too short to scroll');
        return { scrolled: false, reason: 'page-too-short' };
      }

      const scrollPattern = Behavior.scrollPattern(
        pageInfo.scrollHeight,
        pageInfo.viewportHeight
      );

      log.debug('Executing scroll pattern', { actions: scrollPattern.length });

      let totalScrolled = 0;

      for (const action of scrollPattern) {
        if (action.type === 'scroll' || action.type === 'scrollToTop') {
          await this.page.evaluate(
            async ({ to, duration }) => {
              const start = window.scrollY;
              const distance = to - start;
              const steps = Math.ceil(duration / 16);
              
              for (let i = 0; i <= steps; i++) {
                const progress = i / steps;
                // Ease out cubic
                const eased = 1 - Math.pow(1 - progress, 3);
                window.scrollTo(0, start + distance * eased);
                await new Promise(r => setTimeout(r, 16));
              }
            },
            { to: action.to, duration: action.duration }
          );

          totalScrolled += Math.abs(action.to - action.from);

          // Pause after scroll
          await Timing.sleep(action.pause);
        }
      }

      log.debug('Scroll complete', { totalScrolled });
      return { scrolled: true, totalScrolled, actions: scrollPattern.length };

    } catch (error) {
      log.warn('Scroll failed', { error: error.message });
      return { scrolled: false, error: error.message };
    }
  }

  /**
   * Move mouse naturally
   */
  async moveMouse(options = {}) {
    const config = Config.get();
    if (!config.behavior.mouseMoves) return { moved: false };

    try {
      const viewport = await this.page.viewport();
      if (!viewport) return { moved: false };

      const moves = Random.int(3, 8);
      let lastX = Random.int(100, viewport.width - 100);
      let lastY = Random.int(100, viewport.height - 100);

      log.debug('Starting mouse movements', { moves });

      for (let i = 0; i < moves; i++) {
        const targetX = Random.int(50, viewport.width - 50);
        const targetY = Random.int(50, viewport.height - 50);

        const path = Behavior.mousePath(lastX, lastY, targetX, targetY);

        for (const point of path) {
          await this.page.mouse.move(point.x, point.y);
          await Timing.sleep(point.delay);
        }

        lastX = targetX;
        lastY = targetY;

        // Random pause between movements
        await Timing.sleep(Random.int(100, 500));
      }

      return { moved: true, moves };

    } catch (error) {
      log.warn('Mouse movement failed', { error: error.message });
      return { moved: false, error: error.message };
    }
  }

  /**
   * Click on an element naturally
   */
  async click(selector, options = {}) {
    try {
      const element = await this.page.$(selector);
      if (!element) {
        return { clicked: false, reason: 'element-not-found' };
      }

      const box = await element.boundingBox();
      if (!box) {
        return { clicked: false, reason: 'element-not-visible' };
      }

      // Calculate click position with slight randomness
      const x = box.x + box.width * Random.float(0.3, 0.7);
      const y = box.y + box.height * Random.float(0.3, 0.7);

      // Move to element first
      await this.page.mouse.move(x, y, { steps: Random.int(5, 15) });
      
      // Small pause before click
      await Timing.sleep(Random.int(50, 200));

      // Click with random delay
      await this.page.mouse.down();
      await Timing.sleep(Random.int(50, 150));
      await this.page.mouse.up();

      log.debug('Clicked element', { selector, x: Math.round(x), y: Math.round(y) });
      return { clicked: true, x, y };

    } catch (error) {
      log.warn('Click failed', { selector, error: error.message });
      return { clicked: false, error: error.message };
    }
  }

  /**
   * Click a random internal link
   */
  async clickRandomLink(options = {}) {
    const config = Config.get();
    if (!config.behavior.clickLinks) return { clicked: false };

    try {
      const currentUrl = new URL(this.page.url());
      
      // Find clickable links
      const links = await this.page.evaluate((currentHost) => {
        const anchors = Array.from(document.querySelectorAll('a[href]'));
        
        return anchors
          .map((a, index) => {
            const rect = a.getBoundingClientRect();
            const href = a.href;
            
            // Skip invisible, tiny, or off-screen elements
            if (rect.width < 10 || rect.height < 10) return null;
            if (rect.top < 0 || rect.top > window.innerHeight) return null;
            
            let isInternal = false;
            let isNavigation = false;
            let isAd = false;
            let isSocial = false;
            
            try {
              const url = new URL(href);
              isInternal = url.hostname === currentHost;
              isNavigation = a.closest('nav, header, [role="navigation"]') !== null;
              isAd = /ad|sponsor|promo|click|track/i.test(href) || 
                     a.closest('[class*="ad"], [id*="ad"]') !== null;
              isSocial = /facebook|twitter|linkedin|share|social/i.test(href);
            } catch {
              return null;
            }
            
            if (!isInternal) return null;
            if (isAd) return null;
            
            return {
              index,
              href,
              text: a.textContent?.trim().substring(0, 50) || '',
              isNavigation,
              isSocial,
              isInternal,
              isAboveFold: rect.top < window.innerHeight,
              hasImage: a.querySelector('img') !== null,
              textLength: a.textContent?.trim().length || 0,
            };
          })
          .filter(Boolean);
      }, currentUrl.hostname);

      if (links.length === 0) {
        log.debug('No suitable links found');
        return { clicked: false, reason: 'no-links' };
      }

      // Filter and score links
      const scoredLinks = links
        .filter(link => Behavior.shouldClickLink(link))
        .map(link => ({
          ...link,
          score: Random.float(0, 1),
        }))
        .sort((a, b) => b.score - a.score);

      if (scoredLinks.length === 0) {
        log.debug('No links passed behavior filter');
        return { clicked: false, reason: 'filtered-out' };
      }

      // Pick a link (weighted towards higher scored)
      const selectedLink = scoredLinks[0];
      
      // Click the link
      const linkSelector = `a[href="${selectedLink.href}"]`;
      
      log.debug('Clicking link', { 
        text: selectedLink.text.substring(0, 30), 
        href: selectedLink.href.substring(0, 50),
      });

      // Navigate by clicking
      const [response] = await Promise.all([
        this.page.waitForNavigation({ 
          waitUntil: 'domcontentloaded', 
          timeout: 30000 
        }).catch(() => null),
        this.page.evaluate((href) => {
          const link = document.querySelector(`a[href="${href}"]`);
          if (link) link.click();
        }, selectedLink.href),
      ]);

      return { 
        clicked: true, 
        href: selectedLink.href, 
        text: selectedLink.text,
        navigated: !!response,
      };

    } catch (error) {
      log.warn('Click random link failed', { error: error.message });
      return { clicked: false, error: error.message };
    }
  }

  /**
   * Type text naturally
   */
  async type(selector, text, options = {}) {
    try {
      const element = await this.page.$(selector);
      if (!element) {
        return { typed: false, reason: 'element-not-found' };
      }

      // Click to focus
      await this.click(selector);
      await Timing.sleep(Random.int(100, 300));

      // Clear existing content if requested
      if (options.clear) {
        await this.page.keyboard.down('Control');
        await this.page.keyboard.press('a');
        await this.page.keyboard.up('Control');
        await Timing.sleep(Random.int(50, 150));
        await this.page.keyboard.press('Backspace');
        await Timing.sleep(Random.int(100, 300));
      }

      // Type character by character with natural delays
      for (const char of text) {
        await this.page.keyboard.type(char);
        await Timing.sleep(Timing.typingDelay());
      }

      log.debug('Typed text', { selector, length: text.length });
      return { typed: true, length: text.length };

    } catch (error) {
      log.warn('Type failed', { selector, error: error.message });
      return { typed: false, error: error.message };
    }
  }

  /**
   * Perform a search on a search engine
   */
  async performSearch(query = null) {
    try {
      const searchInfo = Sites.getSearchUrl();
      const searchQuery = query || searchInfo.query;
      
      log.info('Performing search', { engine: searchInfo.engine, query: searchQuery });

      // Navigate to search URL
      await this.page.goto(searchInfo.url, { 
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });

      // Wait for page load
      await Timing.sleep(Random.int(1000, 3000));

      // Scroll through results
      await this.scroll();

      // Maybe click a result
      if (Random.bool(0.4)) {
        const resultClicked = await this._clickSearchResult();
        return { 
          searched: true, 
          engine: searchInfo.engine, 
          query: searchQuery,
          clickedResult: resultClicked,
        };
      }

      return { searched: true, engine: searchInfo.engine, query: searchQuery };

    } catch (error) {
      log.warn('Search failed', { error: error.message });
      return { searched: false, error: error.message };
    }
  }

  /**
   * Click a search result
   */
  async _clickSearchResult() {
    try {
      // Common search result selectors
      const selectors = [
        'h3 a',                    // Google
        '.b_algo h2 a',            // Bing
        '.result__a',              // DuckDuckGo
        '[data-testid="result"] a', // Various
        '.g a[href^="http"]',      // Google alternative
      ];

      for (const selector of selectors) {
        const results = await this.page.$$(selector);
        
        if (results.length > 0) {
          // Pick from top 5 results
          const index = Random.int(0, Math.min(4, results.length - 1));
          const result = results[index];
          
          const href = await result.evaluate(el => el.href);
          
          // Skip ads and tracking URLs
          if (/googleadservices|bing\.com\/aclick|ad\./i.test(href)) {
            continue;
          }

          log.debug('Clicking search result', { index, href: href.substring(0, 50) });

          await Promise.all([
            this.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => null),
            result.click(),
          ]);

          return { clicked: true, href };
        }
      }

      return { clicked: false, reason: 'no-results-found' };

    } catch (error) {
      log.debug('Click search result failed', { error: error.message });
      return { clicked: false, error: error.message };
    }
  }

  /**
   * Stay on page with natural behavior
   */
  async stayOnPage(contentType = 'article') {
    const config = Config.get();
    const profile = this._sessionProfile;
    
    // Calculate stay duration based on content type and session profile
    let baseDuration = Timing.pageStayDuration(contentType);
    
    // Adjust based on session profile
    if (profile.attentionSpan === 'short') {
      baseDuration *= 0.6;
    } else if (profile.attentionSpan === 'long') {
      baseDuration *= 1.5;
    }
    
    baseDuration *= profile.speedMultiplier;
    
    // Clamp to config bounds
    const duration = Math.max(
      config.timing.minStay * 1000,
      Math.min(config.timing.maxStay * 1000, baseDuration)
    );

    log.debug('Staying on page', { 
      contentType, 
      duration: `${(duration / 1000).toFixed(1)}s`,
      profile: profile.userType,
    });

    const startTime = Date.now();
    const actions = [];

    // Perform random actions while on page
    while (Date.now() - startTime < duration) {
      const action = Random.weighted([
        { value: 'scroll', weight: 40 },
        { value: 'mouse', weight: 20 },
        { value: 'wait', weight: 35 },
        { value: 'click', weight: 5 },
      ]);

      switch (action) {
        case 'scroll':
          const scrollResult = await this.scroll();
          if (scrollResult.scrolled) actions.push({ type: 'scroll', ...scrollResult });
          break;
          
        case 'mouse':
          const mouseResult = await this.moveMouse();
          if (mouseResult.moved) actions.push({ type: 'mouse', ...mouseResult });
          break;
          
        case 'click':
          // Rarely click something on the page
          if (Random.bool(0.2)) {
            const clickResult = await this.clickRandomLink();
            if (clickResult.clicked) {
              actions.push({ type: 'click', ...clickResult });
              // If we navigated, we're done with this page
              if (clickResult.navigated) {
                return { duration: Date.now() - startTime, actions, navigatedAway: true };
              }
            }
          }
          break;
          
        case 'wait':
        default:
          await Timing.sleep(Random.int(1000, 5000));
          break;
      }

      // Small gap between actions
      await Timing.sleep(Random.int(500, 2000));
    }

    return { 
      duration: Date.now() - startTime, 
      actions,
      navigatedAway: false,
    };
  }

  /**
   * Extract page information
   */
  async getPageInfo() {
    try {
      return await this.page.evaluate(() => ({
        url: window.location.href,
        title: document.title,
        domain: window.location.hostname,
        path: window.location.pathname,
        scrollHeight: document.documentElement.scrollHeight,
        viewportHeight: window.innerHeight,
        linkCount: document.querySelectorAll('a').length,
        imageCount: document.querySelectorAll('img').length,
        hasVideo: document.querySelectorAll('video, iframe[src*="youtube"], iframe[src*="vimeo"]').length > 0,
        hasForm: document.querySelectorAll('form').length > 0,
        textLength: document.body?.innerText?.length || 0,
      }));
    } catch (error) {
      log.warn('Failed to get page info', { error: error.message });
      return null;
    }
  }

  /**
   * Check if page has captcha
   */
  async hasCaptcha() {
    try {
      return await this.page.evaluate(() => {
        const captchaIndicators = [
          'iframe[src*="recaptcha"]',
          'iframe[src*="hcaptcha"]',
          '.g-recaptcha',
          '.h-captcha',
          '[data-sitekey]',
          '#captcha',
          '.captcha',
        ];
        
        return captchaIndicators.some(sel => document.querySelector(sel) !== null);
      });
    } catch {
      return false;
    }
  }

  /**
   * Handle common popups/modals
   */
  async dismissPopups() {
    try {
      const dismissed = await this.page.evaluate(() => {
        const closeSelectors = [
          '[aria-label="Close"]',
          '[aria-label="Dismiss"]',
          '.modal-close',
          '.popup-close',
          '.close-button',
          'button[class*="close"]',
          '[data-dismiss="modal"]',
          '.cookie-consent button',
          '#onetrust-accept-btn-handler',
          '.cc-dismiss',
          '.cc-btn',
        ];
        
        let count = 0;
        for (const sel of closeSelectors) {
          const btn = document.querySelector(sel);
          if (btn && btn.offsetParent !== null) {
            btn.click();
            count++;
          }
        }
        
        // Also try pressing Escape
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27 }));
        
        return count;
      });
      
      if (dismissed > 0) {
        log.debug('Dismissed popups', { count: dismissed });
      }
      
      return { dismissed };
      
    } catch (error) {
      return { dismissed: 0, error: error.message };
    }
  }

  /**
   * Take a break (simulate user doing something else)
   */
  async takeBreak(minSeconds, maxSeconds) {
    const duration = Random.int(minSeconds * 1000, maxSeconds * 1000);
    log.info('Taking a break', { duration: `${(duration / 1000).toFixed(0)}s` });
    
    // Could minimize window or switch tabs in a real scenario
    await Timing.sleep(duration);
    
    return { duration };
  }
}

/**
 * Create PageActions instance for a page
 */
export function createActions(page, options = {}) {
  return new PageActions(page, options);
}
