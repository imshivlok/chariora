import { parse } from "tldts";
import type { InputKind } from "../../shared/types.js";

export interface Normalized {
  kind: InputKind;
  raw: string;
  url?: URL;
  domain: string | null;
  name?: string;
}

const SOCIAL = ["instagram.com", "facebook.com", "twitter.com", "x.com", "youtube.com", "tiktok.com", "linkedin.com", "t.me", "wa.me", "whatsapp.com"];

export class InputError extends Error {}

export function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "::" || h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (h === "::1" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80")) return h.includes(":");
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  if (/^\d+$/.test(h) || /^0x[0-9a-f]+$/i.test(h)) return true; // decimal/hex IP tricks
  return false;
}

export function normalizeInput(input: string): Normalized {
  const raw = input.trim();
  if (!raw) throw new InputError("Enter a website, charity name, or social profile link.");
  if (raw.length > 500) throw new InputError("Input is too long.");

  const scheme = raw.match(/^([a-z][a-z0-9+.-]*):\/\//i);
  if (scheme && !/^https?$/i.test(scheme[1])) throw new InputError("Only http and https links are supported.");

  const looksLikeUrl = !!scheme || (!/\s/.test(raw) && /^[^\s/]+\.[a-z]{2,}(\/|$|\?|#|:)/i.test(raw));
  if (!looksLikeUrl) return { kind: "name", raw, domain: null, name: raw };

  let url: URL;
  try {
    url = new URL(scheme ? raw : `https://${raw}`);
  } catch {
    throw new InputError("That doesn't look like a valid link.");
  }
  if (url.username || url.password) throw new InputError("Links with credentials are not supported.");
  if (isPrivateHost(url.hostname)) throw new InputError("Private or local addresses can't be checked.");

  const parsed = parse(url.hostname);
  if (!parsed.domain || !parsed.isIcann) throw new InputError("Could not find a public domain in that link.");
  const domain = parsed.domain.toLowerCase();
  const kind: InputKind = SOCIAL.includes(domain) ? "social" : "url";
  return { kind, raw, url, domain };
}
