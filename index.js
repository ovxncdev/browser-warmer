#!/usr/bin/env node

/**
 * @fileoverview Browser Warmer CLI - Main entry point
 */

import { Command } from 'commander';
import { Paths, Environment, findChrome } from './utils/paths.js';
import { Config, DEFAULT_CONFIG } from './utils/config.js';
import { createLogger } from './utils/logger.js';
import { Sites } from './utils/sites.js';
import { createSession, SessionState } from './core/session.js';
import { createWebSocketHandler } from './handlers/websocket.js';
import { UI, Color, Spinner, ProgressBar, Symbols } from './ui/components.js';
import { Prompt } from './ui/prompts.js';
import { 
  createDolphinSession, 
  scanForDolphinProfiles, 
  findDolphinEndpoint 
} from './adapters/dolphin-session.js';
import { createDolphinAdapter } from './adapters/dolphin.js';

const VERSION = '2.0.0';

// Initialize logger (will be reconfigured after config load)
let log = createLogger({ name: 'cli', level: 'info' });

/**
 * Display beautiful banner
 */
function showBanner() {
  const banner = `
${Color.cyan('╔══════════════════════════════════════════════════════════╗')}
${Color.cyan('║')}                                                            ${Color.cyan('║')}
${Color.cyan('║')}   ${Color.bold(Color.white('BROWSER WARMER'))}  ${Color.dim('v' + VERSION)}                               ${Color.cyan('║')}
${Color.cyan('║')}   ${Color.dim('Intelligent browser profile warming tool')}                ${Color.cyan('║')}
${Color.cyan('║')}                                                            ${Color.cyan('║')}
${Color.cyan('╚══════════════════════════════════════════════════════════╝')}
`;
  console.log(banner);
}

/**
 * Display environment info
 */
async function showEnvironment() {
  await Paths.initialize();
  
  const chrome = await findChrome();
  const env = Environment;
  
  console.log();
  console.log(Color.bold(' Environment'));
  console.log(UI.line('─', 50));
  
  const info = [
    ['Platform', `${env.platform()} ${env.isDocker() ? Color.yellow('(Docker)') : ''}`],
    ['Node.js', process.version],
    ['Chrome', chrome ? Color.green(chrome.path.substring(0, 45) + '...') : Color.red('Not found')],
    ['Chrome Source', chrome ? Color.dim(chrome.source) : '-'],
    ['Working Dir', process.cwd().substring(0, 45)],
  ];
  
  console.log(UI.keyValue(info, { indent: 1 }));
  console.log();
}

/**
 * Interactive start command
 */
async function interactiveStart(options) {
  showBanner();
  await showEnvironment();
  
  console.log(Color.bold(' Session Configuration'));
  console.log(UI.line('─', 50));
  console.log();
  
  // Load sites first
  await Sites.load(options.sites);
  const categories = Sites.getCategories();
  
  // Interactive prompts
  const answers = await Prompt.series({
    categories: {
      type: 'multiSelect',
      message: 'Select site categories',
      choices: [
        { name: 'All Categories', value: 'all' },
        ...categories.map(c => ({ 
          name: `${c.name} (${c.count} sites)`, 
          value: c.name 
        })),
      ],
      default: ['all'],
    },
    
    maxSites: {
      type: 'number',
      message: 'Maximum sites to visit (0 = unlimited)',
      default: 0,
      min: 0,
    },
    
    searches: {
      type: 'confirm',
      message: 'Perform search engine warm-up?',
      default: true,
    },
    
    searchCount: {
      type: 'number',
      message: 'Number of searches',
      default: 3,
      min: 1,
      max: 20,
      when: (ans) => ans.searches,
    },
    
    headless: {
      type: 'confirm',
      message: 'Run in headless mode (invisible)?',
      default: Environment.isDocker() || !process.env.DISPLAY,
    },
    
    websocket: {
      type: 'confirm',
      message: 'Enable WebSocket server for remote control?',
      default: false,
    },
    
    wsPort: {
      type: 'number',
      message: 'WebSocket port',
      default: 8765,
      min: 1024,
      max: 65535,
      when: (ans) => ans.websocket,
    },
  });
  
  console.log();
  
  // Build config overrides
  const overrides = {
    browser: {
      headless: answers.headless,
    },
    sites: {
      categories: answers.categories,
      maxSites: answers.maxSites,
    },
    behavior: {
      searches: answers.searches,
      searchCount: answers.searchCount || 0,
    },
    websocket: {
      enabled: answers.websocket,
      port: answers.wsPort || 8765,
    },
  };
  
  // Run session
  await runSession(overrides, options);
}

