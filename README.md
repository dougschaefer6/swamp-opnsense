# swamp-opnsense

A [Swamp](https://github.com/systeminit/swamp) extension model for managing OPNsense firewalls via the REST API.

## What It Does

This extension provides a `@dougschaefer/opnsense-firewall` model type with five methods for monitoring and tuning OPNsense appliances:

| Method | Description |
|--------|-------------|
| `status` | System status: firmware version, CPU/memory usage, uptime, gateway health, PF state table |
| `interfaces` | All network interfaces with traffic counters, MTU, link rate, hardware offloads, error counts |
| `dns` | Unbound DNS resolver statistics: query counts, cache hit rate, timeouts |
| `tunables` | List all system tunables (sysctls) with current and default values |
| `set-tunable` | Modify a system tunable and apply the change |

Data is written to swamp resources with 1-hour TTL and automatic garbage collection, making it available to workflows and CEL expressions across the repo.

## Installation

Copy the `extensions/models/opnsense/` directory into your swamp repository:

```bash
cp -r extensions/models/opnsense/ /path/to/your-swamp-repo/extensions/models/opnsense/
```

Swamp discovers models automatically from `extensions/models/**/*.ts` on startup.

## Setup

### 1. Create an OPNsense API key

In OPNsense, go to **System > Access > Users**, edit your user, and click **+** under API keys. Save the downloaded key file.

### 2. Create a vault and store credentials

```bash
swamp vault create local_encryption opnsense
swamp vault put opnsense api-key="YOUR_API_KEY" -f
swamp vault put opnsense api-secret="YOUR_API_SECRET" -f
```

### 3. Create a model instance

```bash
swamp model create @dougschaefer/opnsense-firewall my-firewall \
  --global-arg 'apiKey=${{ vault.get(opnsense, api-key) }}' \
  --global-arg 'apiSecret=${{ vault.get(opnsense, api-secret) }}' \
  --global-arg 'baseUrl=https://192.168.1.1'
```

### 4. Run methods

```bash
swamp model method run my-firewall status --json
swamp model method run my-firewall interfaces --json
swamp model method run my-firewall dns --json
swamp model method run my-firewall tunables --json
```

## API Compatibility

Tested against OPNsense 26.1.2 on FreeBSD 14. Key API notes:

- Uses `curl` subprocess for HTTPS requests to handle self-signed certificates (OPNsense default). Deno's native `fetch` cannot skip hostname verification when the cert is issued to a hostname (e.g., `OPNsense.internal`) but accessed by IP.
- GET requests must not include a `Content-Type` header or OPNsense returns 400.
- Tunables use `/api/core/tunables/*` endpoints and require the full `sysctl` object for `setItem`.

## Multi-Tenant Usage

The model is designed for MSP use. Create one vault per client with their OPNsense credentials, then create instances per appliance:

```bash
swamp vault create local_encryption client-a-opnsense
swamp vault put client-a-opnsense api-key="..." -f
swamp vault put client-a-opnsense api-secret="..." -f

swamp model create @dougschaefer/opnsense-firewall client-a-fw1 \
  --global-arg 'apiKey=${{ vault.get(client-a-opnsense, api-key) }}' \
  --global-arg 'apiSecret=${{ vault.get(client-a-opnsense, api-secret) }}' \
  --global-arg 'baseUrl=https://10.0.1.1'
```

## Companion MCP Server

For interactive AI-assisted firewall management, pair this extension with the [@richard-stovall/opnsense-mcp-server](https://github.com/Pixelworlds/opnsense-mcp-server) (24 core tools, full OPNsense API coverage). The MCP server handles ad-hoc queries; the swamp extension handles structured automation and state tracking.

## License

MIT
