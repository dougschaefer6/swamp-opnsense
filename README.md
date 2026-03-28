# @dougschaefer/opnsense-firewall

A [Swamp](https://github.com/systeminit/swamp) extension model that monitors and tunes OPNsense firewalls through the REST API. It pulls system status (firmware version, CPU and memory utilization, uptime, gateway health, and PF state table size), interface traffic statistics with hardware offload details, Unbound DNS resolver analytics including cache hit rates and query timeouts, and full sysctl tunable management with both read and write operations.

## Methods

| Method | Description |
|--------|-------------|
| `status` | System status: firmware version, CPU/memory usage, uptime, load average, gateway health with loss and delay, PF state table current count and limit |
| `interfaces` | All network interfaces with traffic counters, MTU, link rate, MAC address, hardware offload flags, capabilities, and error counts |
| `dns` | Unbound DNS resolver statistics: total queries, cache hits, cache misses, computed hit rate percentage, prefetches, and query timeouts |
| `tunables` | List all system tunables (sysctls) with current value, default value, description, and type (kernel "w" vs. boot "t") |
| `set-tunable` | Look up a tunable by name, submit the updated value, and call reconfigure automatically. Kernel tunables (type "w") take effect immediately, while boot tunables (type "t") require a reboot. |

All method outputs are written to swamp resources with 1-hour TTL and automatic garbage collection, making them available to workflows and CEL expressions across the repository.

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
swamp vault put opnsense api-key="YOUR_API_KEY" -f
swamp vault put opnsense api-secret="YOUR_API_SECRET" -f
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
swamp model method run my-firewall status --json
swamp model method run my-firewall interfaces --json
swamp model method run my-firewall dns --json
swamp model method run my-firewall tunables --json
swamp model method run my-firewall set-tunable \
  --arg 'tunable=net.inet.tcp.recvspace' \
  --arg 'value=131072' --json
```

## API Compatibility

Tested against OPNsense 26.1.2 running on FreeBSD 14. Three implementation details are worth calling out.

The extension uses a `curl` subprocess for all HTTPS requests rather than Deno's native `fetch`, because OPNsense ships with self-signed certificates issued to a hostname and the appliance is typically accessed by IP. Deno's TLS stack cannot skip hostname verification in that scenario, so curl with `--insecure` handles the connection instead.

GET requests must not include a `Content-Type` header or the OPNsense API returns HTTP 400. The client strips that header automatically on GET.

Tunables use the `/api/core/tunables/*` endpoints, and the `setItem` call requires the full sysctl object (tunable name, value, description, and type) rather than just the changed field.

## License

MIT
