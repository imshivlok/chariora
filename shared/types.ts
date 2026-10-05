export type Severity = "info" | "low" | "medium" | "high";
export type InputKind = "url" | "name" | "social";

export interface Signal {
  id: string;
  label: string;
  category: "registry" | "domain" | "technical" | "reputation" | "content" | "social";
  weight: number;
  score: number; // 0-1, 1 = trustworthy
  evidence: string;
  severity: Severity;
}

export type Platform = "instagram" | "facebook" | "x" | "youtube" | "tiktok" | "linkedin" | "telegram" | "whatsapp";

export interface SocialProfile {
  platform: Platform;
  handle: string;
  url: string;
  reachable: boolean | null; // null = could not tell (blocked, timeout)
  reciprocalLink: boolean | null; // null = profile not publicly readable
  ageDays?: number;
  followers?: number;
  verdict: "established" | "suspicious" | "unverifiable";
  notes: string;
}

export interface RegistryResult {
  found: boolean;
  name?: string;
  id?: string;
  country?: string;
  trustPercent?: number;
  url?: string;
  domainMatches?: boolean;
}

export type Verdict =
  | "Verified Charity"
  | "Likely Legitimate"
  | "Suspicious - Verify Before Donating"
  | "Likely Fake"
  | "Almost Certainly a Scam";

export interface AnalysisResult {
  target: string;
  kind: InputKind;
  normalizedDomain: string | null;
  verdict: Verdict;
  score: number;
  confidence: "low" | "medium" | "high";
  source: "registry" | "analysis" | "both";
  registry: RegistryResult | null;
  signals: Signal[];
  socialProfiles: SocialProfile[];
  redFlags: string[];
  greenFlags: string[];
  summary: string;
  aiAvailable: boolean;
  safeAlternatives: { name: string; url: string }[];
  checkedAt: string;
  partial: boolean;
  errors: string[];
}

export type ProgressStep = "Checking registries..." | "Analyzing website..." | "Verifying social profiles..." | "Scoring...";
