/**
 * @fileoverview Sites configuration loader - finds and loads sites from multiple locations
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { Paths } from './paths.js';
import { createLogger } from './logger.js';
import { Random } from './random.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const log = createLogger({ name: 'sites' });

/**
 * Default sites (fallback if no config found)
 */
const FALLBACK_SITES = {
  categories: {
    general: [
      'https://www.google.com',
      'https://www.youtube.com',
      'https://www.wikipedia.org',
      'https://www.amazon.com',
      'https://www.reddit.com',
    ],
  },
  searchEngines: {
    google: { url: 'https://www.google.com/search?q=', weight: 100 },
  },
  searchTerms: {
    general: ['weather today', 'news', 'how to'],
  },
};

/**
 * Sites Manager Class
 */
class SitesManager {
  constructor() {
    this._sites = null;
    this._loadedFrom = null;
  }

  /**
   * Get search locations in priority order
   * Priority: CLI specified > CWD > App data > Package directory
   */
  getSearchLocations() {
    const locations = [];
    
    // 1. Current working directory (highest priority for user overrides)
    locations.push(join(process.cwd(), 'sites.yaml'));
    locations.push(join(process.cwd(), 'sites.yml'));
    locations.push(join(process.cwd(), 'sites.json'));
    locations.push(join(process.cwd(), '.browser-warmer', 'sites.yaml'));
    
    // 2. App data directory (persistent user config)
    try {
      const appData = Paths.get('appData');
      if (appData) {
        locations.push(join(appData, 'sites.yaml'));
        locations.push(join(appData, 'config', 'sites.yaml'));
      }
    } catch {
      // Paths not initialized yet, skip
    }
    
    // 3. Home directory
    const home = process.env.HOME || process.env.USERPROFILE;
    if (home) {
      locations.push(join(home, '.browser-warmer', 'sites.yaml'));
      locations.push(join(home, '.config', 'browser-warmer', 'sites.yaml'));
    }
    
    // 4. Package directory (bundled default)
    locations.push(join(__dirname, '..', '..', 'sites.yaml'));
    locations.push(join(__dirname, '..', '..', 'config', 'sites.yaml'));
    
    // 5. Relative to script (for global installs)
    locations.push(join(dirname(process.argv[1] || ''), 'sites.yaml'));
    locations.push(join(dirname(process.argv[1] || ''), '..', 'sites.yaml'));
    
    return locations.filter(Boolean);
  }

  /**
   * Load sites configuration
   */
  async load(customPath = null) {
    // If custom path specified, try that first
    if (customPath) {
      if (existsSync(customPath)) {
        return this._loadFromFile(customPath);
      }
      log.warn('Specified sites config not found', { path: customPath });
    }
    
    // Search standard locations
    const locations = this.getSearchLocations();
    
    for (const location of locations) {
      if (existsSync(location)) {
        try {
          return this._loadFromFile(location);
        } catch (err) {
          log.debug('Failed to load sites from location', { path: location, error: err.message });
        }
      }
    }
    
    // No config found, use fallback
    log.info('No sites config found, using defaults');
    this._sites = FALLBACK_SITES;
    this._loadedFrom = 'fallback';
    
    return this._sites;
  }

  /**
   * Load from specific file
   */
  _loadFromFile(filePath) {
    const content = readFileSync(filePath, 'utf-8');
    
    let data;
    if (filePath.endsWith('.json')) {
      data = JSON.parse(content);
    } else {
      data = parseYaml(content);
    }
    
    // Validate structure
    if (!data.categories || typeof data.categories !== 'object') {
      throw new Error('Invalid sites config: missing categories');
    }
    
    this._sites = data;
    this._loadedFrom = filePath;
    
    log.info('Loaded sites configuration', { 
      path: filePath,
      categories: Object.keys(data.categories).length,
      totalSites: Object.values(data.categories).flat().length,
    });
    
    return data;
  }