/**
 * Run session with given config
 */
async function runSession(overrides = {}, cliOptions = {}) {
  // Load configuration
  const config = await Config.load({
    configPath: cliOptions.config,
    overrides,
  });
  
  // Update logger with config level
  log = createLogger({ 
    name: 'cli', 
    level: config.logging.level,
    filePath: config.logging.file ? Paths.get('logs') : null,
  });
  
  // Show config summary
  console.log(Color.bold(' Session Summary'));
  console.log(UI.line('─', 50));
  
  const sites = Sites.getSites(config.sites.categories, {
    maxSites: config.sites.maxSites,
    shuffle: false, // Don't shuffle for count
  });
  
  const summary = [
    ['Sites', `${sites.length} sites from ${config.sites.categories.join(', ')}`],
    ['Searches', config.behavior.searches ? config.behavior.searchCount : 'Disabled'],
    ['Headless', config.browser.headless ? 'Yes' : 'No'],
    ['Profile', config.browser.profilePath],
    ['Timing', `${config.timing.minStay}s - ${config.timing.maxStay}s per site`],
  ];
  
  console.log(UI.keyValue(summary, { indent: 1 }));
  console.log();
  
  // Confirm start
  if (!cliOptions.yes) {
    const confirm = await Prompt.confirm({ 
      message: 'Start session?', 
      default: true 
    });
    
    if (!confirm) {
      console.log(Color.yellow('Session cancelled.'));
      process.exit(0);
    }
  }
  
  console.log();
  
  // Create session
  const session = createSession({
    sitesConfig: cliOptions.sites,
  });
  
  // WebSocket server
  let wsHandler = null;
  if (config.websocket.enabled) {
    wsHandler = createWebSocketHandler({
      port: config.websocket.port,
      host: config.websocket.host,
    });
    wsHandler.attachSession(session);
    await wsHandler.start();
    console.log(Color.green(`${Symbols.success} WebSocket server running on ws://${config.websocket.host}:${config.websocket.port}`));
    console.log();
  }
  
  // Progress tracking
  let progressBar = null;
  let currentSpinner = null;
  
  // Session event handlers
  session.on('initialized', () => {
    console.log(Color.green(`${Symbols.success} Browser launched`));
    console.log();
  });
  
  session.on('started', ({ siteCount }) => {
    console.log(Color.bold(' Progress'));
    console.log(UI.line('─', 50));
    progressBar = new ProgressBar({ total: siteCount, width: 40 });
    progressBar.start();
  });
  
  session.on('siteStart', ({ url, current, total }) => {
    const shortUrl = url.length > 40 ? url.substring(0, 37) + '...' : url;
    progressBar?.update(current - 1, shortUrl);
  });
  
  session.on('siteComplete', ({ url, duration, current, total }) => {
    progressBar?.update(current);
  });
  
  session.on('siteFailed', ({ url, error }) => {
    // Progress bar handles display
  });
  
  session.on('searchPerformed', ({ engine, query }) => {
    // Silent during main progress
  });
  
  session.on('error', (error) => {
    progressBar?.stop();
    console.log();
    console.log(Color.red(`${Symbols.error} Error: ${error.message}`));
    if (error.hint) {
      console.log(Color.yellow(`  Hint: ${error.hint}`));
    }
  });
  
  session.on('completed', (stats) => {
    progressBar?.complete('Session complete!');
    showStats(stats);
  });
  
  session.on('stopped', (stats) => {
    progressBar?.stop('Session stopped');
    showStats(stats);
  });
  
  // Handle Ctrl+C
  let stopping = false;
  process.on('SIGINT', async () => {
    if (stopping) {
      console.log('\nForce exit...');
      process.exit(1);
    }
    
    stopping = true;
    console.log('\n\nStopping session (press Ctrl+C again to force)...');
    
    await session.stop();
    if (wsHandler) await wsHandler.stop();
    
    process.exit(0);
  });
  
  // Run session
  try {
    await session.initialize();
    await session.start();
  } catch (error) {
    log.error('Session failed', { error: error.message });
    if (error.hint) {
      console.log(Color.yellow(`Hint: ${error.hint}`));
    }
    process.exit(1);
  } finally {
    if (wsHandler) await wsHandler.stop();
  }
}

/**
 * Show session statistics
 */
