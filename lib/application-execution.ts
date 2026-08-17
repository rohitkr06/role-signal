export type ExecutionMode = "FILL_ONLY" | "AUTO_SUBMIT";

export type ExecutionCapability = {
  portal: string;
  level: "AUTO_SUBMIT" | "ASSISTED" | "UNSUPPORTED";
  reason: string;
};

const autoSubmitHosts = [
  { pattern: /(^|\.)boards\.greenhouse\.io$/i, portal: "Greenhouse" },
  { pattern: /(^|\.)job-boards\.greenhouse\.io$/i, portal: "Greenhouse" },
  { pattern: /(^|\.)jobs\.lever\.co$/i, portal: "Lever" },
  { pattern: /(^|\.)jobs\.ashbyhq\.com$/i, portal: "Ashby" },
];

const assistedHosts = [
  { pattern: /(^|\.)myworkdayjobs\.com$/i, portal: "Workday" },
  { pattern: /(^|\.)linkedin\.com$/i, portal: "LinkedIn" },
  { pattern: /(^|\.)naukri\.com$/i, portal: "Naukri" },
  { pattern: /(^|\.)indeed\.com$/i, portal: "Indeed" },
  { pattern: /(^|\.)indeed\.co\.in$/i, portal: "Indeed" },
];

export function executionCapability(applicationUrl: string, platform = ""): ExecutionCapability {
  let host = "";
  try { host = new URL(applicationUrl).hostname; } catch {
    return { portal: platform || "Unknown", level: "UNSUPPORTED", reason: "The application URL is invalid." };
  }
  const automatic = autoSubmitHosts.find((candidate) => candidate.pattern.test(host));
  if (automatic) return {
    portal: automatic.portal,
    level: "AUTO_SUBMIT",
    reason: "Single-page application form with a conservative submit confirmation flow.",
  };
  const assisted = assistedHosts.find((candidate) => candidate.pattern.test(host));
  if (assisted) return {
    portal: assisted.portal,
    level: "ASSISTED",
    reason: "Login, multi-page navigation, or portal controls can require a person.",
  };
  return {
    portal: platform || host.replace(/^www\./, "") || "Unknown",
    level: "ASSISTED",
    reason: "RoleSignal can fill recognized fields but will not guess how this portal submits.",
  };
}

export function effectiveExecutionMode(requested: ExecutionMode, capability: ExecutionCapability): ExecutionMode {
  return requested === "AUTO_SUBMIT" && capability.level === "AUTO_SUBMIT" ? "AUTO_SUBMIT" : "FILL_ONLY";
}

export function executionStatusFromReport(report: {
  outcome?: string;
  unknownRequired?: unknown[];
  captchaDetected?: boolean;
  submissionConfirmed?: boolean;
}) {
  if (report.captchaDetected) return "NEEDS_INPUT";
  if ((report.unknownRequired?.length ?? 0) > 0) return "NEEDS_INPUT";
  if (report.submissionConfirmed || report.outcome === "SUBMITTED") return "SUBMITTED";
  if (report.outcome === "FAILED") return "FAILED";
  if (report.outcome === "SUBMIT_UNCONFIRMED") return "NEEDS_INPUT";
  return "READY_TO_SUBMIT";
}

export function clampExecutionSettings(input: Record<string, unknown>) {
  return {
    enabled: input.enabled === true,
    minScore: Math.max(70, Math.min(95, Number(input.minScore ?? 75))),
    dailyLimit: Math.max(1, Math.min(20, Number(input.dailyLimit ?? 5))),
    mode: input.mode === "AUTO_SUBMIT" ? "AUTO_SUBMIT" as const : "FILL_ONLY" as const,
    requireTailoredResume: input.requireTailoredResume === true,
  };
}
