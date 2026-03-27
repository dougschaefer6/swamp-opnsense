import { z } from "npm:zod@4";

/**
 * Shared OPNsense API client and schemas for extension models.
 *
 * Credentials are passed via globalArguments, typically resolved from vault:
 *   apiKey:    ${{ vault.get(opnsense, api-key) }}
 *   apiSecret: ${{ vault.get(opnsense, api-secret) }}
 *   baseUrl:   https://192.168.1.1 (or per-client firewall)
 *
 * Uses curl for HTTPS requests to handle self-signed certificates.
 * OPNsense ships with self-signed certs by default, and Deno's native fetch
 * cannot skip hostname verification — so curl with -k is the reliable path.
 *
 * API notes (OPNsense 26.1):
 *   - GET requests must NOT include Content-Type header (causes 400 "Invalid JSON syntax")
 *   - POST requests require Content-Type: application/json
 *   - Tunables endpoint is /api/core/tunables/* (not /api/core/sysctl/*)
 *   - Tunable setItem requires full object: {"sysctl":{"tunable":"...","value":"...","descr":"...","type":"w"}}
 */

export const OPNsenseGlobalArgsSchema = z.object({
  apiKey: z.string().describe(
    "OPNsense API key. Use: ${{ vault.get(opnsense, api-key) }}",
  ),
  apiSecret: z.string().describe(
    "OPNsense API secret. Use: ${{ vault.get(opnsense, api-secret) }}",
  ),
  baseUrl: z
    .string()
    .default("https://192.168.1.1")
    .describe("OPNsense base URL (e.g., https://192.168.1.1)"),
  verifySsl: z
    .boolean()
    .default(false)
    .describe("Verify TLS certificates (set false for self-signed certs)"),
});

export type OPNsenseGlobalArgs = z.infer<typeof OPNsenseGlobalArgsSchema>;

export async function opnsenseApi(
  path: string,
  globalArgs: OPNsenseGlobalArgs,
  options?: {
    method?: "GET" | "POST";
    body?: Record<string, unknown>;
    params?: Record<string, string>;
  },
): Promise<unknown> {
  const url = new URL(`/api${path}`, globalArgs.baseUrl);
  if (options?.params) {
    for (const [k, v] of Object.entries(options.params)) {
      if (v !== undefined && v !== "") url.searchParams.set(k, v);
    }
  }

  const method = options?.method ?? "GET";
  const args = [
    "-s",
    "-u",
    `${globalArgs.apiKey}:${globalArgs.apiSecret}`,
    "-H",
    "Accept: application/json",
  ];

  // Only send Content-Type on POST — GET with Content-Type causes OPNsense to
  // return 400 "Invalid JSON syntax" because it tries to parse a non-existent body.
  if (method === "POST") {
    args.push("-H", "Content-Type: application/json");
  }

  if (!globalArgs.verifySsl) {
    args.push("-k");
  }

  if (options?.body) {
    args.push("-d", JSON.stringify(options.body));
  }

  args.push(url.toString());

  const cmd = new Deno.Command("curl", {
    args,
    stdout: "piped",
    stderr: "piped",
  });
  const output = await cmd.output();

  if (!output.success) {
    const stderr = new TextDecoder().decode(output.stderr);
    throw new Error(`OPNsense API curl failed: ${stderr}`);
  }

  const body = new TextDecoder().decode(output.stdout);
  return JSON.parse(body);
}

export function sanitizeId(id: string): string {
  return id.toLowerCase().replace(/[^a-z0-9-]/g, "-");
}
