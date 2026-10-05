(() => {
  const C = window.ChariCore;
  const $ = (id) => document.getElementById(id);
  const NS = "http://www.w3.org/2000/svg";
  const COLORS = { good: "var(--green)", warn: "var(--amber)", bad: "var(--red)" };
  let tabUrl = null, webBase = C.DEFAULTS.webBase;

  const arc = (from, to, r = 80, cx = 100, cy = 100) => {
    const p = (s) => { const a = Math.PI * (1 - s / 100); return [cx + r * Math.cos(a), cy - r * Math.sin(a)]; };
    const [x1, y1] = p(from), [x2, y2] = p(to);
    return `M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`;
  };
  function el(name, attrs) { const e = document.createElementNS(NS, name); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; }

  /** Mini speedometer: red / amber / green zones and a needle. score = null shows a resting needle. */
  function drawGauge(score) {
    const svg = el("svg", { viewBox: "0 0 200 112", width: "100%" });
    svg.append(
      el("path", { d: arc(0, 100), stroke: "var(--line)", "stroke-width": 18, fill: "none", "stroke-linecap": "round" }),
      el("path", { d: arc(1.5, 38.5), stroke: "var(--red)", "stroke-width": 14, fill: "none" }),
      el("path", { d: arc(41.5, 63.5), stroke: "var(--amber)", "stroke-width": 14, fill: "none" }),
      el("path", { d: arc(66.5, 98.5), stroke: "var(--green)", "stroke-width": 14, fill: "none" }));
    const needle = el("g", { style: "transform-origin:100px 100px;transition:transform .8s cubic-bezier(.2,1.3,.4,1)" });
    needle.append(el("path", { d: "M 95 100 L 100 34 L 105 100 Z", fill: "var(--ink)" }));
    svg.append(needle, el("circle", { cx: 100, cy: 100, r: 7, fill: "var(--ink)" }));
    const txt = el("text", { x: 100, y: 78, "text-anchor": "middle", "font-size": 26, "font-weight": 800, fill: "var(--ink)" });
    txt.textContent = score === null ? "--" : String(score);
    svg.append(txt);
    needle.style.transform = "rotate(-90deg)";
    $("gauge").replaceChildren(svg);
    if (score !== null) requestAnimationFrame(() => requestAnimationFrame(() => { needle.style.transform = `rotate(${C.needleAngle(score)}deg)`; }));
  }

  function showError(msg) {
    $("error").textContent = msg; $("error").hidden = false;
    $("verdict").textContent = ""; $("meta").textContent = "";
    $("recheck").hidden = false; $("report").hidden = true;
    $("verdict").classList.remove("loading");
    drawGauge(null);
  }

  function showResult(r, cached) {
    $("error").hidden = true;
    $("verdict").classList.remove("loading");
    $("verdict").textContent = r.verdict;
    $("verdict").style.color = COLORS[C.verdictTone(r.verdict)];
    const src = r.registry ? `Found in registry${r.registry.id ? ", EIN " + r.registry.id : ""}` : "Not in any registry, analyzed by Chariora";
    $("meta").textContent = `${src}. Confidence: ${r.confidence}.${cached ? " (saved result)" : ""}`;
    drawGauge(r.score);
    $("report").hidden = false; $("recheck").hidden = false;
  }

  async function run(force) {
    $("error").hidden = true; $("report").hidden = true; $("recheck").hidden = true;
    $("verdict").style.color = ""; $("verdict").textContent = "Checking..."; $("verdict").classList.add("loading"); $("meta").textContent = "";
    drawGauge(null);
    const resp = await chrome.runtime.sendMessage({ type: "check", target: tabUrl, force }).catch(() => null);
    if (!resp) return showError("The extension couldn't reach its background worker. Reload the extension and try again.");
    if (!resp.ok) return showError(resp.error);
    showResult(resp.result, resp.cached);
  }

  async function init() {
    const s = await chrome.storage.sync.get(C.DEFAULTS);
    webBase = C.cleanBase(s.webBase) || C.DEFAULTS.webBase;
    $("autoCheck").checked = !!s.autoCheck; $("apiBase").value = s.apiBase; $("webBase").value = s.webBase;
    $("autoCheck").addEventListener("change", (e) => chrome.storage.sync.set({ autoCheck: e.target.checked }));
    $("save").addEventListener("click", async () => {
      const api = C.cleanBase($("apiBase").value), web = C.cleanBase($("webBase").value);
      const msg = $("saveMsg");
      if (!api || !web) { msg.textContent = "Both URLs must start with http:// or https://"; msg.style.color = "var(--red)"; return; }
      await chrome.storage.sync.set({ apiBase: api, webBase: web });
      $("apiBase").value = api; $("webBase").value = web; webBase = web;
      msg.textContent = "Saved."; msg.style.color = "var(--green)";
    });
    $("recheck").addEventListener("click", () => run(true));
    $("report").addEventListener("click", () => { chrome.tabs.create({ url: C.buildReportUrl(webBase, C.targetFor(tabUrl)) }); window.close(); });

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tabUrl = tab && tab.url;
    if (!tabUrl || !C.isCheckableUrl(tabUrl)) {
      $("domain").textContent = "";
      $("verdict").textContent = "Can't check this page";
      $("meta").textContent = "Open a public website, such as a donation page, and click the icon again.";
      drawGauge(null);
      return;
    }
    $("domain").textContent = new URL(tabUrl).hostname;
    run(false);
  }
  init();
})();
