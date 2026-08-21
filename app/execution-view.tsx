"use client";

import { useMemo, useState } from "react";

export type ExecutionSettings = {
  enabled: boolean;
  minScore: number;
  dailyLimit: number;
  mode: "FILL_ONLY" | "AUTO_SUBMIT";
  requireTailoredResume: boolean;
  updatedAt?: string | null;
};

export type CompanionDevice = {
  id: string;
  name: string;
  status: string;
  lastSeenAt?: string | null;
  createdAt: string;
};

export type ApplicationExecution = {
  id: string;
  jobId: string;
  packetId: string;
  documentId?: string | null;
  deviceId?: string | null;
  platform: string;
  mode: "FILL_ONLY" | "AUTO_SUBMIT";
  status: string;
  attemptCount: number;
  fieldsFilled: number;
  unknownRequired: string[];
  lastError?: string | null;
  applicationUrl: string;
  createdAt: string;
  updatedAt: string;
  claimedAt?: string | null;
  completedAt?: string | null;
  submittedAt?: string | null;
  company: string;
  role: string;
  location: string;
  score: number;
  documentVersion?: number | null;
};

type Props = {
  settings: ExecutionSettings;
  executions: ApplicationExecution[];
  devices: CompanionDevice[];
  connectionKey: string;
  qualifiedCount: number;
  busy: string;
  onSave: (settings: ExecutionSettings) => Promise<void>;
  onQueueAll: () => Promise<void>;
  onPair: (name: string) => Promise<void>;
  onRevoke: (deviceId: string) => Promise<void>;
  onRetry: (executionId: string) => Promise<void>;
  onCopyKey: () => Promise<void>;
};

const terminalStatuses = new Set(["SUBMITTED", "READY_TO_SUBMIT", "NEEDS_INPUT", "NEEDS_DOCUMENT", "FAILED"]);

