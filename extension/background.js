/* Chariora service worker. The only place that talks to the Chariora API. */
importScripts("lib/core.js");
const C = self.ChariCore;
const inflight = new Map();
const API_TIMEOUT_MS = 20000;

chrome.runtime.onInstalled.addListener(async () => {
  const cur = await chrome.storage.sync.get(null);
  await chrome.storage.sync.set({ ...C.DEFAULTS, ...cur });
});

async function settings() { return chrome.storage.sync.get(C.DEFAULTS); }

async function pruneCache() {
  const all = await chrome.storage.local.get(null);
  const stale = Object.entries(all).filter(([k, v]) => k.startsWith("cache:") && !C.isFresh(v)).map(([k]) => k);
  if (stale.length) await chrome.storage.local.remove(stale);
}

async function callApi(target, apiBase) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), API_TIMEOUT_MS);
  try {
    const res = await fetch(apiBase + "/api/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ target }), signal: ctl.signal });
    if (res.status === 429) throw new Error("Too many checks right now. Try again in a minute.");
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || "The Chariora server returned an error (" + res.status + ").");
    return body;
  } catch (e) {
    if (e.name === "AbortError") throw new Error("The check took too long. Try again.");
    if (e.name === "TypeError") throw new Error("Couldn't reach the Chariora server at " + apiBase + ". Is it running?");
    throw e;
  } finally { clearTimeout(timer); }
}

async function check(target, force) {
  const key = C.cacheKey(target);
  if (!force) {
    const hit = (await chrome.storage.local.get("cache:" + key))["cache:" + key];
    if (C.isFresh(hit)) return { ok: true, result: hit.result, cached: true };
  }
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    try {
      const { apiBase } = await settings();
      const full = await callApi(target, C.cleanBase(apiBase) || C.DEFAULTS.apiBase);
      const result = C.slimResult(full);
      if (!full.partial) { await chrome.storage.local.set({ ["cache:" + key]: { at: Date.now(), result } }); pruneCache().catch(() => {}); }
      return { ok: true, result, partial: !!full.partial };
    } catch (e) {
      return { ok: false, error: e.message };
    } finally { inflight.delete(key); }
  })();
  inflight.set(key, p);
  return p;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== "check" || typeof msg.target !== "string" || !C.isCheckableUrl(msg.target)) return false;
  check(C.targetFor(msg.target), !!msg.force).then((out) => {
    if (out.ok && sender.tab && sender.tab.id != null) {
      const b = C.badgeFor(out.result.verdict);
      chrome.action.setBadgeText({ tabId: sender.tab.id, text: b.text }).catch(() => {});
      chrome.action.setBadgeBackgroundColor({ tabId: sender.tab.id, color: b.color }).catch(() => {});
    }
    sendResponse(out);
  });
  return true; // async response
});
