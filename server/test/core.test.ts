import { describe, it, expect } from "vitest";
import { normalizeInput, InputError } from "../src/normalize.js";
import { computeScore, tierFor } from "../src/scoring.js";
import { nameSimilarity } from "../src/providers/registry.js";

describe("normalizeInput", () => {
  it("extracts registrable domain", () => expect(normalizeInput("https://donate.redcross.org/x?y=1").domain).toBe("redcross.org"));
  it("accepts bare domains", () => expect(normalizeInput("redcross.org").kind).toBe("url"));
  it("treats words as a charity name", () => expect(normalizeInput("Red Cross").kind).toBe("name"));
  it("flags social links", () => expect(normalizeInput("https://instagram.com/foo").kind).toBe("social"));
  it.each(["http://localhost:3000", "http://127.0.0.1", "http://10.0.0.5", "http://192.168.1.1", "ftp://x.org", "http://2130706433", "http://169.254.169.254"])("blocks %s", (u) => expect(() => normalizeInput(u)).toThrow(InputError));
});

describe("scoring", () => {
  it("tiers", () => { expect(tierFor(90, true)).toBe("Verified Charity"); expect(tierFor(90, false)).toBe("Likely Legitimate"); expect(tierFor(10, false)).toBe("Almost Certainly a Scam"); });
  it("registry+domain match floors at 85", () => expect(computeScore([{ id: "a", label: "", category: "domain", weight: 1, score: 0, evidence: "", severity: "high" }], { found: true, domainMatches: true }).score).toBeGreaterThanOrEqual(85));
  it("low-confidence unverified results are capped at Suspicious", () => expect(computeScore([{ id: "a", label: "", category: "domain", weight: 1, score: 1, evidence: "", severity: "info" }], null).score).toBeLessThanOrEqual(64));
  it("hard fail forces lowest tier", () => expect(computeScore([], null, true).verdict).toBe("Almost Certainly a Scam"));
});

describe("nameSimilarity", () => {
  it("matches same org", () => expect(nameSimilarity("American Red Cross", "American National Red Cross")).toBeGreaterThan(0.6));
  it("rejects different org", () => expect(nameSimilarity("Red Cross", "Blue Hope")).toBe(0));
});