function label(status: string) {
  return status.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function relative(value?: string | null) {
  if (!value) return "Never connected";
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 2) return "Online just now";
  if (minutes < 60) return `${minutes} minutes ago`;
  if (minutes < 1440) return `${Math.round(minutes / 60)} hours ago`;
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function ExecutionView({ settings, executions, devices, connectionKey, qualifiedCount, busy, onSave, onQueueAll, onPair, onRevoke, onRetry, onCopyKey }: Props) {
  const [draft, setDraft] = useState(settings);
  const [deviceName, setDeviceName] = useState("Chrome on my computer");

  const metrics = useMemo(() => ({
    waiting: executions.filter((item) => ["QUEUED", "CLAIMED"].includes(item.status)).length,
    submitted: executions.filter((item) => item.status === "SUBMITTED").length,
    needsYou: executions.filter((item) => ["NEEDS_INPUT", "NEEDS_DOCUMENT", "FAILED"].includes(item.status)).length,
    ready: executions.filter((item) => item.status === "READY_TO_SUBMIT").length,
  }), [executions]);

  return <div className="page inner-page execution-page">
    <section className="execution-hero">
      <div><span className="eyebrow">Guarded browser fill</span><h1>Move approved applications without losing control.</h1><p>RoleSignal sends only current, explicitly approved packets to your paired Chrome companion. Supported Greenhouse, Lever and Ashby forms fill verified fields and pause for your review before submission.</p></div>
      <div className="execution-hero-action"><span className={draft.enabled ? "execution-live on" : "execution-live"}><i />{draft.enabled ? "Execution active" : "Execution paused"}</span><button className="primary-button" disabled={busy === "execution-queue" || !draft.enabled} onClick={() => void onQueueAll()}>{busy === "execution-queue" ? "Building queue..." : `Queue ${qualifiedCount} qualified roles`}</button></div>
    </section>

    <div className="execution-metrics">
      <div><span>Waiting</span><strong>{metrics.waiting}</strong><small>Approved queue</small></div>
      <div><span>Submitted</span><strong>{metrics.submitted}</strong><small>Portal confirmed</small></div>
      <div><span>Ready</span><strong>{metrics.ready}</strong><small>One click remains</small></div>
      <div><span>Needs you</span><strong>{metrics.needsYou}</strong><small>Input or verification</small></div>
    </div>

    <div className="execution-control-grid">
      <form className="execution-policy-card" onSubmit={(event) => { event.preventDefault(); void onSave(draft); }}>
        <div className="execution-card-heading"><div><span className="card-kicker">Execution policy</span><h2>Fill verified facts, then pause</h2></div><button type="button" className={draft.enabled ? "switch large on" : "switch large"} onClick={() => setDraft({ ...draft, enabled: !draft.enabled })} aria-label="Toggle guarded browser fill"><span /></button></div>
        <div className="execution-mode-choice">
          <button type="button" className={draft.mode === "FILL_ONLY" ? "selected" : ""} onClick={() => setDraft({ ...draft, mode: "FILL_ONLY" })}><i>01</i><span><strong>Fill and pause</strong><small>Complete supported fields; you submit.</small></span></button>
          <div className="execution-coming-soon"><i>02</i><span><strong>Auto-submit is not enabled</strong><small>It remains off until provider-specific submission tests are published.</small></span></div>
        </div>
        <label className="execution-range"><span><strong>Minimum match</strong><small>Jobs below this never enter the queue.</small></span><b>{draft.minScore}%</b><input type="range" min="70" max="95" value={draft.minScore} onChange={(event) => setDraft({ ...draft, minScore: Number(event.target.value) })} /></label>
        <label className="execution-range"><span><strong>Daily application cap</strong><small>Limits volume and duplicate exposure.</small></span><b>{draft.dailyLimit}</b><input type="range" min="1" max="20" value={draft.dailyLimit} onChange={(event) => setDraft({ ...draft, dailyLimit: Number(event.target.value) })} /></label>
        <label className="execution-check"><input type="checkbox" checked={draft.requireTailoredResume} onChange={(event) => setDraft({ ...draft, requireTailoredResume: event.target.checked })} /><span><strong>Require an approved tailored resume</strong><small>When off, the most recent uploaded resume is allowed as a fallback.</small></span></label>
        <div className="execution-guardrails"><span><i>✓</i> Never invent answers</span><span><i>✓</i> Never bypass CAPTCHA</span><span><i>✓</i> Confirm before marking submitted</span></div>
        <button className="primary-button wide" disabled={busy === "execution-settings"}>{busy === "execution-settings" ? "Saving policy..." : "Save fill policy"}</button>
      </form>

      <aside className="companion-pair-card">
        <span className="card-kicker">Paired browser companion</span><h2>Connect the Chrome that will apply</h2><p>Chrome must remain open and signed into the job portals you use. The connection key grants access only to your approved execution queue.</p>
        {connectionKey ? <div className="connection-key"><span>One-time connection key</span><code>{connectionKey}</code><button className="secondary-button" onClick={() => void onCopyKey()}>Copy key</button><small>Save it in Companion → Autopilot. For security, RoleSignal will not show it again after this page refresh.</small></div> : <div className="pair-form"><label>Device name<input value={deviceName} onChange={(event) => setDeviceName(event.target.value)} /></label><button className="primary-button" disabled={busy === "execution-pair"} onClick={() => void onPair(deviceName)}>{busy === "execution-pair" ? "Creating key..." : "Create connection key"}</button></div>}
        <a className="download-button" href="/rolesignal-browser-companion.zip" download>Download Companion v0.7</a>
        <div className="device-list">{devices.length ? devices.map((device) => <div key={device.id}><span className={device.status === "ACTIVE" ? "device-dot online" : "device-dot"} /><span><strong>{device.name}</strong><small>{device.status === "ACTIVE" ? relative(device.lastSeenAt) : label(device.status)}</small></span>{device.status === "ACTIVE" && <button onClick={() => void onRevoke(device.id)}>Revoke</button>}</div>) : <p>No browser is paired yet.</p>}</div>
      </aside>
    </div>

    <section className="execution-ledger">
      <div className="section-heading"><div><span className="eyebrow">Live execution ledger</span><h2>Every attempt, outcome and pause</h2></div><span className="quiet-label">{executions.length} total</span></div>
      {!executions.length ? <div className="execution-empty"><span>↗</span><strong>Your execution queue is empty.</strong><p>Enable the policy, pair Chrome, then queue the jobs at or above your match threshold.</p></div> : <div className="execution-table">
        {executions.map((execution) => <article key={execution.id}>
          <div className="execution-company"><span>{execution.company.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</span><div><strong>{execution.role}</strong><small>{execution.company} / {execution.platform} / {execution.score}% match</small></div></div>
          <div className="execution-resume"><span>{execution.documentVersion ? `Tailored v${execution.documentVersion}` : "Primary resume"}</span><small>Fill and pause</small></div>
          <div><span className={`execution-status ${execution.status.toLowerCase()}`}>{label(execution.status)}</span>{execution.unknownRequired.length > 0 && <small className="execution-issue">{execution.unknownRequired[0]}</small>}</div>
          <div className="execution-row-actions"><a href={execution.applicationUrl} target="_blank" rel="noreferrer">Open</a>{terminalStatuses.has(execution.status) && execution.status !== "SUBMITTED" && <button disabled={busy === `execution-retry-${execution.id}`} onClick={() => void onRetry(execution.id)}>Retry</button>}</div>
        </article>)}
      </div>}
    </section>
  </div>;
}
