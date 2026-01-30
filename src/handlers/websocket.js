/**
 * @fileoverview WebSocket server for remote control and real-time monitoring
 */

import { WebSocketServer, WebSocket } from 'ws';
import { EventEmitter } from 'events';
import { createLogger } from '../utils/logger.js';
import { Config } from '../utils/config.js';
import { randomBytes } from 'crypto';

const log = createLogger({ name: 'websocket' });

// Simple ID generator (replaces nanoid for fewer deps)
const generateId = (length = 10) => randomBytes(length).toString('hex').slice(0, length);

/**
 * Message types for WebSocket communication
 */
export const MessageType = {
  // Client -> Server (Commands)
  COMMAND: 'command',
  SUBSCRIBE: 'subscribe',
  UNSUBSCRIBE: 'unsubscribe',
  PING: 'ping',
  
  // Server -> Client (Responses/Events)
  RESPONSE: 'response',
  EVENT: 'event',
  ERROR: 'error',
  PONG: 'pong',
  WELCOME: 'welcome',
};

/**
 * Available commands
 */
export const Commands = {
  // Session control
  START: 'start',
  STOP: 'stop',
  PAUSE: 'pause',
  RESUME: 'resume',
  
  // Information
  STATUS: 'status',
  STATS: 'stats',
  CONFIG: 'config',
  
  // Actions
  SCREENSHOT: 'screenshot',
  GOTO: 'goto',
  
  // Management
  LIST_CLIENTS: 'list_clients',
};

/**
 * Event types that can be subscribed to
 */
export const EventTypes = {
  STATE_CHANGE: 'stateChange',
  SITE_START: 'siteStart',
  SITE_COMPLETE: 'siteComplete',
  SITE_FAILED: 'siteFailed',
  SEARCH_PERFORMED: 'searchPerformed',
  PAGE_VISITED: 'pageVisited',
  ERROR: 'error',
  STATS_UPDATE: 'statsUpdate',
  ALL: '*',
};

/**
 * Connected client wrapper
 */
class Client {
  constructor(ws, id) {
    this.ws = ws;
    this.id = id;
    this.subscriptions = new Set();
    this.connectedAt = new Date();
    this.lastActivity = new Date();
    this.messageCount = 0;
  }

  send(message) {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
      return true;
    }
    return false;
  }

  subscribe(eventType) {
    this.subscriptions.add(eventType);
  }

  unsubscribe(eventType) {
    this.subscriptions.delete(eventType);
  }

  isSubscribed(eventType) {
    return this.subscriptions.has(eventType) || this.subscriptions.has(EventTypes.ALL);
  }

  touch() {
    this.lastActivity = new Date();
    this.messageCount++;
  }

  getInfo() {
    return {
      id: this.id,
      connectedAt: this.connectedAt,
      lastActivity: this.lastActivity,
      messageCount: this.messageCount,
      subscriptions: Array.from(this.subscriptions),
    };
  }
}

/**
 * WebSocket Handler Class
 */