function showStats(stats) {
  console.log();
  console.log(Color.bold(' Session Statistics'));
  console.log(UI.line('─', 50));
  
  const data = [
    ['Duration', stats.durationFormatted],
    ['Sites Visited', stats.sitesVisited],
    ['Successful', Color.green(stats.sitesSuccessful.toString())],
    ['Failed', stats.sitesFailed > 0 ? Color.red(stats.sitesFailed.toString()) : '0'],
    ['Success Rate', stats.successRate],
    ['Pages Viewed', stats.pagesViewed],
    ['Searches', stats.searchesPerformed],
    ['Links Clicked', stats.linksClicked],
    ['Errors', stats.errors.length],
  ];
  
  console.log(UI.keyValue(data, { indent: 1 }));
  console.log();
}

/**
 * Doctor command - diagnose issues
 */
async function runDoctor() {
  showBanner();
  
  console.log(Color.bold(' System Diagnostics'));
  console.log(UI.line('─', 50));
  console.log();
  
  const checks = [];
  
  // Check Node.js version
  const nodeVersion = process.version;
  const nodeMajor = parseInt(nodeVersion.slice(1).split('.')[0]);
  checks.push({
    name: 'Node.js Version',
    status: nodeMajor >= 18 ? 'pass' : 'fail',
    message: nodeVersion,
    hint: nodeMajor < 18 ? 'Requires Node.js 18+' : null,
  });
  
  // Check paths
  await Paths.initialize();
  
  // Check Chrome
  const chrome = await findChrome();
  checks.push({
    name: 'Chrome/Chromium',
    status: chrome ? 'pass' : 'warn',
    message: chrome ? `Found at ${chrome.path.substring(0, 40)}...` : 'Not found',
    hint: chrome ? null : 'Will use Puppeteer bundled Chromium',
  });
  
  // Check environment
  checks.push({
    name: 'Docker',
    status: 'info',
    message: Environment.isDocker() ? 'Yes' : 'No',
  });
  
  checks.push({
    name: 'Display',
    status: process.env.DISPLAY || Environment.isDocker() ? 'pass' : 'warn',
    message: process.env.DISPLAY || 'Not set',
    hint: !process.env.DISPLAY ? 'Headless mode recommended' : null,
  });
  
  // Check config
  let configStatus = 'pass';
  let configMessage = 'Using defaults';
  try {
    const configFiles = Paths.get('configFiles') || [];
    for (const f of configFiles) {
      const { existsSync } = await import('fs');
      if (existsSync(f)) {
        configMessage = `Found: ${f}`;
        break;
      }
    }
  } catch (e) {
    configStatus = 'warn';
    configMessage = e.message;
  }
  checks.push({
    name: 'Configuration',
    status: configStatus,
    message: configMessage,
  });
  
  // Check sites config
  let sitesStatus = 'pass';
  let sitesMessage = 'Using defaults';
  try {
    await Sites.load();
    const info = Sites.getInfo();
    sitesMessage = `${info.totalSites} sites in ${info.categories.length} categories`;
  } catch (e) {
    sitesStatus = 'warn';
    sitesMessage = e.message;
  }
  checks.push({
    name: 'Sites Config',
    status: sitesStatus,
    message: sitesMessage,
  });
  
  // Display results
  for (const check of checks) {
    let icon, color;
    switch (check.status) {
      case 'pass':
        icon = Color.green(Symbols.success);
        color = 'green';
        break;
      case 'fail':
        icon = Color.red(Symbols.error);
        color = 'red';
        break;
      case 'warn':
        icon = Color.yellow(Symbols.warning);
        color = 'yellow';
        break;
      default:
        icon = Color.blue(Symbols.info);
        color = 'blue';
    }
    
    console.log(`  ${icon} ${Color.bold(check.name)}: ${check.message}`);
    if (check.hint) {
      console.log(`     ${Color.dim(check.hint)}`);
    }
  }
  
  console.log();
  
  const hasFailures = checks.some(c => c.status === 'fail');
  if (hasFailures) {
    console.log(Color.red('Some checks failed. Please resolve the issues above.'));
    process.exit(1);
  } else {
    console.log(Color.green('All checks passed! Ready to run.'));
  }
}

/**
 * Generate default config file
 */
async function generateConfig(options) {
  const { writeFileSync } = await import('fs');
  const { stringify } = await import('yaml');
  
  const format = options.json ? 'json' : 'yaml';
  const filename = options.output || `browser-warmer.${format === 'json' ? 'json' : 'yaml'}`;
  
  let content;
  if (format === 'json') {
    content = JSON.stringify(DEFAULT_CONFIG, null, 2);
  } else {
    content = stringify(DEFAULT_CONFIG);
  }
  
  writeFileSync(filename, content);
  console.log(Color.green(`${Symbols.success} Created ${filename}`));
}

