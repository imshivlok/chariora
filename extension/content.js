/* Chariora content script: detects donation-looking pages and shows a small banner when the verdict is Suspicious or worse.
 * Only the site origin is ever sent out (via the service worker). Page content stays in the browser. */
(async () => {
  const C = window.ChariCore;
  if (!C || window.top !== window || !C.isCheckableUrl(location.href)) return;
  const s = await chrome.storage.sync.get(C.DEFAULTS);
  if (!s.autoCheck) return;
  try { if (new URL(C.cleanBase(s.webBase) || C.DEFAULTS.webBase).origin === location.origin) return; } catch (e) { /* ignore */ }

  const text = (el) => (el.textContent || el.value || "").trim().slice(0, 60);
  const input = {
    url: location.href,
    title: document.title,
    headings: [...document.querySelectorAll("h1,h2")].slice(0, 8).map(text),
    buttons: [...document.querySelectorAll("a,button,input[type=submit]")].slice(0, 150).map(text),
  };
  if (!C.looksLikeDonationPage(input)) return;

  const key = C.cacheKey(location.href), dkey = "dismissed:" + key;
  const dismissed = (await chrome.storage.local.get(dkey))[dkey];
  if (dismissed && Date.now() - dismissed < C.DISMISS_TTL_MS) return;

  const resp = await chrome.runtime.sendMessage({ type: "check", target: location.origin }).catch(() => null);
  if (!resp || !resp.ok || !C.shouldWarn(resp.result)) return;
  showBanner(resp.result, C.buildReportUrl(s.webBase, location.origin), dkey);

  function showBanner(r, reportUrl, dismissKey) {
    const bad = C.verdictTone(r.verdict) === "bad";
    const host = document.createElement("div");
    host.id = "chariora-banner-host";
    const root = host.attachShadow({ mode: "closed" }); // isolates our styles from the page, and the page from us
    const style = document.createElement("style");
    style.textContent = `
      .bar{all:initial;position:fixed;top:12px;right:12px;z-index:2147483647;max-width:380px;box-sizing:border-box;display:flex;gap:12px;align-items:flex-start;
        font:14px/1.4 system-ui,-apple-system,Segoe UI,sans-serif;color:#0d2829;background:#fff;border:2px solid ${bad ? "#c8402f" : "#d99a00"};border-radius:14px;padding:12px 14px;box-shadow:0 8px 28px rgba(0,0,0,.22)}
      .dot{flex:none;width:34px;height:34px;border-radius:50%;display:grid;place-items:center;font-weight:800;color:#fff;background:${bad ? "#c8402f" : "#d99a00"}}
      b{display:block;font-size:14px} p{margin:2px 0 8px;color:#4f6967;font-size:12.5px}
      a,button{font:600 13px system-ui,sans-serif;cursor:pointer;border-radius:8px;padding:6px 10px;text-decoration:none}
      a{background:#0e7c7b;color:#fff;border:0} button{background:transparent;border:1px solid #cfdcda;color:#0d2829;margin-left:6px}
      a:focus-visible,button:focus-visible{outline:3px solid #0e7c7b;outline-offset:2px}`;
    const bar = document.createElement("div"); bar.className = "bar"; bar.setAttribute("role", "alert");
    const dot = document.createElement("div"); dot.className = "dot"; dot.textContent = "!"; dot.setAttribute("aria-hidden", "true");
    const body = document.createElement("div");
    const title = document.createElement("b"); title.textContent = "Chariora: " + r.verdict + " (" + r.score + "/100)";
    const msg = document.createElement("p"); msg.textContent = "Check this site carefully before you donate. This is a risk indicator, not a legal finding.";
    const more = document.createElement("a"); more.href = reportUrl; more.target = "_blank"; more.rel = "noopener noreferrer"; more.textContent = "See full report";
    const close = document.createElement("button"); close.type = "button"; close.textContent = "Dismiss";
    close.addEventListener("click", () => { chrome.storage.local.set({ [dismissKey]: Date.now() }); host.remove(); });
    body.append(title, msg, more, close);
    bar.append(dot, body);
    root.append(style, bar);
    document.documentElement.appendChild(host);
  }
})();
