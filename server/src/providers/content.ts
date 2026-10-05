import * as cheerio from "cheerio";
import { parse } from "tldts";
import type { Signal } from "../../../shared/types.js";

const PROCESSORS = ["stripe", "paypal", "braintree", "square", "donorbox", "givebutter", "classy", "every.org", "gofundme", "networkforgood", "givewp", "justgiving", "razorpay"];
const first = (t: string, re: RegExp) => t.match(re)?.[0];

export interface ContentAnalysis { signals: Signal[]; excerpt: string; text: string; }

/** Strip scripts/styles, control characters and collapse whitespace. Output is still UNTRUSTED. */
export function sanitizeText(html: string, maxChars = 24000): string {
  const $ = cheerio.load(html);
  $("script,style,noscript,svg,iframe").remove();
  $("body *").after(" "); // keep text from neighbouring elements from fusing together
  return $("body").text().replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxChars);
}

export function analyzeContent(html: string, pageUrl: URL): ContentAnalysis {
  const $ = cheerio.load(html);
  const text = sanitizeText(html);
  const lower = text.toLowerCase();
  const rawHtml = html.toLowerCase();
  const signals: Signal[] = [];
  const add = (s: Omit<Signal, "category">) => signals.push({ ...s, category: "content" });

  // Template detection
  const tpl: string[] = [];
  const ph = first(lower, /lorem ipsum|your (text|title|content|company) here|sample text|insert (text|image) here|placeholder text/);
  if (ph) tpl.push(`placeholder text ("${ph}")`);
  const stock = $("img").map((_, el) => $(el).attr("src") ?? "").get().filter((s) => /(stock|shutterstock|istock|placeholder|dummy|sample|default)[-_]?\w*\.(jpg|png|webp)/i.test(s));
  if (stock.length >= 2) tpl.push(`${stock.length} stock/placeholder image filenames`);
  if (/<meta name="generator" content="[^"]*(wix|weebly|godaddy website builder)/i.test(html) && text.length < 1500) tpl.push("builder site with very little original content");
  add({ id: "template", label: "Template / placeholder content", weight: 2.5, score: tpl.length ? Math.max(0.05, 0.4 - tpl.length * 0.2) : 1, severity: tpl.length ? "high" : "info", evidence: tpl.length ? `Found ${tpl.join("; ")}.` : "No placeholder or template boilerplate found." });

  // Missing trust information
  const trust: [string, boolean][] = [
    ["registration number", /\b\d{2}-\d{7}\b|\bein\b|tax[- ]id|501\(c\)\(3\)|registered charity|charity (no|number|registration)/i.test(text)],
    ["physical address", $("address").length > 0 || /\d{1,5}\s+\w+(\s\w+){0,3}\s+(street|st|avenue|ave|road|rd|boulevard|blvd|lane|ln|drive|dr|suite|ste)\b/i.test(text)],
    ["phone number", /(\+?\d[\d\s().-]{8,}\d)/.test(text) || $("a[href^='tel:']").length > 0],
    ["contact page", $("a").filter((_, el) => /contact/i.test($(el).attr("href") ?? "") || /contact/i.test($(el).text())).length > 0],
    ["privacy policy", $("a").filter((_, el) => /privacy/i.test($(el).attr("href") ?? "") || /privacy/i.test($(el).text())).length > 0],
    ["financials / annual report", /annual report|financials|form 990|audited|transparency/i.test(text)],
  ];
  const have = trust.filter(([, ok]) => ok).length;
  const missing = trust.filter(([, ok]) => !ok).map(([k]) => k);
  add({ id: "trust-info", label: "Trust information on the page", weight: 3, score: have / trust.length, severity: have <= 2 ? "high" : have <= 4 ? "medium" : "info", evidence: missing.length ? `Missing: ${missing.join(", ")}.` : "Registration number, address, contact details, privacy policy and financials all present." });

  // Arbitrary values
  const arb: string[] = [];
  const round = [...text.matchAll(/\b(\d{1,3}(?:,\d{3})+|\d{4,})\+?\s+(families|children|people|meals|lives|donors|victims|students)/gi)].filter((m) => Number(m[1].replace(/,/g, "")) % 1000 === 0);
  if (round.length >= 2) arb.push(`${round.length} suspiciously round impact numbers (e.g. "${round[0][0]}")`);
  if (/countdown|timer|ends in|hours left|days left|expires in/i.test(rawHtml.replace(/<script[\s\S]*?<\/script>/g, " ").slice(0, 400000)) && /donat|fund|goal/i.test(lower)) arb.push("countdown or deadline timer");
  const testi = $("[class*='testimonial'], blockquote");
  const unnamed = testi.filter((_, el) => !/[—–-]\s*[A-Z][a-z]+(\s[A-Z][a-z]+)?/.test($(el).text())).length;
  if (testi.length >= 2 && unnamed === testi.length) arb.push("testimonials with no real names");
  add({ id: "arbitrary", label: "Implausible numbers and claims", weight: 1.5, score: arb.length ? Math.max(0.1, 0.7 - arb.length * 0.3) : 1, severity: arb.length ? "medium" : "info", evidence: arb.length ? `${arb.join("; ")}.` : "No implausible statistics, fake timers or anonymous testimonials found." });

  // Payment signals
  const risky: string[] = [];
  if (/gift ?cards?|itunes card|google play card/.test(lower)) risky.push("gift cards");
  if (/bitcoin|\bbtc\b|ethereum|usdt|crypto(currency)? (wallet|only|address)/.test(lower)) risky.push("cryptocurrency");
  if (/wire transfer|western union|moneygram/.test(lower)) risky.push("wire transfer");
  if (/zelle|cash ?app|venmo/.test(lower)) risky.push("peer-to-peer apps");
  const procs = PROCESSORS.filter((p) => rawHtml.includes(p));
  const pageDomain = parse(pageUrl.hostname).domain;
  const foreign = $("form[action]").map((_, el) => $(el).attr("action") ?? "").get().filter((a) => {
    try { const d = parse(new URL(a, pageUrl).hostname).domain; return d && d !== pageDomain && !PROCESSORS.some((p) => d.includes(p.replace(".org", ""))); } catch { return false; }
  });
  let pay = 1 - risky.length * 0.45;
  if (!procs.length && /donat/i.test(lower)) pay -= 0.2;
  if (foreign.length) pay -= 0.4;
  const pe = [risky.length && `asks for ${risky.join(", ")}`, !procs.length && /donat/i.test(lower) && "no recognized payment processor", foreign.length && "a form posts to an unrelated domain"].filter(Boolean);
  add({ id: "payment", label: "Payment methods", weight: 3, score: Math.max(0, pay), severity: pay < 0.5 ? "high" : pay < 0.9 ? "medium" : "info", evidence: pe.length ? `Page ${pe.join("; ")}.` : `Uses a recognized processor (${procs.slice(0, 3).join(", ")}) and no risky payment methods.` });

  // Pressure language
  const pr = [...new Set([...lower.matchAll(/act now|urgent(ly)?|every second counts|last chance|only \d+ (hours|days) left|100% (of (your )?(donation|money|funds)) (goes|go)|lives depend on you|don'?t let (them|her|him) die|before it'?s too late/g)].map((m) => m[0]))];
  add({ id: "pressure", label: "Pressure language", weight: 2, score: Math.max(0.1, 1 - pr.length * 0.25), severity: pr.length >= 2 ? "high" : pr.length ? "medium" : "info", evidence: pr.length ? `Uses urgency or guilt phrases: ${pr.map((p) => `"${p}"`).join(", ")}.` : "No urgency or guilt-tripping language found." });

  return { signals, excerpt: text.slice(0, 24000), text };
}
