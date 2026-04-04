# @dougschaefer/opnsense-firewall

A [Swamp](https://github.com/systeminit/swamp) extension model for full OPNsense firewall management through the REST API. Covers system status, firmware and plugin management, interface monitoring, DNS analytics, firewall state inspection, DHCP leases, ARP table, sysctl tunable management, Tailscale VPN, and WireGuard — plus a raw API passthrough method that can reach any of the ~1,850 OPNsense API endpoints directly.

## Methods

### Raw API Passthrough

| Method | Description |
|--------|-------------|
| `api` | Hit any OPNsense API endpoint directly. Accepts path, HTTP method, and optional JSON body. Replaces the need for a separate MCP server. |

### System

| Method | Description |
|--------|-------------|
| `status` | Firmware version, CPU/memory usage, uptime, load average, gateway health, PF state table |
| `reboot` | Reboot the appliance |
| `services` | List all services with running state |
| `service-control` | Start, stop, or restart any service by name |

### Firmware & Plugins

| Method | Description |
|--------|-------------|
| `firmware-status` | Current firmware version, pending updates, installed plugins |
| `firmware-install` | Install an OPNsense plugin by package name |

### Network

| Method | Description |
|--------|-------------|
| `interfaces` | All interfaces with traffic counters, MTU, link rate, hardware offload flags, error counts |
| `gateway-status` | Gateway health with dpinger latency, loss, and stddev |
| `arp-table` | ARP table with MAC addresses, manufacturers, and hostnames |
| `dhcp-leases` | Active DHCP leases from dnsmasq |
| `firewall-states` | PF firewall statistics |

### DNS

| Method | Description |
|--------|-------------|
| `dns` | Unbound resolver statistics: query counts, cache hit rate, prefetches, timeouts |

### Tunables

| Method | Description |
|--------|-------------|
| `tunables` | List all system tunables with current and default values |
| `set-tunable` | Modify an existing tunable and reconfigure |
| `add-tunable` | Add a new runtime sysctl or boot-time loader tunable |

### Tailscale VPN

| Method | Description |
|--------|-------------|
| `tailscale-get` | Get Tailscale configuration and service status |
| `tailscale-set` | Update Tailscale settings and reconfigure |
| `tailscale-service` | Start, stop, restart, or check Tailscale service status |

### WireGuard

| Method | Description |
|--------|-------------|
| `wireguard-status` | WireGuard tunnel and peer status |

All method outputs are written to swamp resources with automatic garbage collection, making them available to workflows and CEL expressions.

## Installation

```bash
swamp extension pull @dougschaefer/opnsense-firewall
```

## Setup

### 1. Create an OPNsense API key

In the OPNsense web UI, navigate to **System > Access > Users**, edit your admin user, and click **+** under API keys. Save the downloaded key and secret.

### 2. Create a vault and store credentials

```bash
swamp vault create local_encryption opnsense
swamp vault put opnsense api-key "YOUR_API_KEY"
swamp vault put opnsense api-secret "YOUR_API_SECRET"
```

### 3. Create a model instance

```bash
swamp model create @dougschaefer/opnsense-firewall my-firewall \
  --global-arg 'apiKey=${{ vault.get(opnsense, api-key) }}' \
  --global-arg 'apiSecret=${{ vault.get(opnsense, api-secret) }}' \
  --global-arg 'baseUrl=https://YOUR_OPNSENSE_IP'
```

### 4. Run methods

```bash
# System overview
swamp model method run my-firewall status --json

# Hit any API endpoint directly
swamp model method run my-firewall api --json \
  --input '{"path": "tailscale/status/status"}'

# POST with body
swamp model method run my-firewall api --json \
  --input '{"path": "core/system/reboot", "method": "POST", "body": {}}'

# Install a plugin
swamp model method run my-firewall firmware-install --json \
  --input '{"package": "os-tailscale"}'

# Add a boot tunable
swamp model method run my-firewall add-tunable --json \
  --input '{"tunable": "if_re_load", "value": "YES", "type": "t", "description": "Load Realtek kmod driver"}'

# Tailscale service control
swamp model method run my-firewall tailscale-service --json \
  --input '{"action": "status"}'
```

## Raw API Passthrough

The `api` method is the escape hatch that makes every OPNsense API endpoint accessible without needing a dedicated method. OPNsense exposes ~1,850 endpoints across 105+ modules. Common examples:

```bash
# Firmware info
swamp model method run my-firewall api --json \
  --input '{"path": "core/firmware/info"}'

# Unbound DNS config
swamp model method run my-firewall api --json \
  --input '{"path": "unbound/settings/get"}'

# Firewall aliases
swamp model method run my-firewall api --json \
  --input '{"path": "firewall/alias/searchItem"}'

# IDS/Suricata settings
swamp model method run my-firewall api --json \
  --input '{"path": "ids/settings/get"}'
```

Paths are relative to `/api/`. Use `GET` for reads and `POST` for writes/actions. The full OPNsense API reference is at [docs.opnsense.org/development/api.html](https://docs.opnsense.org/development/api.html).

## API Compatibility

Tested against OPNsense 26.1.5 on FreeBSD 14.3. Three implementation details are worth noting.

The extension uses a `curl` subprocess for HTTPS requests rather than Deno's native `fetch`, because OPNsense ships with self-signed certificates issued to a hostname while the appliance is typically accessed by IP. Deno's TLS stack cannot skip hostname verification in that scenario, so curl with `--insecure` is the reliable path. Set `verifySsl: true` if you have proper CA-signed certificates.

GET requests must not include a `Content-Type` header or the OPNsense API returns HTTP 400. The client strips that header automatically on GET.

Tunables use the `/api/core/tunables/*` endpoints, and the `setItem` call requires the full sysctl object (tunable name, value, description, and type) rather than just the changed field.

## Testing

Validated against a production OPNsense 26.1.5 appliance (Ryzen 5 NUC, dual Realtek NICs) in an ASEI lab environment. All 20 methods tested for correct API path resolution, response parsing, and resource output.

## License

MIT
