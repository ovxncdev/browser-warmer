/**
 * @fileoverview Dolphin Anty browser adapter
 * Connects to Dolphin Anty profiles via local API or direct WebSocket
 */

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { EventEmitter } from 'events';
import { createLogger } from '../utils/logger.js';

const log = createLogger({ name: 'dolphin' });

// Apply stealth (though Dolphin already has anti-detect)
puppeteer.use(StealthPlugin());

/**
 * Dolphin Anty API endpoints
 */
const DOLPHIN_ENDPOINTS = {
  // Cloud API (for listing profiles, managing data)
  cloudUrl: 'https://dolphin-anty-api.com',
  
  // Local API (for starting/stopping profiles - Dolphin Anty must be running)
  localUrl: 'http://localhost:3001',
  
  // Endpoints (cloud)
  profiles: '/browser_profiles',
  
  // Endpoints (local)  
  start: '/v1.0/browser_profiles/{id}/start',
  stop: '/v1.0/browser_profiles/{id}/stop',
};

// Token can be set via environment variable or passed directly
let globalToken = process.env.DOLPHIN_TOKEN || null;

/**
 * Set the API token globally
 */
export function setDolphinToken(token) {
  globalToken = token;
}

/**
 * Dolphin Anty Connection Options
 */
export const DolphinConnectionType = {
  API: 'api',           // Use Dolphin's local API to launch profile
  WEBSOCKET: 'ws',      // Connect directly to already-running profile
  MANUAL: 'manual',     // User provides the WebSocket URL manually
};

/**
 * Dolphin Anty Adapter Class
 */