  /**
   * Get all sites from selected categories
   */
  getSites(categories = ['all'], options = {}) {
    if (!this._sites) {
      throw new Error('Sites not loaded. Call await Sites.load() first.');
    }
    
    let sites = [];
    const allCategories = Object.keys(this._sites.categories);
    
    // Determine which categories to use
    const selectedCategories = categories.includes('all') 
      ? allCategories 
      : categories.filter(c => allCategories.includes(c));
    
    // Collect sites from selected categories
    for (const category of selectedCategories) {
      const categorySites = this._sites.categories[category] || [];
      sites.push(...categorySites);
    }
    
    // Add custom sites
    if (options.custom && Array.isArray(options.custom)) {
      sites.push(...options.custom);
    }
    
    // Remove excluded sites
    if (options.exclude && Array.isArray(options.exclude)) {
      const excludeSet = new Set(options.exclude.map(s => s.toLowerCase()));
      sites = sites.filter(s => !excludeSet.has(s.toLowerCase()));
    }
    
    // Remove duplicates
    sites = [...new Set(sites)];
    
    // Apply exclude patterns
    if (this._sites.excludePatterns) {
      const patterns = this._sites.excludePatterns.map(p => new RegExp(p, 'i'));
      sites = sites.filter(site => !patterns.some(pattern => pattern.test(site)));
    }
    
    // Shuffle if requested
    if (options.shuffle !== false) {
      sites = Random.shuffle(sites);
    }
    
    // Limit if specified
    if (options.maxSites && options.maxSites > 0) {
      sites = sites.slice(0, options.maxSites);
    }
    
    return sites;
  }

  /**
   * Get available categories
   */
  getCategories() {
    if (!this._sites) {
      throw new Error('Sites not loaded. Call await Sites.load() first.');
    }
    
    return Object.entries(this._sites.categories).map(([name, sites]) => ({
      name,
      count: sites.length,
      sites,
    }));
  }

  /**
   * Get random search query
   */
  getSearchQuery() {
    if (!this._sites?.searchTerms) {
      return 'news today';
    }
    
    // Flatten all search terms
    const allTerms = Object.values(this._sites.searchTerms).flat();
    return Random.pick(allTerms) || 'news today';
  }

  /**
   * Get search engine URL (weighted random)
   */
  getSearchEngine() {
    if (!this._sites?.searchEngines) {
      return { name: 'google', url: 'https://www.google.com/search?q=' };
    }
    
    const engines = Object.entries(this._sites.searchEngines).map(([name, config]) => ({
      value: { name, url: typeof config === 'string' ? config : config.url },
      weight: typeof config === 'object' ? config.weight || 1 : 1,
    }));
    
    return Random.weighted(engines);
  }

  /**
   * Get full search URL with random query
   */
  getSearchUrl() {
    const engine = this.getSearchEngine();
    const query = this.getSearchQuery();
    return {
      url: engine.url + encodeURIComponent(query),
      engine: engine.name,
      query,
    };
  }

  /**
   * Detect content type from URL
   */
  getContentType(url) {
    if (!this._sites?.contentTypeHints) {
      return 'article';
    }
    
    const urlLower = url.toLowerCase();
    
    for (const [type, patterns] of Object.entries(this._sites.contentTypeHints)) {
      if (patterns.some(pattern => urlLower.includes(pattern.toLowerCase()))) {
        return type;
      }
    }
    
    return 'article';
  }

  /**
   * Add sites to a category
   */
  addSites(category, sites) {
    if (!this._sites) {
      this._sites = { categories: {}, searchEngines: {}, searchTerms: {} };
    }
    
    if (!this._sites.categories[category]) {
      this._sites.categories[category] = [];
    }
    
    const newSites = Array.isArray(sites) ? sites : [sites];
    this._sites.categories[category].push(...newSites);
    
    // Remove duplicates
    this._sites.categories[category] = [...new Set(this._sites.categories[category])];
    
    return this;
  }

  /**
   * Save current sites to file
   */
  save(filePath = null) {
    const targetPath = filePath || this._loadedFrom || join(process.cwd(), 'sites.yaml');
    const dir = dirname(targetPath);
    
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    
    let content;
    if (targetPath.endsWith('.json')) {
      content = JSON.stringify(this._sites, null, 2);
    } else {
      content = stringifyYaml(this._sites);
    }
    
    writeFileSync(targetPath, content, 'utf-8');
    log.info('Saved sites configuration', { path: targetPath });
    
    return targetPath;
  }

  /**
   * Get info about loaded config
   */
  getInfo() {
    return {
      loadedFrom: this._loadedFrom,
      categories: this._sites ? Object.keys(this._sites.categories) : [],
      totalSites: this._sites ? Object.values(this._sites.categories).flat().length : 0,
      searchEngines: this._sites?.searchEngines ? Object.keys(this._sites.searchEngines) : [],
      searchTermCount: this._sites?.searchTerms ? Object.values(this._sites.searchTerms).flat().length : 0,
    };
  }

  /**
   * Get raw config
   */
  getRaw() {
    return this._sites;
  }
}

// Export singleton
export const Sites = new SitesManager();
