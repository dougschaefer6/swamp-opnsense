import { z } from "npm:zod@4.3.6";
import {
  opnsenseApi,
  OPNsenseGlobalArgsSchema,
  sanitizeId,
} from "./_client.ts";

export const model = {
  type: "@dougschaefer/opnsense-firewall",
  version: "2026.04.04.1",
  globalArguments: OPNsenseGlobalArgsSchema,
  resources: {
    status: {
      description:
        "OPNsense system status: firmware, CPU, memory, uptime, gateway health",
      schema: z.object({
        hostname: z.string(),
        firmware: z.string(),
        series: z.string(),
        cpuUsage: z.string(),
        memoryActive: z.string(),
        memoryFree: z.string(),
        swap: z.string(),
        uptime: z.string(),
        loadAverage: z.string(),
        pfStates: z.string(),
        pfStateLimit: z.string(),
        gateways: z.array(z.object({
          name: z.string(),
          address: z.string(),
          status: z.string(),
          loss: z.string(),
          delay: z.string(),
        })),
      }),
      lifetime: "1h",
      garbageCollection: 5,
    },
    interface: {
      description:
        "Network interface with traffic stats, MTU, link state, and hardware offloads",
      schema: z.object({
        name: z.string(),
        device: z.string(),
        macaddr: z.string(),
        mtu: z.number(),
        linkRate: z.string(),
        flags: z.array(z.string()),
        capabilities: z.array(z.string()),
        options: z.array(z.string()),
        packetsReceived: z.number(),
        packetsSent: z.number(),
        bytesReceived: z.number(),
        bytesSent: z.number(),
        inputErrors: z.number(),
        outputErrors: z.number(),
        collisions: z.number(),
      }),
      lifetime: "1h",
      garbageCollection: 5,
    },
    dns: {
      description: "Unbound DNS resolver statistics",
      schema: z.object({
        totalQueries: z.number(),
        cacheHits: z.number(),
        cacheMisses: z.number(),
        cacheHitRate: z.number(),
        prefetches: z.number(),
        timedOut: z.number(),
        discardedTimeout: z.number(),
      }),
      lifetime: "1h",
      garbageCollection: 5,
    },
    tunable: {
      description: "System tunable (sysctl) with current and default values",
      schema: z.object({
        tunable: z.string(),
        value: z.string(),
        defaultValue: z.string(),
        description: z.string(),
        type: z.string(),
      }),
      lifetime: "1h",
      garbageCollection: 5,
    },
    "api-response": {
      description: "Raw API response from any OPNsense endpoint",
      schema: z.object({
        path: z.string(),
        method: z.string(),
        response: z.any(),
      }),
      lifetime: "1h",
      garbageCollection: 3,
    },
    service: {
      description: "OPNsense service with running state",
      schema: z.object({
        id: z.string(),
        name: z.string(),
        description: z.string(),
        running: z.boolean(),
        locked: z.boolean(),
      }),
      lifetime: "1h",
      garbageCollection: 5,
    },
    gateway: {
      description: "Gateway status with latency and packet loss",
      schema: z.object({
        name: z.string(),
        address: z.string(),
        status: z.string(),
        loss: z.string(),
        delay: z.string(),
        stddev: z.string(),
        interface: z.string(),
      }),
      lifetime: "1h",
      garbageCollection: 5,
    },
    "dhcp-lease": {
      description: "DHCP lease from dnsmasq or Kea",
      schema: z.object({
        address: z.string(),
        mac: z.string(),
        hostname: z.string(),
        starts: z.string(),
        ends: z.string(),
        status: z.string(),
      }),
      lifetime: "1h",
      garbageCollection: 5,
    },
    "arp-entry": {
      description: "ARP table entry",
      schema: z.object({
        ip: z.string(),
        mac: z.string(),
        manufacturer: z.string(),
        interface: z.string(),
        hostname: z.string(),
      }),
      lifetime: "1h",
      garbageCollection: 5,
    },
    firmware: {
      description: "Firmware and plugin information",
      schema: z.object({
        currentVersion: z.string(),
        needsUpdate: z.boolean(),
        plugins: z.array(z.object({
          name: z.string(),
          version: z.string(),
          installed: z.boolean(),
        })),
      }),
      lifetime: "1h",
      garbageCollection: 5,
    },
  },

  methods: {
    // =========================================================================
    // RAW API PASSTHROUGH — replaces MCP server entirely
    // =========================================================================

    api: {
      description:
        "Raw API passthrough — hit any OPNsense endpoint directly. Use for any operation not covered by a dedicated method. Path is relative to /api/ (e.g., 'tailscale/service/status').",
      arguments: z.object({
        path: z.string().describe(
          "API path after /api/ (e.g., 'core/firmware/status', 'tailscale/general/get')",
        ),
        method: z.enum(["GET", "POST"]).default("GET").describe(
          "HTTP method — GET for reads, POST for writes/actions",
        ),
        body: z.record(z.string(), z.any()).optional().describe(
          "POST body as JSON object (omit for GET requests)",
        ),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const path = args.path.startsWith("/") ? args.path : `/${args.path}`;

        const result = await opnsenseApi(path, g, {
          method: args.method,
          body: args.body,
        });

        context.logger.info("{method} /api{path} — OK", {
          method: args.method,
          path,
        });

        const handle = await context.writeResource(
          "api-response",
          sanitizeId(`api-${args.path}`),
          { path, method: args.method, response: result },
        );
        return { dataHandles: [handle] };
      },
    },

    // =========================================================================
    // SYSTEM
    // =========================================================================

    status: {
      description:
        "Get system status: firmware version, CPU/memory usage, uptime, gateway health, and PF state table size.",
      arguments: z.object({}),
      execute: async (_args, context) => {
        const g = context.globalArgs;

        const [firmware, gateways, activity, pfStates] = await Promise.all([
          opnsenseApi("/core/firmware/status", g) as Promise<
            Record<string, unknown>
          >,
          opnsenseApi("/routes/gateway/status", g) as Promise<
            Record<string, unknown>
          >,
          opnsenseApi("/diagnostics/activity/getActivity", g) as Promise<
            Record<string, unknown>
          >,
          opnsenseApi("/diagnostics/firewall/pf_states/0/1", g) as Promise<
            Record<string, unknown>
          >,
        ]);

        const product = firmware.product as Record<string, string> ?? {};
        const headers = (activity.headers as string[]) ?? [];

        const cpuLine = headers.find((h: string) => h.includes("CPU:")) ?? "";
        const memLine = headers.find((h: string) => h.includes("Mem:")) ?? "";
        const swapLine = headers.find((h: string) => h.includes("Swap:")) ??
          "";
        const uptimeLine =
          headers.find((h: string) => h.includes("load averages")) ?? "";

        const loadMatch = uptimeLine.match(/load averages:\s+([\d.,\s]+)/);
        const uptimeMatch = uptimeLine.match(/up\s+([\d+:]+)/);
        const memActive = memLine.match(/([\d.]+\w+)\s+Active/)?.[1] ??
          "unknown";
        const memFree = memLine.match(/([\d.]+\w+)\s+Free/)?.[1] ?? "unknown";
        const gwItems = (gateways.items as Array<Record<string, string>>) ?? [];

        const statusData = {
          hostname: product.product_name ?? "OPNsense",
          firmware: product.product_version ?? "unknown",
          series: product.product_series ?? "unknown",
          cpuUsage: cpuLine,
          memoryActive: memActive,
          memoryFree: memFree,
          swap: swapLine,
          uptime: uptimeMatch?.[1] ?? "unknown",
          loadAverage: loadMatch?.[1]?.trim() ?? "unknown",
          pfStates: String(pfStates.current ?? "unknown"),
          pfStateLimit: String(pfStates.limit ?? "unknown"),
          gateways: gwItems.map((gw) => ({
            name: gw.name,
            address: gw.address,
            status: gw.status_translated ?? gw.status,
            loss: gw.loss,
            delay: gw.delay,
          })),
        };

        context.logger.info(
          "OPNsense {version} — {states}/{limit} PF states, {gwCount} gateways",
          {
            version: statusData.firmware,
            states: statusData.pfStates,
            limit: statusData.pfStateLimit,
            gwCount: gwItems.length,
          },
        );

        const handle = await context.writeResource(
          "status",
          "system",
          statusData,
        );
        return { dataHandles: [handle] };
      },
    },

    reboot: {
      description:
        "Reboot the OPNsense appliance. Network will drop for 60-90 seconds.",
      arguments: z.object({}),
      execute: async (_args, context) => {
        const g = context.globalArgs;
        const result = await opnsenseApi("/core/system/reboot", g, {
          method: "POST",
          body: {},
        }) as Record<string, string>;

        context.logger.info("Reboot initiated: {status}", {
          status: result.status ?? "unknown",
        });

        const handle = await context.writeResource("api-response", "reboot", {
          path: "/core/system/reboot",
          method: "POST",
          response: result,
        });
        return { dataHandles: [handle] };
      },
    },

    // =========================================================================
    // SERVICES
    // =========================================================================

    services: {
      description: "List all services with their running state.",
      arguments: z.object({}),
      execute: async (_args, context) => {
        const g = context.globalArgs;
        const result = await opnsenseApi("/core/service/search", g) as Record<
          string,
          unknown
        >;
        const rows = (result.rows as Array<Record<string, unknown>>) ?? [];

        const handles = [];
        for (const svc of rows) {
          const data = {
            id: String(svc.id ?? ""),
            name: String(svc.name ?? ""),
            description: String(svc.description ?? ""),
            running: svc.running === 1 || svc.running === true,
            locked: svc.locked === 1 || svc.locked === true,
          };

          const handle = await context.writeResource(
            "service",
            sanitizeId(data.id || data.name),
            data,
          );
          handles.push(handle);
        }

        context.logger.info("Found {count} services", {
          count: handles.length,
        });
        return { dataHandles: handles };
      },
    },

    "service-control": {
      description:
        "Start, stop, or restart a service by name (e.g., 'unbound', 'dnsmasq', 'tailscale').",
      arguments: z.object({
        service: z.string().describe(
          "Service name (e.g., 'unbound', 'tailscale')",
        ),
        action: z.enum(["start", "stop", "restart", "status"]).describe(
          "Action to perform",
        ),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const opts = args.action === "status"
          ? { method: "GET" as const }
          : { method: "POST" as const, body: {} };

        const result = await opnsenseApi(
          `/core/service/${args.action}/${args.service}`,
          g,
          opts,
        ) as Record<string, unknown>;

        context.logger.info("Service {service}: {action} — {result}", {
          service: args.service,
          action: args.action,
          result: JSON.stringify(result),
        });

        const handle = await context.writeResource(
          "api-response",
          sanitizeId(`service-${args.service}-${args.action}`),
          {
            path: `/core/service/${args.action}/${args.service}`,
            method: opts.method,
            response: result,
          },
        );
        return { dataHandles: [handle] };
      },
    },

    // =========================================================================
    // FIRMWARE & PLUGINS
    // =========================================================================

    "firmware-status": {
      description:
        "Check firmware version, pending updates, and list installed plugins.",
      arguments: z.object({}),
      execute: async (_args, context) => {
        const g = context.globalArgs;

        const [status, plugins] = await Promise.all([
          opnsenseApi("/core/firmware/status", g) as Promise<
            Record<string, unknown>
          >,
          opnsenseApi("/core/firmware/info", g) as Promise<
            Record<string, unknown>
          >,
        ]);

        const product = status.product as Record<string, string> ?? {};
        const pkgList = (plugins.package as Array<Record<string, string>>) ??
          [];

        const installedPlugins = pkgList
          .filter((p) => p.installed === "1")
          .map((p) => ({
            name: p.name ?? "",
            version: p.version ?? "",
            installed: true,
          }));

        const data = {
          currentVersion: product.product_version ?? "unknown",
          needsUpdate: status.needs_reboot === "1" ||
            (status.updates ?? 0) > 0,
          plugins: installedPlugins,
        };

        context.logger.info(
          "Firmware {version}, {pluginCount} plugins installed",
          {
            version: data.currentVersion,
            pluginCount: installedPlugins.length,
          },
        );

        const handle = await context.writeResource(
          "firmware",
          "system",
          data,
        );
        return { dataHandles: [handle] };
      },
    },

    "firmware-install": {
      description:
        "Install an OPNsense plugin by package name (e.g., 'os-tailscale').",
      arguments: z.object({
        package: z.string().describe(
          "Plugin package name (e.g., 'os-tailscale', 'os-realtek-re-kmod')",
        ),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const result = await opnsenseApi(
          `/core/firmware/install/${args.package}`,
          g,
          { method: "POST", body: {} },
        ) as Record<string, unknown>;

        context.logger.info("Plugin install {pkg}: {status}", {
          pkg: args.package,
          status: JSON.stringify(result),
        });

        const handle = await context.writeResource(
          "api-response",
          sanitizeId(`firmware-install-${args.package}`),
          {
            path: `/core/firmware/install/${args.package}`,
            method: "POST",
            response: result,
          },
        );
        return { dataHandles: [handle] };
      },
    },

    // =========================================================================
    // NETWORK & INTERFACES
    // =========================================================================

    interfaces: {
      description:
        "List all network interfaces with traffic counters, MTU, link rate, hardware offloads, and error counts.",
      arguments: z.object({}),
      execute: async (_args, context) => {
        const g = context.globalArgs;

        const [overview, stats] = await Promise.all([
          opnsenseApi("/interfaces/overview/export", g) as Promise<
            Array<Record<string, unknown>>
          >,
          opnsenseApi("/diagnostics/traffic/interface", g) as Promise<
            Record<string, unknown>
          >,
        ]);

        const statsInterfaces = (stats.interfaces ?? {}) as Record<
          string,
          Record<string, unknown>
        >;
        const handles = [];

        for (const iface of overview) {
          const ifName =
            (iface.description ?? iface.identifier ?? "unknown") as string;
          const device =
            (iface.device ?? iface.identifier ?? "unknown") as string;
          const ifStats = statsInterfaces[device.toLowerCase()] ??
            statsInterfaces[ifName.toLowerCase()] ?? {};

          const data = {
            name: ifName,
            device,
            macaddr: (iface.macaddr ?? "unknown") as string,
            mtu: Number(iface.mtu ?? ifStats.mtu ?? 0),
            linkRate: (ifStats["line rate"] ?? "unknown") as string,
            flags: (iface.flags ?? []) as string[],
            capabilities: (iface.capabilities ?? []) as string[],
            options: (iface.options ?? []) as string[],
            packetsReceived: Number(ifStats["packets received"] ?? 0),
            packetsSent: Number(ifStats["packets transmitted"] ?? 0),
            bytesReceived: Number(ifStats["bytes received"] ?? 0),
            bytesSent: Number(ifStats["bytes transmitted"] ?? 0),
            inputErrors: Number(ifStats["input errors"] ?? 0),
            outputErrors: Number(ifStats["output errors"] ?? 0),
            collisions: Number(ifStats.collisions ?? 0),
          };

          context.logger.info(
            "Interface {name} ({device}): {rx} rx / {tx} tx bytes",
            {
              name: ifName,
              device,
              rx: data.bytesReceived,
              tx: data.bytesSent,
            },
          );

          const uniqueKey = sanitizeId(`${ifName}-${device}`);
          const handle = await context.writeResource(
            "interface",
            uniqueKey,
            data,
          );
          handles.push(handle);
        }

        return { dataHandles: handles };
      },
    },

    "gateway-status": {
      description:
        "Get gateway health with latency, packet loss, and dpinger metrics.",
      arguments: z.object({}),
      execute: async (_args, context) => {
        const g = context.globalArgs;
        const result = await opnsenseApi("/routes/gateway/status", g) as Record<
          string,
          unknown
        >;
        const gwItems = (result.items as Array<Record<string, string>>) ?? [];

        const handles = [];
        for (const gw of gwItems) {
          const data = {
            name: gw.name ?? "",
            address: gw.address ?? "",
            status: gw.status_translated ?? gw.status ?? "unknown",
            loss: gw.loss ?? "~",
            delay: gw.delay ?? "~",
            stddev: gw.stddev ?? "~",
            interface: gw.interface ?? "",
          };

          context.logger.info(
            "Gateway {name}: {status} — delay {delay}, loss {loss}",
            {
              name: data.name,
              status: data.status,
              delay: data.delay,
              loss: data.loss,
            },
          );

          const handle = await context.writeResource(
            "gateway",
            sanitizeId(data.name),
            data,
          );
          handles.push(handle);
        }

        return { dataHandles: handles };
      },
    },

    "arp-table": {
      description:
        "List ARP table entries with MAC addresses, hostnames, and manufacturers.",
      arguments: z.object({}),
      execute: async (_args, context) => {
        const g = context.globalArgs;
        const result = await opnsenseApi(
          "/diagnostics/interface/getArp",
          g,
        ) as Array<Record<string, string>>;

        const handles = [];
        for (const entry of result) {
          const data = {
            ip: entry.ip ?? "",
            mac: entry.mac ?? "",
            manufacturer: entry.manufacturer ?? "",
            interface: entry.intf ?? "",
            hostname: entry.hostname ?? "",
          };

          const handle = await context.writeResource(
            "arp-entry",
            sanitizeId(data.ip),
            data,
          );
          handles.push(handle);
        }

        context.logger.info("ARP table: {count} entries", {
          count: handles.length,
        });
        return { dataHandles: handles };
      },
    },

    "dhcp-leases": {
      description: "List active DHCP leases from dnsmasq.",
      arguments: z.object({}),
      execute: async (_args, context) => {
        const g = context.globalArgs;
        const result = await opnsenseApi(
          "/dnsmasq/leases/search",
          g,
          { method: "GET" },
        ) as Record<string, unknown>;
        const rows = (result.rows as Array<Record<string, string>>) ?? [];

        const handles = [];
        for (const lease of rows) {
          const data = {
            address: lease.address ?? "",
            mac: lease.mac ?? lease.hwaddr ?? "",
            hostname: lease.hostname ?? lease.client ?? "",
            starts: lease.starts ?? "",
            ends: lease.ends ?? "",
            status: lease.state ?? lease.status ?? "active",
          };

          const handle = await context.writeResource(
            "dhcp-lease",
            sanitizeId(data.address || data.mac),
            data,
          );
          handles.push(handle);
        }

        context.logger.info("DHCP leases: {count} active", {
          count: handles.length,
        });
        return { dataHandles: handles };
      },
    },

    // =========================================================================
    // FIREWALL
    // =========================================================================

    "firewall-states": {
      description: "Get PF firewall state table summary and statistics.",
      arguments: z.object({}),
      execute: async (_args, context) => {
        const g = context.globalArgs;
        const result = await opnsenseApi(
          "/diagnostics/firewall/pf_statistics",
          g,
        ) as Record<string, unknown>;

        context.logger.info("PF statistics retrieved");

        const handle = await context.writeResource(
          "api-response",
          "pf-statistics",
          {
            path: "/diagnostics/firewall/pf_statistics",
            method: "GET",
            response: result,
          },
        );
        return { dataHandles: [handle] };
      },
    },

    // =========================================================================
    // DNS
    // =========================================================================

    dns: {
      description:
        "Get Unbound DNS resolver statistics: query counts, cache hit rate, timeouts.",
      arguments: z.object({}),
      execute: async (_args, context) => {
        const g = context.globalArgs;
        const result = await opnsenseApi(
          "/unbound/diagnostics/stats",
          g,
        ) as Record<string, unknown>;
        const data = result.data as Record<
          string,
          Record<string, Record<string, string>>
        >;

        let totalQueries = 0;
        let cacheHits = 0;
        let cacheMisses = 0;
        let prefetches = 0;
        let timedOut = 0;
        let discardedTimeout = 0;

        for (const [threadName, thread] of Object.entries(data)) {
          if (!threadName.startsWith("thread")) continue;
          const num = thread.num as Record<string, string> | undefined;
          if (!num) continue;
          totalQueries += Number(num.queries ?? 0);
          cacheHits += Number(num.cachehits ?? 0);
          cacheMisses += Number(num.cachemiss ?? 0);
          prefetches += Number(num.prefetch ?? 0);
          timedOut += Number(num["queries_timed_out"] ?? 0);
          discardedTimeout += Number(num["queries_discard_timeout"] ?? 0);
        }

        const hitRate = totalQueries > 0
          ? Math.round((cacheHits / totalQueries) * 10000) / 100
          : 0;

        const dnsData = {
          totalQueries,
          cacheHits,
          cacheMisses,
          cacheHitRate: hitRate,
          prefetches,
          timedOut,
          discardedTimeout,
        };

        context.logger.info("DNS: {total} queries, {rate}% cache hit rate", {
          total: totalQueries,
          rate: hitRate,
        });

        const handle = await context.writeResource("dns", "unbound", dnsData);
        return { dataHandles: [handle] };
      },
    },

    // =========================================================================
    // TUNABLES
    // =========================================================================

    tunables: {
      description:
        "List all system tunables (sysctls) with current and default values.",
      arguments: z.object({}),
      execute: async (_args, context) => {
        const g = context.globalArgs;
        const result = await opnsenseApi("/core/tunables/get", g) as Record<
          string,
          unknown
        >;
        const items =
          ((result.sysctl as Record<string, unknown>)?.item ?? {}) as Record<
            string,
            Record<string, string>
          >;

        const handles = [];
        for (const [_id, item] of Object.entries(items)) {
          const data = {
            tunable: item.tunable,
            value: item.value || item.default_value,
            defaultValue: item.default_value,
            description: item.descr,
            type: item.type || "w",
          };

          const key = sanitizeId(item.tunable);
          const handle = await context.writeResource("tunable", key, data);
          handles.push(handle);
        }

        context.logger.info("Found {count} tunables", {
          count: handles.length,
        });
        return { dataHandles: handles };
      },
    },

    "set-tunable": {
      description:
        "Set an existing system tunable value. Calls reconfigure after saving.",
      arguments: z.object({
        tunable: z.string().describe(
          "Sysctl name (e.g., net.inet.tcp.recvspace)",
        ),
        value: z.string().describe("New value to set"),
        description: z.string().optional().describe(
          "Description (defaults to existing)",
        ),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;

        const result = await opnsenseApi("/core/tunables/get", g) as Record<
          string,
          unknown
        >;
        const items =
          ((result.sysctl as Record<string, unknown>)?.item ?? {}) as Record<
            string,
            Record<string, string>
          >;

        let targetId = "";
        let existing = {
          tunable: args.tunable,
          descr: "",
          type: "w",
          value: "",
          default_value: "",
        };
        for (const [id, item] of Object.entries(items)) {
          if (item.tunable === args.tunable) {
            targetId = id;
            existing = item;
            break;
          }
        }

        if (!targetId) {
          throw new Error(
            `Tunable "${args.tunable}" not found. Use add-tunable to create new tunables.`,
          );
        }

        const payload = {
          sysctl: {
            tunable: args.tunable,
            value: args.value,
            descr: args.description ?? existing.descr,
            type: existing.type || "w",
          },
        };

        const setResult = await opnsenseApi(
          `/core/tunables/setItem/${targetId}`,
          g,
          { method: "POST", body: payload },
        ) as Record<string, string>;

        if (setResult.result !== "saved") {
          throw new Error(
            `Failed to set tunable: ${JSON.stringify(setResult)}`,
          );
        }

        await opnsenseApi("/core/tunables/reconfigure", g, {
          method: "POST",
          body: {},
        });

        context.logger.info("Set {tunable} = {value} (was: {old})", {
          tunable: args.tunable,
          value: args.value,
          old: existing.value || existing.default_value,
        });

        const data = {
          tunable: args.tunable,
          value: args.value,
          defaultValue: existing.default_value ?? "",
          description: args.description ?? existing.descr,
          type: existing.type || "w",
        };

        const handle = await context.writeResource(
          "tunable",
          sanitizeId(args.tunable),
          data,
        );
        return { dataHandles: [handle] };
      },
    },

    "add-tunable": {
      description:
        "Add a new system tunable. Use type 'w' for runtime sysctls, 't' for boot-time loader tunables.",
      arguments: z.object({
        tunable: z.string().describe(
          "Sysctl/loader name (e.g., if_re_load, hw.re.max_rx_mbuf_sz)",
        ),
        value: z.string().describe("Value to set"),
        description: z.string().default("").describe("Description"),
        type: z.enum(["w", "t"]).default("w").describe(
          "'w' = runtime sysctl, 't' = boot-time loader tunable",
        ),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;

        const payload = {
          sysctl: {
            tunable: args.tunable,
            value: args.value,
            descr: args.description,
            type: args.type,
          },
        };

        const result = await opnsenseApi("/core/tunables/addItem", g, {
          method: "POST",
          body: payload,
        }) as Record<string, string>;

        if (result.result !== "saved" && !result.uuid) {
          throw new Error(
            `Failed to add tunable: ${JSON.stringify(result)}`,
          );
        }

        await opnsenseApi("/core/tunables/reconfigure", g, {
          method: "POST",
          body: {},
        });

        context.logger.info(
          "Added tunable {tunable} = {value} (type: {type})",
          {
            tunable: args.tunable,
            value: args.value,
            type: args.type,
          },
        );

        const data = {
          tunable: args.tunable,
          value: args.value,
          defaultValue: "",
          description: args.description,
          type: args.type,
        };

        const handle = await context.writeResource(
          "tunable",
          sanitizeId(args.tunable),
          data,
        );
        return { dataHandles: [handle] };
      },
    },

    // =========================================================================
    // TAILSCALE
    // =========================================================================

    "tailscale-get": {
      description: "Get Tailscale plugin configuration and service status.",
      arguments: z.object({}),
      execute: async (_args, context) => {
        const g = context.globalArgs;

        const [settings, status] = await Promise.all([
          opnsenseApi("/tailscale/settings/get", g) as Promise<
            Record<string, unknown>
          >,
          opnsenseApi("/tailscale/service/status", g).catch(() => ({
            status: "unknown",
          })) as Promise<Record<string, unknown>>,
        ]);

        context.logger.info("Tailscale config retrieved, service: {status}", {
          status: JSON.stringify(status),
        });

        const handle = await context.writeResource(
          "api-response",
          "tailscale-config",
          {
            path: "/tailscale/general/get",
            method: "GET",
            response: { settings, serviceStatus: status },
          },
        );
        return { dataHandles: [handle] };
      },
    },

    "tailscale-set": {
      description:
        "Configure Tailscale settings. Pass the settings object from tailscale-get, modified as needed.",
      arguments: z.object({
        settings: z.record(z.string(), z.any()).describe(
          "Tailscale settings object to save",
        ),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;

        const result = await opnsenseApi("/tailscale/settings/set", g, {
          method: "POST",
          body: args.settings,
        }) as Record<string, unknown>;

        // Apply configuration
        await opnsenseApi("/tailscale/service/reconfigure", g, {
          method: "POST",
          body: {},
        });

        context.logger.info("Tailscale settings updated: {result}", {
          result: JSON.stringify(result),
        });

        const handle = await context.writeResource(
          "api-response",
          "tailscale-set",
          {
            path: "/tailscale/general/set",
            method: "POST",
            response: result,
          },
        );
        return { dataHandles: [handle] };
      },
    },

    "tailscale-service": {
      description: "Start, stop, or restart the Tailscale service.",
      arguments: z.object({
        action: z.enum(["start", "stop", "restart", "reconfigure", "status"])
          .describe("Service action"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;
        const opts = args.action === "status"
          ? { method: "GET" as const }
          : { method: "POST" as const, body: {} };

        const result = await opnsenseApi(
          `/tailscale/service/${args.action}`,
          g,
          opts,
        ) as Record<string, unknown>;

        context.logger.info("Tailscale {action}: {result}", {
          action: args.action,
          result: JSON.stringify(result),
        });

        const handle = await context.writeResource(
          "api-response",
          sanitizeId(`tailscale-${args.action}`),
          {
            path: `/tailscale/service/${args.action}`,
            method: opts.method,
            response: result,
          },
        );
        return { dataHandles: [handle] };
      },
    },

    // =========================================================================
    // WIREGUARD
    // =========================================================================

    "wireguard-status": {
      description: "Get WireGuard tunnels, peers, and service status.",
      arguments: z.object({}),
      execute: async (_args, context) => {
        const g = context.globalArgs;

        const [general, status, show] = await Promise.all([
          opnsenseApi("/wireguard/general/get", g).catch(() => ({})) as Promise<
            Record<string, unknown>
          >,
          opnsenseApi("/wireguard/service/status", g).catch(() => ({
            status: "unknown",
          })) as Promise<Record<string, unknown>>,
          opnsenseApi("/wireguard/service/show", g).catch(
            () => ({}),
          ) as Promise<
            Record<string, unknown>
          >,
        ]);

        context.logger.info("WireGuard status retrieved");

        const handle = await context.writeResource(
          "api-response",
          "wireguard-status",
          {
            path: "/wireguard",
            method: "GET",
            response: { general, status, show },
          },
        );
        return { dataHandles: [handle] };
      },
    },
  },
};