export class DolphinAdapter extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      apiPort: options.apiPort || 3001,
      apiHost: options.apiHost || 'localhost',
      connectionType: options.connectionType || DolphinConnectionType.API,
      timeout: options.timeout || 30000,
      token: options.token || globalToken || null,
      ...options,
    };
    
    this.browser = null;
    this.page = null;
    this.profileId = null;
    this.wsEndpoint = null;
    this._isConnected = false;
  }

  /**
   * Set API token
   */
  setToken(token) {
    this.options.token = token;
  }

  /**
   * Get local API URL
   */
  get localApiUrl() {
    return `http://${this.options.apiHost}:${this.options.apiPort}`;
  }

  /**
   * Get cloud API URL  
   */
  get cloudApiUrl() {
    return DOLPHIN_ENDPOINTS.cloudUrl;
  }

  /**
   * Make API request to Dolphin Cloud API
   */
  async _cloudApiRequest(endpoint, method = 'GET', body = null) {
    const url = `${this.cloudApiUrl}${endpoint}`;
    
    log.debug('Dolphin Cloud API request', { method, url });
    
    try {
      const headers = {
        'Content-Type': 'application/json',
      };
      
      if (this.options.token) {
        headers['Authorization'] = `Bearer ${this.options.token}`;
      }
      
      const options = {
        method,
        headers,
      };
      
      if (body) {
        options.body = JSON.stringify(body);
      }
      
      const response = await fetch(url, options);
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.message || data.error || `API error: ${response.status}`);
      }
      
      return data;
      
    } catch (error) {
      if (error.code === 'ECONNREFUSED') {
        throw new Error(`Cannot connect to Dolphin Cloud API at ${url}.`);
      }
      throw error;
    }
  }

  /**
   * Make API request to Dolphin Local API
   */
  async _localApiRequest(endpoint, method = 'GET', body = null) {
    const url = `${this.localApiUrl}${endpoint}`;
    
    log.debug('Dolphin Local API request', { method, url });
    
    try {
      const headers = {
        'Content-Type': 'application/json',
      };
      
      const options = {
        method,
        headers,
      };
      
      if (body) {
        options.body = JSON.stringify(body);
      }
      
      const response = await fetch(url, options);
      const data = await response.json();
      
      if (!response.ok || data.success === false) {
        throw new Error(data.message || data.error || `API error: ${response.status}`);
      }
      
      return data;
      
    } catch (error) {
      if (error.code === 'ECONNREFUSED') {
        throw new Error(
          `Cannot connect to Dolphin Anty Local API at ${url}. ` +
          'Make sure Dolphin Anty is running.'
        );
      }
      throw error;
    }
  }

  /**
   * List all available profiles (uses Cloud API)
   */
  async listProfiles() {
    log.info('Fetching Dolphin profiles from cloud...');
    
    const response = await this._cloudApiRequest('/browser_profiles');
    
    const profiles = response.data || [];
    
    log.info('Found profiles', { count: profiles.length });
    
    return profiles.map(p => ({
      id: p.id,
      name: p.name,
      status: p.status,
      notes: p.notes?.content,
      tags: p.tags,
      platform: p.platform,
      browserType: p.browserType,
      createdAt: p.created_at,
      updatedAt: p.updated_at,
    }));
  }

  /**
   * Get profile details (uses Cloud API)
   */
  async getProfile(profileId) {
    const response = await this._cloudApiRequest(`/browser_profiles/${profileId}`);
    return response.data || response;
  }

  /**
   * Start a profile via Local API and connect to it
   */
  async startProfile(profileId) {
    log.info('Starting Dolphin profile via Local API', { profileId });
    
    this.profileId = profileId;
    
    // Start the profile using Local API
    const response = await this._localApiRequest(
      `/v1.0/browser_profiles/${profileId}/start?automation=1`,
      'GET'
    );
    
    if (!response.success) {
      throw new Error(response.message || 'Failed to start profile');
    }
    
    const automation = response.automation;
    
    if (!automation || !automation.wsEndpoint) {
      throw new Error(
        'No WebSocket endpoint returned. Make sure automation is enabled in Dolphin Anty settings. ' +
        'Note: Automation requires a paid Dolphin Anty plan.'
      );
    }
    
    this.wsEndpoint = `ws://127.0.0.1:${automation.port}${automation.wsEndpoint}`;
    
    log.info('Profile started', { 
      profileId, 
      port: automation.port,
      wsEndpoint: this.wsEndpoint.substring(0, 50) + '...',
    });
    
    // Connect to the browser
    const fullWsEndpoint = `ws://127.0.0.1:${automation.port}${automation.wsEndpoint}`;
    await this._connectToBrowser(fullWsEndpoint);
    
    return {
      profileId,
      wsEndpoint: fullWsEndpoint,
      port: automation.port,
    };
  }

  /**
   * Connect to an already-running profile via WebSocket URL
   */
  async connectToRunningProfile(wsEndpoint) {
    log.info('Connecting to running Dolphin profile', { 
      wsEndpoint: wsEndpoint.substring(0, 50) + '...' 
    });
    
    this.wsEndpoint = wsEndpoint;
    
    await this._connectToBrowser(wsEndpoint);
    
    return {
      wsEndpoint: this.wsEndpoint,
    };
  }

  /**
   * Connect to browser via WebSocket endpoint
   */
  async _connectToBrowser(wsEndpoint) {
    try {
      this.browser = await puppeteer.connect({
        browserWSEndpoint: wsEndpoint,
        defaultViewport: null, // Use Dolphin's viewport
      });
      
      this._isConnected = true;
      
      // Get existing pages or create new one
      const pages = await this.browser.pages();
      this.page = pages[0] || await this.browser.newPage();
      
      // Set up disconnect handler
      this.browser.on('disconnected', () => {
        this._isConnected = false;
        log.warn('Disconnected from Dolphin profile');
        this.emit('disconnected');
      });
      
      log.info('Connected to Dolphin browser');
      this.emit('connected', { browser: this.browser, page: this.page });
      
    } catch (error) {
      log.error('Failed to connect to Dolphin browser', { error: error.message });
      
      if (error.message.includes('WebSocket')) {
        throw new Error(
          `Cannot connect to browser WebSocket. The profile may have been closed. ` +
          `Endpoint: ${wsEndpoint}`
        );
      }
      
      throw error;
    }
  }

  /**
   * Stop the profile via Local API
   */
  async stopProfile(profileId = null) {
    const id = profileId || this.profileId;
    
    if (!id) {
      log.warn('No profile ID to stop');
      return;
    }
    
    log.info('Stopping Dolphin profile', { profileId: id });
    
    try {
      await this._localApiRequest(`/v1.0/browser_profiles/${id}/stop`, 'GET');
      log.info('Profile stopped');
    } catch (error) {
      log.warn('Failed to stop profile via API', { error: error.message });
    }
  }

  /**
   * Disconnect from browser (without stopping profile)
   */
  async disconnect() {
    if (this.browser) {
      log.info('Disconnecting from Dolphin browser');
      
      try {
        this.browser.disconnect();
      } catch (error) {
        log.debug('Disconnect error (may be normal)', { error: error.message });
      }
      
      this.browser = null;
      this.page = null;
      this._isConnected = false;
      
      this.emit('disconnected');
    }
  }

  /**
   * Close browser and optionally stop profile
   */
  async close(stopProfile = false) {
    await this.disconnect();
    
    if (stopProfile && this.profileId) {
      await this.stopProfile();
    }
  }

  /**
   * Get browser instance
   */
  getBrowser() {
    return this.browser;
  }

  /**
   * Get current page
   */
  getPage() {
    return this.page;
  }

  /**
   * Create new page
   */
  async newPage() {
    if (!this.browser) {
      throw new Error('Not connected to browser');
    }
    return await this.browser.newPage();
  }

  /**
   * Check if connected
   */
  isConnected() {
    return this._isConnected && this.browser?.isConnected();
  }

  /**
   * Navigate to URL
   */
  async goto(url, options = {}) {
    if (!this.page) {
      throw new Error('No active page');
    }
    
    return await this.page.goto(url, {
      waitUntil: options.waitUntil || 'domcontentloaded',
      timeout: options.timeout || 30000,
    });
  }

  /**
   * Check if Dolphin API is available
   */
  async checkApiAvailable() {
    try {
      await this._cloudApiRequest('/browser_profiles?limit=1');
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Check if Local API is available
   */
  async checkLocalApiAvailable() {
    try {
      const response = await fetch(`${this.localApiUrl}/v1.0/browser_profiles`, {
        method: 'GET',
      });
      return response.ok || response.status === 401; // 401 means it's running but needs auth
    } catch (error) {
      return false;
    }
  }

  /**
   * Get connection info for display
   */
  getConnectionInfo() {
    return {
      profileId: this.profileId,
      wsEndpoint: this.wsEndpoint,
      isConnected: this._isConnected,
      apiUrl: this.apiUrl,
    };
  }
}

/**
 * Helper: Find WebSocket endpoint from Dolphin's debug port
 * When you manually launch a profile, Dolphin shows the port in the UI
 */
export async function findDolphinEndpoint(port, host = '127.0.0.1') {
  const url = `http://${host}:${port}/json/version`;
  
  log.debug('Fetching browser endpoint', { url });
  
  try {
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.webSocketDebuggerUrl) {
      return data.webSocketDebuggerUrl;
    }
    
    throw new Error('No webSocketDebuggerUrl found');
    
  } catch (error) {
    throw new Error(
      `Cannot find browser at port ${port}. ` +
      `Make sure the Dolphin profile is running and check the debug port.`
    );
  }
}

