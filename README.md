# Chariora

Tells people whether a charity or donation page is legitimate or a scam. Paste a website, a charity name or a social profile link and get a 0-100 trust score, a plain-language verdict and every signal behind it.

React + Vite + Tailwind web app, Express + TypeScript API, and a Manifest V3 Chrome extension that uses the same API.

## Quick start (about 3 minutes)

```bash
npm run install:all
cp .env.example .env      # optional: add LLM and provider keys (see below)
npm run dev               # API on :8787, web app on :5173 (also packs the extension zip)
```

Open http://localhost:5173 and try `redcross.org`, a charity name, or a social profile link.

```bash
npm test                  # 97 unit and API tests
npm run demo              # 3-case demo (see "Demo script")
```

## Environment variables

Everything is optional. With none set the app still runs; it skips the AI signal and every provider whose key is missing, and lowers its confidence level.

| Variable | Purpose |
|---|---|
| `PORT` | API port (default 8787) |
| `TRUST_PROXY` | Set to `1` behind a proxy so per-IP rate limiting sees real client IPs |
| `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` | Any OpenAI-compatible chat completions endpoint. `.env.example` has a ready block for Google Gemini (Flash / Flash-Lite model name from Google AI Studio) and one for a local Omniroute. The LLM is only called from the backend, once per analysis, and is capped at about 25% of the score. |
| `SAFE_BROWSING_API_KEY` | Google Safe Browsing. A hit forces the lowest tier. |
| `YOUTUBE_API_KEY` | YouTube channel age, video count and upload history |
| `CHARITY_COMMISSION_API_KEY` | UK Charity Commission register |
| `CHARITY_NAVIGATOR_API_KEY` | Charity Navigator rating |

Keys are read from `.env` on the server and are never sent to the browser or the extension.

## How a check works

1. **Normalize** the input and block private IPs, localhost and non-http(s) schemes (SSRF protection).
2. **Registry first**: ProPublica Nonprofit Explorer (and UK Charity Commission / Charity Navigator when keys exist). A name match alone is never "verified"; the domain must match too, otherwise it is flagged as impersonation risk.
3. **Own analysis** (no registry match, or domain mismatch): domain age and WHOIS (RDAP), lookalike names, TLS and redirects, Safe Browsing, page content (template text, missing trust info, implausible numbers, risky payment methods, pressure language), social profile verification, and one LLM judgment.
4. **Score**: weighted 0-100. Tiers: 85-100 Verified Charity (registry and domain match only), 65-84 Likely Legitimate, 40-64 Suspicious, 20-39 Likely Fake, 0-19 Almost Certainly a Scam.

`POST /api/analyze {target}` returns the full JSON verdict. `GET /api/analyze/stream?target=...` streams progress as Server-Sent Events, then the result. Rate limit: 20 requests per minute per IP, 15 second overall timeout with graceful partial results.

## Chrome extension

Folder: `extension/`. Manifest V3, permissions `storage` and `activeTab` only.

- **Popup**: current site, mini speedometer gauge, verdict, registry source, "See full report" (opens the web app at `/check?target=...`), "Check again", an auto-check toggle and an Advanced section for the API and web app URLs.
- **Auto-check**: a content script looks for donation-style pages (keywords such as donate, charity, fundraiser, relief in the address, title, headings and buttons). Only when the verdict is Suspicious or worse it shows a small dismissible banner (in a closed shadow root so page CSS can't touch it). Good verdicts show nothing on the page; the toolbar badge shows OK, ? or !.
- **Privacy**: only the site address (origin) is sent to your Chariora server. Page content and URL paths stay in the browser.
- **Caching**: results are cached in `chrome.storage.local` for 24 hours per site; partial results are never cached.

Install for development:

1. Open `chrome://extensions`, turn on **Developer mode**.
2. **Load unpacked** and choose the `extension/` folder.
3. Start the API (`npm run dev`) and click the Chariora icon on any website.

The web app also offers a zip at `/extension` (built by `npm run pack:extension`).

Pointing the extension at a deployed server: open the popup, expand **Advanced**, and set the API server URL (for example `https://chariora.example.com`) and web app URL. The API allows cross-origin requests, so no manifest change is needed. For the Chrome Web Store you would also add your production origin to `host_permissions` and replace the placeholder icons.

## Demo script

`npm run demo` (with `npm run dev` running in another terminal) runs three cases and prints PASS or FAIL for each:

1. **Real charity**: `redcross.org` should come back as Verified Charity (registry match plus domain match). Needs internet.
2. **Lookalike domain**: `red-cross-relief.xyz` should be flagged as a lookalike and not rated legitimate. Needs internet.
3. **Template scam page**: `demo/scam-page.html` (lorem ipsum, gift-card and crypto payments, fake countdown, "100% goes to victims", form posting to another domain) should score under 40 with at least four failing signals. This runs offline, because the API deliberately refuses localhost targets. To run it live, host that file on any public URL and set `DEMO_SCAM_URL`.

Set `DEMO_API` to test a deployed server.

## Deployment

One server serves both the API and the built web app.

```bash
npm run install:all
npm run build             # packs the extension zip, typechecks and builds client/dist
npm start                 # API + web app on $PORT
```

On Railway, Render or Fly: build command `npm run install:all && npm run build`, start command `npm start`, set `PORT` if the platform requires it, `TRUST_PROXY=1`, and the env vars above. The server serves `client/dist` automatically when it exists, with SPA fallback so `/check?target=...` links work on refresh.

The cache is in memory (24h LRU) behind a small interface in `server/src/cache.ts`, so it can be swapped for Redis when you run more than one instance. Per-IP rate limits and the handle-reuse tracker are per instance for the same reason.

## Project layout

```
client/      React + Vite + Tailwind web app
server/      Express API: orchestrator, providers (registry, domain, technical, reputation, content, social), llm, scoring
shared/      TypeScript types used by both
extension/   Chrome extension (MV3): manifest, service worker, content script, popup, lib/core.js
demo/        Template scam page fixture
scripts/     pack-extension.mjs, demo.mts
```

## Known limitations

- Instagram, Facebook, TikTok and LinkedIn mostly block anonymous reads, so many profiles show as unverifiable. That is neutral, never "fake". The verified-badge green flag is not implemented for the same reason.
- Hosting-country and abuse-list signals are not implemented (no key-free source). Safe Browsing covers reputation when a key is set.
- A lookalike of a top charity whose site is unreachable lands in "Suspicious" (around 50), not "Likely Fake", because there is little other evidence. A live scam site usually adds domain age and content signals and scores lower. Adding a hard override for high-severity lookalikes is a one-line change in `scoring.ts` if you prefer.
- DNS rebinding between the safety check and the fetch is not fully closed; pin resolved IPs before production.
- Domain match for registry hits uses a small built-in list of known charities (verify the EINs). `DISASTERS` in `server/src/providers/domain.ts` needs periodic updates.
- Extension icons are simple placeholders, and detection runs once at page load, so single-page apps that reveal a donate form later are not re-checked.
- "Report this site" links to official reporting channels; Chariora does not file reports itself.

Results are risk indicators, not legal findings. Always confirm a charity with its registry or by contacting it directly.