/**
 * List categories command
 */
async function listCategories(options) {
  await Sites.load(options.sites);
  
  showBanner();
  
  console.log(Color.bold(' Available Categories'));
  console.log(UI.line('─', 50));
  console.log();
  
  const categories = Sites.getCategories();
  
  for (const cat of categories) {
    console.log(`  ${Color.cyan(Symbols.pointer)} ${Color.bold(cat.name)} ${Color.dim(`(${cat.count} sites)`)}`);
    
    if (options.verbose) {
      for (const site of cat.sites.slice(0, 5)) {
        console.log(`     ${Color.dim(site)}`);
      }
      if (cat.sites.length > 5) {
        console.log(`     ${Color.dim(`... and ${cat.sites.length - 5} more`)}`);
      }
      console.log();
    }
  }
  
  if (!options.verbose) {
    console.log();
    console.log(Color.dim('  Use --verbose to see sites in each category'));
  }
  
  console.log();
  
  const info = Sites.getInfo();
  console.log(Color.dim(`  Total: ${info.totalSites} sites | Loaded from: ${info.loadedFrom || 'defaults'}`));
  console.log();
}

// ============================================================================
// CLI Setup
// ============================================================================

const program = new Command();

program
  .name('browser-warmer')
  .description('Intelligent CLI tool for warming up browser profiles')
  .version(VERSION);

// Start command (interactive)
program
  .command('start')
  .description('Start browser warming session (interactive)')
  .option('-c, --config <path>', 'Path to config file')
  .option('-s, --sites <path>', 'Path to sites config file')
  .option('-y, --yes', 'Skip confirmation prompts')
  .action(interactiveStart);

// Run command (non-interactive)
program
  .command('run')
  .description('Run browser warming with command line options')
  .option('-c, --config <path>', 'Path to config file')
  .option('-s, --sites <path>', 'Path to sites config file')
  .option('--categories <list>', 'Site categories (comma-separated)', 'all')
  .option('--max-sites <n>', 'Maximum sites to visit', parseInt, 0)
  .option('--headless', 'Run in headless mode')
  .option('--no-headless', 'Run with visible browser')
  .option('--searches <n>', 'Number of searches', parseInt, 3)
  .option('--no-searches', 'Disable searches')
  .option('--ws', 'Enable WebSocket server')
  .option('--ws-port <port>', 'WebSocket port', parseInt, 8765)
  .option('-y, --yes', 'Skip confirmation')
  .action(async (options) => {
    showBanner();
    await showEnvironment();
    
    const overrides = {
      browser: {
        headless: options.headless,
      },
      sites: {
        categories: options.categories.split(',').map(s => s.trim()),
        maxSites: options.maxSites,
      },
      behavior: {
        searches: options.searches !== false,
        searchCount: typeof options.searches === 'number' ? options.searches : 3,
      },
      websocket: {
        enabled: options.ws || false,
        port: options.wsPort,
      },
    };
    
    await Sites.load(options.sites);
    await runSession(overrides, options);
  });

// Doctor command
program
  .command('doctor')
  .description('Diagnose system and configuration issues')
  .action(runDoctor);

// Init command
program
  .command('init')
  .description('Generate default configuration file')
  .option('-o, --output <file>', 'Output filename')
  .option('--json', 'Generate JSON instead of YAML')
  .action(generateConfig);

// Categories command
program
  .command('categories')
  .alias('list')
  .description('List available site categories')
  .option('-s, --sites <path>', 'Path to sites config file')
  .option('-v, --verbose', 'Show sites in each category')
  .action(listCategories);

// ============================================================================
// Dolphin Anty Commands
// ============================================================================