export class WebSocketHandler extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      port: options.port || 8765,
      host: options.host || 'localhost',
      heartbeatInterval: options.heartbeatInterval || 30000,
      ...options,
    };
    
    this.server = null;
    this.clients = new Map();
    this.session = null;
    this._heartbeatTimer = null;
    this._isRunning = false;
  }

  /**
   * Attach a session manager to handle commands
   */
  attachSession(session) {
    this.session = session;
    
    // Forward session events to subscribed clients
    const sessionEvents = [
      'stateChange',
      'siteStart',
      'siteComplete',
      'siteFailed',
      'searchPerformed',
      'pageVisited',
      'error',
      'paused',
      'resumed',
      'started',
      'stopped',
      'completed',
    ];
    
    for (const eventName of sessionEvents) {
      session.on(eventName, (data) => {
        this.broadcast(eventName, data);
      });
    }
    
    // Periodic stats update
    this._statsInterval = setInterval(() => {
      if (this.session?.isRunning()) {
        this.broadcast('statsUpdate', this.session.getStats());
      }
    }, 5000);
    
    log.debug('Session attached to WebSocket handler');
  }

  /**
   * Start the WebSocket server
   */
  start() {
    return new Promise((resolve, reject) => {
      try {
        this.server = new WebSocketServer({
          port: this.options.port,
          host: this.options.host,
        });
        
        this.server.on('listening', () => {
          this._isRunning = true;
          log.info('WebSocket server started', {
            host: this.options.host,
            port: this.options.port,
          });
          
          this._startHeartbeat();
          this.emit('started');
          resolve();
        });
        
        this.server.on('connection', (ws, req) => {
          this._handleConnection(ws, req);
        });
        
        this.server.on('error', (error) => {
          log.error('WebSocket server error', { error: error.message });
          this.emit('error', error);
          
          if (!this._isRunning) {
            reject(error);
          }
        });
        
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Handle new client connection
   */
  _handleConnection(ws, req) {
    const clientId = generateId(10);
    const client = new Client(ws, clientId);
    
    this.clients.set(clientId, client);
    
    const clientIp = req.socket.remoteAddress;
    log.info('Client connected', { clientId, ip: clientIp });
    
    // Send welcome message
    client.send({
      type: MessageType.WELCOME,
      data: {
        clientId,
        serverTime: new Date().toISOString(),
        availableCommands: Object.values(Commands),
        availableEvents: Object.values(EventTypes),
      },
    });
    
    // Handle messages
    ws.on('message', (data) => {
      this._handleMessage(client, data);
    });
    
    // Handle close
    ws.on('close', (code, reason) => {
      this.clients.delete(clientId);
      log.info('Client disconnected', { clientId, code });
      this.emit('clientDisconnected', { clientId });
    });
    
    // Handle errors
    ws.on('error', (error) => {
      log.warn('Client error', { clientId, error: error.message });
    });
    
    this.emit('clientConnected', { clientId, ip: clientIp });
  }

  /**
   * Handle incoming message
   */
  async _handleMessage(client, rawData) {
    client.touch();
    
    let message;
    try {
      message = JSON.parse(rawData.toString());
    } catch (error) {
      client.send({
        type: MessageType.ERROR,
        error: 'Invalid JSON',
      });
      return;
    }
    
    const { type, command, data, requestId } = message;
    
    log.debug('Message received', { clientId: client.id, type, command });
    
    try {
      switch (type) {
        case MessageType.COMMAND:
          await this._handleCommand(client, command, data, requestId);
          break;
          
        case MessageType.SUBSCRIBE:
          this._handleSubscribe(client, data, requestId);
          break;
          
        case MessageType.UNSUBSCRIBE:
          this._handleUnsubscribe(client, data, requestId);
          break;
          
        case MessageType.PING:
          client.send({ type: MessageType.PONG, requestId });
          break;
          
        default:
          client.send({
            type: MessageType.ERROR,
            error: `Unknown message type: ${type}`,
            requestId,
          });
      }
    } catch (error) {
      log.error('Message handling error', { error: error.message });
      client.send({
        type: MessageType.ERROR,
        error: error.message,
        requestId,
      });
    }
  }

  /**
   * Handle command execution
   */
  async _handleCommand(client, command, data, requestId) {
    const response = {
      type: MessageType.RESPONSE,
      command,
      requestId,
      success: false,
      data: null,
    };
    
    try {
      switch (command) {
        case Commands.START:
          if (!this.session) throw new Error('No session attached');
          await this.session.initialize();
          this.session.start().catch(err => {
            log.error('Session start error', { error: err.message });
          });
          response.success = true;
          response.data = { message: 'Session starting' };
          break;
          
        case Commands.STOP:
          if (!this.session) throw new Error('No session attached');
          await this.session.stop();
          response.success = true;
          response.data = { message: 'Session stopped' };
          break;
          
        case Commands.PAUSE:
          if (!this.session) throw new Error('No session attached');
          const paused = this.session.pause();
          response.success = paused;
          response.data = { message: paused ? 'Session paused' : 'Cannot pause' };
          break;
          
        case Commands.RESUME:
          if (!this.session) throw new Error('No session attached');
          const resumed = this.session.resume();
          response.success = resumed;
          response.data = { message: resumed ? 'Session resumed' : 'Cannot resume' };
          break;
          
        case Commands.STATUS:
          response.success = true;
          response.data = {
            sessionState: this.session?.getState() || 'no-session',
            connectedClients: this.clients.size,
            serverUptime: process.uptime(),
          };
          break;
          
        case Commands.STATS:
          if (!this.session) throw new Error('No session attached');
          response.success = true;
          response.data = this.session.getStats();
          break;
          
        case Commands.CONFIG:
          response.success = true;
          response.data = Config.get();
          break;
          
        case Commands.SCREENSHOT:
          if (!this.session) throw new Error('No session attached');
          const screenshot = await this.session.screenshot();
          response.success = true;
          response.data = {
            image: screenshot.toString('base64'),
            mimeType: 'image/png',
          };
          break;
          
        case Commands.GOTO:
          if (!this.session) throw new Error('No session attached');
          if (!data?.url) throw new Error('URL required');
          await this.session.browser.goto(data.url);
          response.success = true;
          response.data = { url: data.url };
          break;
          
        case Commands.LIST_CLIENTS:
          response.success = true;
          response.data = {
            clients: Array.from(this.clients.values()).map(c => c.getInfo()),
          };
          break;
          
        default:
          throw new Error(`Unknown command: ${command}`);
      }
    } catch (error) {
      response.success = false;
      response.error = error.message;
    }
    
    client.send(response);
  }

  /**
   * Handle event subscription
   */
  _handleSubscribe(client, data, requestId) {
    const events = Array.isArray(data?.events) ? data.events : [data?.event || EventTypes.ALL];
    
    for (const event of events) {
      if (Object.values(EventTypes).includes(event)) {
        client.subscribe(event);
      }
    }
    
    client.send({
      type: MessageType.RESPONSE,
      command: 'subscribe',
      requestId,
      success: true,
      data: { subscriptions: Array.from(client.subscriptions) },
    });
  }

  /**
   * Handle event unsubscription
   */
  _handleUnsubscribe(client, data, requestId) {
    const events = Array.isArray(data?.events) ? data.events : [data?.event];
    
    for (const event of events) {
      client.unsubscribe(event);
    }
    
    client.send({
      type: MessageType.RESPONSE,
      command: 'unsubscribe',
      requestId,
      success: true,
      data: { subscriptions: Array.from(client.subscriptions) },
    });
  }

  /**
   * Broadcast event to subscribed clients
   */
  broadcast(eventType, data) {
    const message = {
      type: MessageType.EVENT,
      event: eventType,
      data,
      timestamp: new Date().toISOString(),
    };
    
    let sent = 0;
    for (const client of this.clients.values()) {
      if (client.isSubscribed(eventType)) {
        if (client.send(message)) {
          sent++;
        }
      }
    }
    
    if (sent > 0) {
      log.trace('Broadcast event', { event: eventType, clients: sent });
    }
  }

  /**
   * Send message to specific client
   */
  sendTo(clientId, message) {
    const client = this.clients.get(clientId);
    if (client) {
      return client.send(message);
    }
    return false;
  }

  /**
   * Start heartbeat to detect dead connections
   */
  _startHeartbeat() {
    this._heartbeatTimer = setInterval(() => {
      for (const [clientId, client] of this.clients) {
        if (client.ws.readyState === WebSocket.OPEN) {
          client.ws.ping();
        } else {
          this.clients.delete(clientId);
          log.debug('Removed dead client', { clientId });
        }
      }
    }, this.options.heartbeatInterval);
  }

  /**
   * Stop the WebSocket server
   */
  async stop() {
    log.info('Stopping WebSocket server...');
    
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
    
    if (this._statsInterval) {
      clearInterval(this._statsInterval);
      this._statsInterval = null;
    }
    
    for (const client of this.clients.values()) {
      client.ws.close(1000, 'Server shutting down');
    }
    this.clients.clear();
    
    if (this.server) {
      await new Promise((resolve) => {
        this.server.close(() => {
          this._isRunning = false;
          log.info('WebSocket server stopped');
          this.emit('stopped');
          resolve();
        });
      });
    }
  }

  /**
   * Get server status
   */
  getStatus() {
    return {
      isRunning: this._isRunning,
      port: this.options.port,
      host: this.options.host,
      clientCount: this.clients.size,
      clients: Array.from(this.clients.values()).map(c => c.getInfo()),
    };
  }

  /**
   * Check if server is running
   */
  isRunning() {
    return this._isRunning;
  }
}

/**
 * Create WebSocket handler instance
 */
export function createWebSocketHandler(options = {}) {
  return new WebSocketHandler(options);
}

/**
 * Example client code:
 * 
 * const ws = new WebSocket('ws://localhost:8765');
 * 
 * ws.onopen = () => {
 *   // Subscribe to all events
 *   ws.send(JSON.stringify({ type: 'subscribe', data: { events: ['*'] } }));
 *   
 *   // Start session
 *   ws.send(JSON.stringify({ type: 'command', command: 'start', requestId: '123' }));
 * };
 * 
 * ws.onmessage = (e) => console.log(JSON.parse(e.data));
 */
