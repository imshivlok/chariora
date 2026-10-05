import dns from "node:dns/promises";
import { isPrivateHost, InputError } from "./normalize.js";

export const USER_AGENT = "CharioraBot/0.1 (+charity verification; read-only)";
const MAX_BYTES = 1_500_000;
const MAX_REDIRECTS = 3;

export interface PageFetch {
  ok: boolean;
  status?: number;
  finalUrl?: URL;
  chain: string[];
  headers: Record<string, string>;
  html: string;
  error?: string;
}

/** Rejects private/loopback hosts, including hostnames that RESOLVE to private IPs. */
export async function assertPublicHost(host: string) {
  if (isPrivateHost(host)) throw new InputError("Private or local addresses can't be checked.");
  const addrs = await dns.lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateHost(a.address.replace(/^::ffff:/, ""))))
    throw new InputError("That host resolves to a private address.");
}

async function readCapped(res: Response): Promise<string> {
  const type = res.headers.get("content-type") ?? "";
  if (!/text|html|xml/i.test(type) || !res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value); size += value.length;
  }
  reader.cancel().catch(() => {});
  return new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks));
}

/** Fetch a page with SSRF checks on every hop, a size cap, a timeout and at most 3 redirects. */
export async function fetchPage(start: URL, fetchImpl: typeof fetch = fetch, timeoutMs = 6000): Promise<PageFetch> {
  let url = start;
  const chain = [url.href];
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      await assertPublicHost(url.hostname);
      const res = await fetchImpl(url, {
        redirect: "manual",
        headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml" },
        signal: AbortSignal.timeout(timeoutMs),
      });
      const loc = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && loc) {
        if (hop === MAX_REDIRECTS) return { ok: false, chain, headers: {}, html: "", error: "Too many redirects" };
        url = new URL(loc, url);
        if (!/^https?:$/.test(url.protocol)) return { ok: false, chain, headers: {}, html: "", error: "Redirected to a non-web address" };
        chain.push(url.href);
        continue;
      }
      const headers: Record<string, string> = {};
      res.headers.forEach((v, k) => (headers[k.toLowerCase()] = v));
      const html = await readCapped(res);
      return { ok: res.status < 400, status: res.status, finalUrl: url, chain, headers, html, error: res.status >= 400 ? `HTTP ${res.status}` : undefined };
    }
  } catch (e) {
    return { ok: false, chain, headers: {}, html: "", error: (e as Error).message };
  }
  return { ok: false, chain, headers: {}, html: "", error: "Unreachable" };
}