// Dolphin scan command
program
  .command('dolphin:scan')
  .description('Scan for running Dolphin Anty profiles')
  .option('--start-port <port>', 'Start port for scanning', parseInt, 9222)
  .option('--end-port <port>', 'End port for scanning', parseInt, 9322)
  .option('--host <host>', 'Host to scan', '127.0.0.1')
  .action(async (options) => {
    showBanner();
    
    console.log(Color.bold(' Scanning for Dolphin Anty profiles...'));
    console.log(UI.line('─', 50));
    console.log();
    
    const spinner = new Spinner().start('Scanning ports...');
    
    try {
      const profiles = await scanForDolphinProfiles(
        options.startPort,
        options.endPort,
        options.host
      );
      
      spinner.stop();
      
      if (profiles.length === 0) {
        console.log(Color.yellow(`${Symbols.warning} No running profiles found`));
        console.log(Color.dim('  Make sure Dolphin Anty profiles are running'));
        console.log();
        return;
      }
      
      console.log(Color.green(`${Symbols.success} Found ${profiles.length} running profile(s):`));
      console.log();
      
      for (const profile of profiles) {
        console.log(`  ${Color.cyan(Symbols.pointer)} Port ${Color.bold(profile.port)}`);
        console.log(`    ${Color.dim('Browser:')} ${profile.browser}`);
        console.log(`    ${Color.dim('Connect:')} browser-warmer dolphin:run --port ${profile.port}`);
        console.log();
      }
      
    } catch (error) {
      spinner.fail('Scan failed');
      console.log(Color.red(`Error: ${error.message}`));
    }
  });

// Dolphin list profiles command
program
  .command('dolphin:profiles')
  .description('List Dolphin Anty profiles via API')
  .option('--api-port <port>', 'Dolphin API port', parseInt, 3001)
  .option('--api-host <host>', 'Dolphin API host', 'localhost')
  .action(async (options) => {
    showBanner();
    
    console.log(Color.bold(' Dolphin Anty Profiles'));
    console.log(UI.line('─', 50));
    console.log();
    
    const spinner = new Spinner().start('Fetching profiles from Dolphin API...');
    
    try {
      const adapter = createDolphinAdapter({
        apiPort: options.apiPort,
        apiHost: options.apiHost,
      });
      
      const profiles = await adapter.listProfiles();
      
      spinner.stop();
      
      if (profiles.length === 0) {
        console.log(Color.yellow(`${Symbols.warning} No profiles found`));
        return;
      }
      
      console.log(Color.green(`${Symbols.success} Found ${profiles.length} profile(s):`));
      console.log();
      
      for (const profile of profiles) {
        const statusColor = profile.status === 'running' ? 'green' : 'dim';
        console.log(`  ${Color.cyan(Symbols.pointer)} ${Color.bold(profile.name)} ${Color[statusColor](`(${profile.status || 'stopped'})`)}`);
        console.log(`    ${Color.dim('ID:')} ${profile.id}`);
        console.log(`    ${Color.dim('Run:')} browser-warmer dolphin:run --profile-id ${profile.id}`);
        console.log();
      }
      
    } catch (error) {
      spinner.fail('Failed to fetch profiles');
      console.log(Color.red(`Error: ${error.message}`));
      console.log();
      console.log(Color.dim('Make sure Dolphin Anty is running and the API is enabled.'));
    }
  });