/**
 * Helper: Scan for running Dolphin profiles
 * Checks common port range for debug endpoints
 */
export async function scanForDolphinProfiles(startPort = 9222, endPort = 9322, host = '127.0.0.1') {
  log.info('Scanning for running Dolphin profiles', { startPort, endPort });
  
  const found = [];
  
  const checkPort = async (port) => {
    try {
      const url = `http://${host}:${port}/json/version`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 500);
      
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      
      const data = await response.json();
      
      if (data.webSocketDebuggerUrl) {
        return {
          port,
          wsEndpoint: data.webSocketDebuggerUrl,
          browser: data.Browser || 'Unknown',
        };
      }
    } catch {
      // Port not available or not a browser
    }
    return null;
  };
  
  // Check ports in parallel batches
  const batchSize = 20;
  for (let i = startPort; i <= endPort; i += batchSize) {
    const batch = [];
    for (let j = i; j < Math.min(i + batchSize, endPort + 1); j++) {
      batch.push(checkPort(j));
    }
    
    const results = await Promise.all(batch);
    found.push(...results.filter(Boolean));
  }
  
  log.info('Scan complete', { found: found.length });
  
  return found;
}

/**
 * Create Dolphin adapter instance
 */
export function createDolphinAdapter(options = {}) {
  return new DolphinAdapter(options);
}

/**
 * Quick connect helper
 */
export async function connectToDolphin(options = {}) {
  const adapter = createDolphinAdapter(options);
  
  if (options.wsEndpoint) {
    // Direct WebSocket connection
    await adapter.connectToRunningProfile(options.wsEndpoint);
  } else if (options.port) {
    // Find endpoint from debug port
    const wsEndpoint = await findDolphinEndpoint(options.port, options.host);
    await adapter.connectToRunningProfile(wsEndpoint);
  } else if (options.profileId) {
    // Start profile via API
    await adapter.startProfile(options.profileId);
  } else {
    throw new Error('Must provide wsEndpoint, port, or profileId');
  }
  
  return adapter;
}
