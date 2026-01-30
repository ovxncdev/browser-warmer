/**
 * @fileoverview Advanced randomization utilities for natural, human-like behavior
 * Uses multiple distribution types and sophisticated patterns
 */

/**
 * Seedable random number generator (Mulberry32)
 * Allows reproducible "random" sequences for testing
 */
export class SeededRandom {
  constructor(seed = Date.now()) {
    this.seed = seed;
    this.state = seed;
  }
  
  /**
   * Generate next random number between 0 and 1
   */
  next() {
    this.state |= 0;
    this.state = (this.state + 0x6D2B79F5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  
  /**
   * Reset to initial seed
   */
  reset() {
    this.state = this.seed;
  }
  
  /**
   * Set new seed
   */
  setSeed(seed) {
    this.seed = seed;
    this.state = seed;
  }
}

// Default random instance (non-seeded, uses Math.random)
const defaultRandom = {
  next: () => Math.random(),
};

/**
 * Core random utilities
 */
export const Random = {
  /**
   * Random integer between min and max (inclusive)
   */
  int(min, max, rng = defaultRandom) {
    return Math.floor(rng.next() * (max - min + 1)) + min;
  },
  
  /**
   * Random float between min and max
   */
  float(min, max, rng = defaultRandom) {
    return rng.next() * (max - min) + min;
  },
  
  /**
   * Random boolean with optional probability
   */
  bool(probability = 0.5, rng = defaultRandom) {
    return rng.next() < probability;
  },
  
  /**
   * Pick random element from array
   */
  pick(array, rng = defaultRandom) {
    if (!array || array.length === 0) return undefined;
    return array[Math.floor(rng.next() * array.length)];
  },
  
  /**
   * Pick multiple unique random elements
   */
  pickMultiple(array, count, rng = defaultRandom) {
    if (!array || array.length === 0) return [];
    const shuffled = this.shuffle([...array], rng);
    return shuffled.slice(0, Math.min(count, array.length));
  },
  
  /**
   * Shuffle array (Fisher-Yates)
   */
  shuffle(array, rng = defaultRandom) {
    const result = [...array];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  },
  
  /**
   * Weighted random pick
   * @param items Array of { value, weight } objects
   */
  weighted(items, rng = defaultRandom) {
    if (!items || items.length === 0) return undefined;
    
    const totalWeight = items.reduce((sum, item) => sum + (item.weight || 1), 0);
    let random = rng.next() * totalWeight;
    
    for (const item of items) {
      random -= item.weight || 1;
      if (random <= 0) {
        return item.value;
      }
    }
    
    return items[items.length - 1].value;
  },
};

/**
 * Statistical distributions for more natural randomness
 */
export const Distribution = {
  /**
   * Gaussian (normal) distribution
   * Uses Box-Muller transform
   */
  gaussian(mean = 0, stdDev = 1, rng = defaultRandom) {
    let u1, u2;
    do {
      u1 = rng.next();
      u2 = rng.next();
    } while (u1 === 0);
    
    const z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    return z * stdDev + mean;
  },
  
  /**
   * Gaussian with min/max bounds
   */
  gaussianBounded(mean, stdDev, min, max, rng = defaultRandom) {
    let value;
    let attempts = 0;
    do {
      value = this.gaussian(mean, stdDev, rng);
      attempts++;
    } while ((value < min || value > max) && attempts < 100);
    
    return Math.max(min, Math.min(max, value));
  },
  
  /**
   * Exponential distribution (good for wait times)
   */
  exponential(lambda = 1, rng = defaultRandom) {
    return -Math.log(1 - rng.next()) / lambda;
  },
  
  /**
   * Poisson distribution (good for event counts)
   */
  poisson(lambda, rng = defaultRandom) {
    const L = Math.exp(-lambda);
    let k = 0;
    let p = 1;
    
    do {
      k++;
      p *= rng.next();
    } while (p > L);
    
    return k - 1;
  },
  
  /**
   * Pareto distribution (80/20 rule)
   */
  pareto(alpha = 1, min = 1, rng = defaultRandom) {
    return min / Math.pow(rng.next(), 1 / alpha);
  },
  
  /**
   * Beta distribution (good for probabilities)
   */
  beta(alpha, beta, rng = defaultRandom) {
    const gammaAlpha = this._gamma(alpha, rng);
    const gammaBeta = this._gamma(beta, rng);
    return gammaAlpha / (gammaAlpha + gammaBeta);
  },
  
  /**
   * Gamma distribution helper
   */
  _gamma(shape, rng = defaultRandom) {
    if (shape < 1) {
      return this._gamma(shape + 1, rng) * Math.pow(rng.next(), 1 / shape);
    }
    
    const d = shape - 1/3;
    const c = 1 / Math.sqrt(9 * d);
    
    while (true) {
      let x, v;
      do {
        x = this.gaussian(0, 1, rng);
        v = 1 + c * x;
      } while (v <= 0);
      
      v = v * v * v;
      const u = rng.next();
      
      if (u < 1 - 0.0331 * x * x * x * x) return d * v;
      if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
    }
  },
};

/**
 * Time-based randomization for natural delays
 */
export const Timing = {
  /**
   * Human-like delay (slightly skewed towards shorter times)
   */
  humanDelay(minMs, maxMs, rng = defaultRandom) {
    const mean = (minMs + maxMs) / 2;
    const stdDev = (maxMs - minMs) / 4;
    return Math.round(Distribution.gaussianBounded(mean * 0.8, stdDev, minMs, maxMs, rng));
  },
  
  /**
   * Reading time based on content length
   */
  readingTime(charCount, wpm = 200, rng = defaultRandom) {
    const wordsPerChar = 1 / 5; // Average word length
    const words = charCount * wordsPerChar;
    const baseTime = (words / wpm) * 60 * 1000; // ms
    
    // Add human variance (people don't read at constant speed)
    const variance = Distribution.gaussian(1, 0.2, rng);
    return Math.round(baseTime * Math.max(0.5, variance));
  },
  
  /**
   * Typing delay between keystrokes
   */
  typingDelay(rng = defaultRandom) {
    // Most keystrokes are 50-150ms, occasional pauses up to 500ms
    if (Random.bool(0.1, rng)) {
      // Thinking pause
      return Random.int(300, 800, rng);
    }
    return Distribution.gaussianBounded(100, 40, 30, 250, rng);
  },
  
  /**
   * Scroll pause duration
   */
  scrollPause(rng = defaultRandom) {
    // Quick glances vs reading sections
    if (Random.bool(0.3, rng)) {
      return Random.int(100, 500, rng); // Quick glance
    }
    return Random.int(800, 3000, rng); // Actually reading
  },
  
  /**
   * Page stay duration based on content type
   */
  pageStayDuration(contentType = 'article', rng = defaultRandom) {
    const durations = {
      homepage: { min: 5000, max: 30000, mean: 15000 },
      article: { min: 15000, max: 180000, mean: 60000 },
      search: { min: 3000, max: 20000, mean: 8000 },
      video: { min: 30000, max: 300000, mean: 120000 },
      social: { min: 10000, max: 120000, mean: 45000 },
      shopping: { min: 20000, max: 180000, mean: 60000 },
      form: { min: 30000, max: 300000, mean: 90000 },
      quick: { min: 2000, max: 10000, mean: 5000 },
    };
    
    const config = durations[contentType] || durations.article;
    const stdDev = (config.max - config.min) / 4;
    
    return Math.round(Distribution.gaussianBounded(config.mean, stdDev, config.min, config.max, rng));
  },
  
  /**
   * Time between site visits
   */
  betweenSitesDelay(rng = defaultRandom) {
    // Sometimes quick succession, sometimes longer breaks
    if (Random.bool(0.2, rng)) {
      // Quick hop
      return Random.int(1000, 5000, rng);
    } else if (Random.bool(0.1, rng)) {
      // Longer break (checking phone, etc)
      return Random.int(30000, 120000, rng);
    }
    return Random.int(5000, 30000, rng);
  },
  
  /**
   * Create a promise that resolves after delay
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  },
  
  /**
   * Sleep with human-like variance
   */
  async humanSleep(minMs, maxMs, rng = defaultRandom) {
    const delay = this.humanDelay(minMs, maxMs, rng);
    await this.sleep(delay);
    return delay;
  },
};

/**
 * Behavior patterns for realistic browsing
 */
export const Behavior = {
  /**
   * Generate natural mouse movement path
   */
  mousePath(startX, startY, endX, endY, rng = defaultRandom) {
    const points = [];
    const steps = Random.int(10, 30, rng);
    
    // Use bezier-like curve with random control points
    const cp1x = startX + (endX - startX) * Random.float(0.2, 0.4, rng) + Random.int(-50, 50, rng);
    const cp1y = startY + (endY - startY) * Random.float(0.2, 0.4, rng) + Random.int(-50, 50, rng);
    const cp2x = startX + (endX - startX) * Random.float(0.6, 0.8, rng) + Random.int(-50, 50, rng);
    const cp2y = startY + (endY - startY) * Random.float(0.6, 0.8, rng) + Random.int(-50, 50, rng);
    
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      const mt = 1 - t;
      const mt2 = mt * mt;
      const mt3 = mt2 * mt;
      
      // Cubic bezier
      const x = mt3 * startX + 3 * mt2 * t * cp1x + 3 * mt * t2 * cp2x + t3 * endX;
      const y = mt3 * startY + 3 * mt2 * t * cp1y + 3 * mt * t2 * cp2y + t3 * endY;
      
      // Add slight jitter
      points.push({
        x: Math.round(x + Random.float(-2, 2, rng)),
        y: Math.round(y + Random.float(-2, 2, rng)),
        delay: Timing.typingDelay(rng) / 2,
      });
    }
    
    return points;
  },
  
  /**
   * Generate natural scroll pattern
   */
  scrollPattern(pageHeight, viewportHeight, rng = defaultRandom) {
    const actions = [];
    let currentY = 0;
    const maxScroll = pageHeight - viewportHeight;
    
    // Number of scroll actions
    const scrollCount = Random.int(3, 12, rng);
    
    for (let i = 0; i < scrollCount; i++) {
      // Scroll amount (usually 100-500px, occasionally more)
      let scrollAmount;
      if (Random.bool(0.1, rng)) {
        // Big scroll
        scrollAmount = Random.int(500, 1000, rng);
      } else if (Random.bool(0.2, rng)) {
        // Small adjustment
        scrollAmount = Random.int(50, 150, rng);
      } else {
        // Normal scroll
        scrollAmount = Random.int(150, 400, rng);
      }
      
      // Direction (mostly down, sometimes up)
      const direction = Random.bool(0.85, rng) ? 1 : -1;
      scrollAmount *= direction;
      
      const newY = Math.max(0, Math.min(maxScroll, currentY + scrollAmount));
      
      if (newY !== currentY) {
        actions.push({
          type: 'scroll',
          from: currentY,
          to: newY,
          duration: Random.int(200, 600, rng),
          pause: Timing.scrollPause(rng),
        });
        currentY = newY;
      }
      
      // Occasionally scroll back to top
      if (Random.bool(0.05, rng) && currentY > viewportHeight) {
        actions.push({
          type: 'scrollToTop',
          from: currentY,
          to: 0,
          duration: Random.int(500, 1000, rng),
          pause: Random.int(1000, 3000, rng),
        });
        currentY = 0;
      }
    }
    
    return actions;
  },
  
  /**
   * Decide whether to click a link (based on various factors)
   */
  shouldClickLink(linkData, rng = defaultRandom) {
    let probability = 0.3; // Base probability
    
    // Adjust based on link properties
    if (linkData.isNavigation) probability += 0.2;
    if (linkData.isInternal) probability += 0.15;
    if (linkData.hasImage) probability += 0.1;
    if (linkData.isAboveFold) probability += 0.15;
    if (linkData.textLength > 20 && linkData.textLength < 100) probability += 0.1;
    
    // Decrease for certain patterns
    if (linkData.isExternal) probability -= 0.2;
    if (linkData.isAd) probability -= 0.4;
    if (linkData.isSocial) probability -= 0.1;
    
    return Random.bool(Math.min(0.8, Math.max(0.05, probability)), rng);
  },
  
  /**
   * Generate session behavior profile
   */
  generateSessionProfile(rng = defaultRandom) {
    return {
      // User type affects behavior
      userType: Random.weighted([
        { value: 'casual', weight: 50 },
        { value: 'focused', weight: 30 },
        { value: 'scanner', weight: 15 },
        { value: 'researcher', weight: 5 },
      ], rng),
      
      // Speed multiplier
      speedMultiplier: Distribution.gaussianBounded(1, 0.3, 0.5, 2, rng),
      
      // Engagement level
      engagement: Random.float(0.3, 1, rng),
      
      // Click tendency
      clickTendency: Random.float(0.2, 0.8, rng),
      
      // Scroll depth preference
      scrollDepth: Random.weighted([
        { value: 'shallow', weight: 30 },
        { value: 'medium', weight: 45 },
        { value: 'deep', weight: 25 },
      ], rng),
      
      // Attention span (affects page stay time)
      attentionSpan: Random.weighted([
        { value: 'short', weight: 25 },
        { value: 'medium', weight: 50 },
        { value: 'long', weight: 25 },
      ], rng),
    };
  },
};

/**
 * Export seeded random for testing
 */
export { SeededRandom };
