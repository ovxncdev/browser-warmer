# Browser Warmer

![Version](https://img.shields.io/badge/version-2.0.0-blue.svg)
![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-green.svg)
![Platform](https://img.shields.io/badge/platform-windows%20%7C%20macos%20%7C%20linux-lightgrey.svg)
![License](https://img.shields.io/badge/license-MIT-orange.svg)

**Intelligent browser profile warming with human-like browsing patterns**

Warm up browser profiles automatically with natural scrolling, mouse movements, and realistic timing. Supports standalone Chrome and Dolphin Anty anti-detect browser.

---

## Features

![Features](https://img.shields.io/badge/-%E2%9C%93%20Human--like%20Behavior-success.svg)
![Features](https://img.shields.io/badge/-%E2%9C%93%20Anti--Detection-success.svg)
![Features](https://img.shields.io/badge/-%E2%9C%93%20Dolphin%20Anty-success.svg)
![Features](https://img.shields.io/badge/-%E2%9C%93%20Cross--Platform-success.svg)

| Feature | Description |
|---------|-------------|
| **Human-like Behavior** | Natural scrolling, mouse movements, typing delays, and realistic timing patterns |
| **Anti-Detection** | Stealth mode with fingerprint randomization, passes bot detection |
| **Dolphin Anty Support** | Full integration with Dolphin Anty anti-detect browser profiles |
| **Cross-Platform** | Works on Windows, macOS, Linux, and Docker |
| **140+ Sites** | Pre-configured sites across 14 categories |
| **WebSocket API** | Remote control and real-time monitoring |

---

## Quick Start

### Installation

```bash
cd browser-warmer
npm install
```

### Dolphin Anty Mode

![Recommended](https://img.shields.io/badge/recommended-Dolphin%20Anty-blue.svg)

```bash
node src/index.js dolphin
```

### Standalone Chrome Mode

```bash
node src/index.js start
```

---

## Dolphin Anty Setup

![Requirement](https://img.shields.io/badge/requires-Starter%20Plan%20%2410%2Fmo-red.svg)

> **Note:** Free plan does not support automation. Starter plan ($10/month) or higher is required.

### Step 1: Get API Token

1. Open https://dolphin-anty.com/panel/#/api
2. Click **Generate Token**
3. Copy the token (starts with `eyJ...`)

### Step 2: Launch Dolphin Anty

The Dolphin Anty desktop app must be running for the Local API to work.

### Step 3: Run Browser Warmer

```bash
node src/index.js dolphin
```

Follow the prompts:

```
> Paste your Dolphin API token: eyJ...
> Select a profile (1-11): 1
> Select connection method (1-2): 1
> Select site categories (or "all"): all
> Maximum sites to visit (20): 10
> Perform search warm-up? (Y/n): y
> Start warming session? (Y/n): y
```

### Step 4: Watch It Work

The tool will:
- Launch your Dolphin profile automatically
- Perform search engine warm-up
- Visit sites with human-like behavior
- Display real-time progress

---

## Commands

### Interactive Commands

| Command | Description |
|---------|-------------|
| `node src/index.js dolphin` | Interactive Dolphin Anty mode |
| `node src/index.js start` | Interactive standalone Chrome mode |

### Non-Interactive Commands

| Command | Description |
|---------|-------------|
| `node src/index.js dolphin:run` | Run Dolphin warming with flags |
| `node src/index.js dolphin:profiles` | List Dolphin profiles |
| `node src/index.js dolphin:scan` | Scan for running browsers |
| `node src/index.js run` | Run Chrome warming with flags |
| `node src/index.js doctor` | System diagnostics |
| `node src/index.js categories` | List site categories |

### Command Options

```bash
# Dolphin Anty
node src/index.js dolphin:run \
  --profile-id 736132404 \
  --token eyJ... \
  --categories news,shopping,tech \
  --max-sites 20 \
  --searches 3 \
  -y

# Standalone Chrome
node src/index.js run \
  --categories all \
  --max-sites 30 \
  --headless
```

#### Option Reference

| Option | Description | Default |
|--------|-------------|---------|
| `--profile-id` | Dolphin profile ID | required |
| `--token` | Dolphin API token | required |
| `--categories` | Site categories (comma-separated) | `all` |
| `--max-sites` | Maximum sites to visit | `0` (unlimited) |
| `--searches` | Number of search warm-ups | `3` |
| `--no-searches` | Disable search warm-up | - |
| `--headless` | Run browser invisibly | `false` |
| `-y, --yes` | Skip confirmation prompts | - |

---

## Site Categories

![Sites](https://img.shields.io/badge/total-140%2B%20sites-blue.svg)
![Categories](https://img.shields.io/badge/categories-14-blue.svg)

| Category | Count | Examples |
|----------|-------|----------|
| `news` | 10 | CNN, BBC, Reuters, NPR |
| `shopping` | 10 | Amazon, eBay, Walmart, Target |
| `entertainment` | 10 | YouTube, Netflix, Spotify, Twitch |
| `social` | 10 | Reddit, LinkedIn, Pinterest, Twitter |
| `tech` | 10 | GitHub, Stack Overflow, HackerNews |
| `utilities` | 10 | Google, Weather.com, Maps |
| `reference` | 9 | Wikipedia, WebMD, Dictionary.com |
| `finance` | 10 | Bloomberg, Yahoo Finance, CNBC |
| `travel` | 10 | Booking.com, Expedia, Airbnb |
| `food` | 10 | AllRecipes, DoorDash, Yelp |
| `sports` | 10 | ESPN, NFL, NBA, Yahoo Sports |
| `education` | 10 | Coursera, Khan Academy, edX |
| `gaming` | 10 | Steam, IGN, Twitch, GameSpot |
| `misc` | 10 | Zillow, Indeed, Craigslist |

### Custom Sites

Add your own sites in `sites.yaml`:

```yaml
categories:
  custom:
    - https://mysite1.com
    - https://mysite2.com
    - https://mysite3.com
```

---

## Configuration

### Generate Config File

```bash
node src/index.js init
```

### Example Configuration

**browser-warmer.yaml**

```yaml
browser:
  headless: false
  profilePath: ./browser-profile

timing:
  minStay: 10
  maxStay: 60
  minWait: 5
  maxWait: 30

behavior:
  scroll: true
  clickLinks: true
  mouseMoves: true
  searches: true
  searchCount: 3

sites:
  categories:
    - news
    - shopping
    - tech
  maxSites: 50
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `DOLPHIN_TOKEN` | Dolphin API token |
| `BROWSER_WARMER_HEADLESS` | Run headless (`true`/`false`) |
| `BROWSER_WARMER_LOG_LEVEL` | Log level (`debug`/`info`/`warn`/`error`) |

---

## Project Structure

```
browser-warmer/
|-- src/
|   |-- index.js                # CLI entry point
|   |-- adapters/
|   |   |-- dolphin.js          # Dolphin Anty API
|   |   |-- dolphin-session.js  # Dolphin session manager
|   |-- core/
|   |   |-- browser.js          # Browser controller
|   |   |-- session.js          # Session manager
|   |   |-- actions.js          # Page interactions
|   |-- handlers/
|   |   |-- websocket.js        # WebSocket server
|   |-- ui/
|   |   |-- components.js       # UI elements
|   |   |-- prompts-simple.js   # CLI prompts
|   |-- utils/
|       |-- paths.js            # Path detection
|       |-- config.js           # Configuration
|       |-- logger.js           # Logging
|       |-- random.js           # Human-like randomization
|       |-- sites.js            # Sites loader
|-- sites.yaml                  # Sites configuration
|-- package.json
|-- README.md
```

---

## Troubleshooting

### Common Issues

| Error | Cause | Solution |
|-------|-------|----------|
| `initConnectionError` | Proxy not working | Create profile with "No Proxy" |
| `Cannot connect to port 3001` | Dolphin app not running | Open Dolphin Anty application |
| `Invalid session token` | Token expired | Generate new token |
| `HTTP 402` | Free plan | Upgrade to Starter ($10/mo) |

### Diagnostics

```bash
node src/index.js doctor
```

### Test Dolphin API

```bash
# Start profile
curl -X GET "http://localhost:3001/v1.0/browser_profiles/PROFILE_ID/start?automation=1"

# Stop profile  
curl -X GET "http://localhost:3001/v1.0/browser_profiles/PROFILE_ID/stop"
```

---

## API Reference

### Dolphin Anty APIs

| API | URL | Purpose |
|-----|-----|---------|
| Cloud API | `https://dolphin-anty-api.com` | List profiles, manage data |
| Local API | `http://localhost:3001` | Start/stop profiles |

### Start Profile Response

```json
{
  "success": true,
  "automation": {
    "port": 49633,
    "wsEndpoint": "/devtools/browser/xxxxx"
  }
}
```

---

## Requirements

![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-green.svg)
![Dolphin](https://img.shields.io/badge/dolphin-Starter%20%2410%2Fmo-blue.svg)

- Node.js 18.0.0 or higher
- Dolphin Anty Starter plan ($10/month) for automation
- Windows, macOS, or Linux

---

## License

![License](https://img.shields.io/badge/license-MIT-orange.svg)

MIT License - feel free to use and modify.