// Dolphin run command
program
  .command('dolphin:run')
  .description('Run browser warming on a Dolphin Anty profile')
  .option('--profile-id <id>', 'Dolphin profile ID (launches via API)')
  .option('--port <port>', 'Debug port of running profile', parseInt)
  .option('--ws <url>', 'WebSocket endpoint URL directly')
  .option('--api-port <port>', 'Dolphin API port', parseInt, 3001)
  .option('--api-host <host>', 'Dolphin API host', 'localhost')
  .option('-c, --config <path>', 'Path to config file')
  .option('-s, --sites <path>', 'Path to sites config file')
  .option('--categories <list>', 'Site categories (comma-separated)', 'all')
  .option('--max-sites <n>', 'Maximum sites to visit', parseInt, 0)
  .option('--searches <n>', 'Number of searches', parseInt, 3)
  .option('--no-searches', 'Disable searches')
  .option('--stop-profile', 'Stop Dolphin profile when done (only with --profile-id)')
  .option('-y, --yes', 'Skip confirmation')
  .action(async (options) => {
    showBanner();
    
    // Validate options
    if (!options.profileId && !options.port && !options.ws) {
      console.log(Color.red(`${Symbols.error} Must provide one of: --profile-id, --port, or --ws`));
      console.log();
      console.log(Color.bold('Examples:'));
      console.log(Color.dim('  # Connect via debug port (from running profile)'));
      console.log('  browser-warmer dolphin:run --port 9222');
      console.log();
      console.log(Color.dim('  # Start profile via Dolphin API'));
      console.log('  browser-warmer dolphin:run --profile-id abc123def456');
      console.log();
      console.log(Color.dim('  # Direct WebSocket connection'));
      console.log('  browser-warmer dolphin:run --ws ws://127.0.0.1:9222/devtools/browser/...');
      console.log();
      console.log(Color.dim('  # Find profiles first'));
      console.log('  browser-warmer dolphin:scan');
      console.log('  browser-warmer dolphin:profiles');
      console.log();
      process.exit(1);
    }
    
    // Show connection method
    console.log(Color.bold(' Dolphin Anty Connection'));
    console.log(UI.line('─', 50));
    
    const connInfo = [];
    if (options.profileId) {
      connInfo.push(['Method', 'API (will launch profile)']);
      connInfo.push(['Profile ID', options.profileId]);
      connInfo.push(['API', `${options.apiHost}:${options.apiPort}`]);
    } else if (options.port) {
      connInfo.push(['Method', 'Debug Port']);
      connInfo.push(['Port', options.port]);
    } else if (options.ws) {
      connInfo.push(['Method', 'WebSocket URL']);
      connInfo.push(['URL', options.ws.substring(0, 50) + '...']);
    }
    console.log(UI.keyValue(connInfo, { indent: 1 }));
    console.log();
    
    // Load config
    const overrides = {
      sites: {
        categories: options.categories.split(',').map(s => s.trim()),
        maxSites: options.maxSites,
      },
      behavior: {
        searches: options.searches !== false,
        searchCount: typeof options.searches === 'number' ? options.searches : 3,
      },
    };
    
    await Config.load({ configPath: options.config, overrides });
    await Sites.load(options.sites);
    
    // Show session config
    const config = Config.get();
    const sites = Sites.getSites(config.sites.categories, { maxSites: config.sites.maxSites, shuffle: false });
    
    console.log(Color.bold(' Session Configuration'));
    console.log(UI.line('─', 50));
    
    const summary = [
      ['Sites', `${sites.length} sites`],
      ['Categories', config.sites.categories.join(', ')],
      ['Searches', config.behavior.searches ? config.behavior.searchCount : 'Disabled'],
    ];
    console.log(UI.keyValue(summary, { indent: 1 }));
    console.log();
    
    // Confirm
    if (!options.yes) {
      const confirm = await Prompt.confirm({ message: 'Start warming session?', default: true });
      if (!confirm) {
        console.log(Color.yellow('Cancelled.'));
        process.exit(0);
      }
    }
    
    console.log();
    
    // Create Dolphin session
    const session = createDolphinSession({
      profileId: options.profileId,
      port: options.port,
      wsEndpoint: options.ws,
      apiPort: options.apiPort,
      apiHost: options.apiHost,
      sitesConfig: options.sites,
    });
    
    // Progress tracking
    let progressBar = null;
    
    session.on('initialized', () => {
      console.log(Color.green(`${Symbols.success} Connected to Dolphin profile`));
      console.log();
    });
    
    session.on('started', ({ siteCount }) => {
      console.log(Color.bold(' Progress'));
      console.log(UI.line('─', 50));
      progressBar = new ProgressBar({ total: siteCount, width: 40 });
      progressBar.start();
    });
    
    session.on('siteStart', ({ url, current }) => {
      const shortUrl = url.length > 40 ? url.substring(0, 37) + '...' : url;
      progressBar?.update(current - 1, shortUrl);
    });
    
    session.on('siteComplete', ({ current }) => {
      progressBar?.update(current);
    });
    
    session.on('error', (error) => {
      progressBar?.stop();
      console.log();
      console.log(Color.red(`${Symbols.error} Error: ${error.message}`));
    });
    
    session.on('completed', (stats) => {
      progressBar?.complete('Session complete!');
      showStats(stats);
    });
    
    session.on('stopped', (stats) => {
      progressBar?.stop('Session stopped');
      showStats(stats);
    });
    
    // Handle Ctrl+C
    let stopping = false;
    process.on('SIGINT', async () => {
      if (stopping) {
        console.log('\nForce exit...');
        process.exit(1);
      }
      stopping = true;
      console.log('\n\nStopping session...');
      await session.stop(options.stopProfile);
      process.exit(0);
    });
    
    // Run
    try {
      await session.initialize();
      await session.start();
    } catch (error) {
      log.error('Session failed', { error: error.message });
      process.exit(1);
    } finally {
      await session.stop(options.stopProfile);
    }
  });

// Parse and run
program.parse();

// Show help if no command
if (!process.argv.slice(2).length) {
  showBanner();
  program.outputHelp();
}
