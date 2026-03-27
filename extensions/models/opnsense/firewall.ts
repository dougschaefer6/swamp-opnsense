import { z } from "npm:zod@4";
import { opnsenseApi, OPNsenseGlobalArgsSchema, sanitizeId } from "./_client.ts";

export const model = {
  type: "@dougschaefer/opnsense-firewall",
  version: "2026.03.27.2",
  globalArguments: OPNsenseGlobalArgsSchema,
  resources: {
    status: {
      description: "OPNsense system status: firmware, CPU, memory, uptime, gateway health",
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
      description: "Network interface with traffic stats, MTU, link state, and hardware offloads",
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
  },
  methods: {
    status: {
      description:
        "Get system status: firmware version, CPU/memory usage, uptime, gateway health, and PF state table size.",
      arguments: z.object({}),
      execute: async (_args, context) => {
        const g = context.globalArgs;

        const [firmware, gateways, activity, pfStates] = await Promise.all([
          opnsenseApi("/core/firmware/status", g) as Promise<Record<string, unknown>>,
          opnsenseApi("/routes/gateway/status", g) as Promise<Record<string, unknown>>,
          opnsenseApi("/diagnostics/activity/getActivity", g) as Promise<Record<string, unknown>>,
          opnsenseApi("/diagnostics/firewall/pf_states/0/1", g) as Promise<Record<string, unknown>>,
        ]);

        const product = firmware.product as Record<string, string> ?? {};
        const headers = (activity.headers as string[]) ?? [];

        const cpuLine = headers.find((h: string) => h.includes("CPU:")) ?? "";
        const memLine = headers.find((h: string) => h.includes("Mem:")) ?? "";
        const swapLine = headers.find((h: string) => h.includes("Swap:")) ?? "";
        const uptimeLine = headers.find((h: string) => h.includes("load averages")) ?? "";

        const loadMatch = uptimeLine.match(/load averages:\s+([\d.,\s]+)/);
        const uptimeMatch = uptimeLine.match(/up\s+([\d+:]+)/);
        const memActive = memLine.match(/([\d.]+\w+)\s+Active/)?.[1] ?? "unknown";
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

        const handle = await context.writeResource("status", "system", statusData);
        return { dataHandles: [handle] };
      },
    },

    interfaces: {
      description:
        "List all network interfaces with traffic counters, MTU, link rate, hardware offloads, and error counts.",
      arguments: z.object({}),
      execute: async (_args, context) => {
        const g = context.globalArgs;

        const [overview, stats] = await Promise.all([
          opnsenseApi("/interfaces/overview/export", g) as Promise<Array<Record<string, unknown>>>,
          opnsenseApi("/diagnostics/traffic/interface", g) as Promise<Record<string, unknown>>,
        ]);

        const statsInterfaces = (stats.interfaces ?? {}) as Record<string, Record<string, unknown>>;
        const handles = [];

        for (const iface of overview) {
          const ifName = (iface.description ?? iface.identifier ?? "unknown") as string;
          const device = (iface.device ?? iface.identifier ?? "unknown") as string;
          const ifStats = statsInterfaces[device.toLowerCase()] ?? statsInterfaces[ifName.toLowerCase()] ?? {};

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

          context.logger.info("Interface {name} ({device}): {rx} rx / {tx} tx bytes", {
            name: ifName,
            device,
            rx: data.bytesReceived,
            tx: data.bytesSent,
          });

          const uniqueKey = sanitizeId(`${ifName}-${device}`);
          const handle = await context.writeResource("interface", uniqueKey, data);
          handles.push(handle);
        }

        return { dataHandles: handles };
      },
    },

    dns: {
      description:
        "Get Unbound DNS resolver statistics: query counts, cache hit rate, timeouts.",
      arguments: z.object({}),
      execute: async (_args, context) => {
        const g = context.globalArgs;
        const result = await opnsenseApi("/unbound/diagnostics/stats", g) as Record<string, unknown>;
        const data = result.data as Record<string, Record<string, Record<string, string>>>;

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

        const hitRate = totalQueries > 0 ? Math.round((cacheHits / totalQueries) * 10000) / 100 : 0;

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

    tunables: {
      description:
        "List all system tunables (sysctls) with current and default values. Use set-tunable to modify.",
      arguments: z.object({}),
      execute: async (_args, context) => {
        const g = context.globalArgs;
        const result = await opnsenseApi("/core/tunables/get", g) as Record<string, unknown>;
        const items = ((result.sysctl as Record<string, unknown>)?.item ?? {}) as Record<string, Record<string, string>>;

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

        context.logger.info("Found {count} tunables", { count: handles.length });
        return { dataHandles: handles };
      },
    },

    "set-tunable": {
      description:
        "Set a system tunable value. Requires tunable name, value, and description. Calls reconfigure after saving.",
      arguments: z.object({
        tunable: z.string().describe("Sysctl name (e.g., net.inet.tcp.recvspace)"),
        value: z.string().describe("New value to set"),
        description: z.string().optional().describe("Description (defaults to existing)"),
      }),
      execute: async (args, context) => {
        const g = context.globalArgs;

        // Find the tunable's ID from the full list
        const result = await opnsenseApi("/core/tunables/get", g) as Record<string, unknown>;
        const items = ((result.sysctl as Record<string, unknown>)?.item ?? {}) as Record<string, Record<string, string>>;

        let targetId = "";
        let existing = { tunable: args.tunable, descr: "", type: "w", value: "" };
        for (const [id, item] of Object.entries(items)) {
          if (item.tunable === args.tunable) {
            targetId = id;
            existing = item;
            break;
          }
        }

        if (!targetId) {
          throw new Error(`Tunable "${args.tunable}" not found in OPNsense configuration`);
        }

        // OPNsense setItem requires the full sysctl object
        const payload = {
          sysctl: {
            tunable: args.tunable,
            value: args.value,
            descr: args.description ?? existing.descr,
            type: existing.type || "w",
          },
        };

        const setResult = await opnsenseApi(`/core/tunables/setItem/${targetId}`, g, {
          method: "POST",
          body: payload,
        }) as Record<string, string>;

        if (setResult.result !== "saved") {
          throw new Error(`Failed to set tunable: ${JSON.stringify(setResult)}`);
        }

        // Apply the change
        const reconfigResult = await opnsenseApi("/core/tunables/reconfigure", g, {
          method: "POST",
          body: {},
        }) as Record<string, string>;

        context.logger.info("Set {tunable} = {value} (was: {old}) — reconfigure: {status}", {
          tunable: args.tunable,
          value: args.value,
          old: existing.value || existing.default_value,
          status: reconfigResult.status ?? "unknown",
        });

        const data = {
          tunable: args.tunable,
          value: args.value,
          defaultValue: existing.default_value ?? "",
          description: args.description ?? existing.descr,
          type: existing.type || "w",
        };

        const handle = await context.writeResource("tunable", sanitizeId(args.tunable), data);
        return { dataHandles: [handle] };
      },
    },
  },
};
