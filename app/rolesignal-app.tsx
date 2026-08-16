"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

type View = "dashboard" | "matches" | "autopilot" | "applications" | "profile";

type Job = {
  id: string;
  company: string;
  initials: string;
  role: string;
  location: string;
  mode: string;
  posted: string;
  score: number;
  tone: string;
  classification: string;
  fit: string;
  gaps: string;
  tags: string[];
  status: string;
  source: string;
};

const jobs: Job[] = [
  {
    id: "onehouse",
    company: "Onehouse",
    initials: "OH",
    role: "Backend Engineer — Distributed Systems",
    location: "Bengaluru",
    mode: "Hybrid",
    posted: "3d ago",
    score: 88,
    tone: "blue",
    classification: "Strong match",
    fit: "Distributed microservices, Kubernetes, GCP, caching and production ownership map directly to your strongest evidence.",
    gaps: "Java and gRPC are ramp-up areas, not engineering mismatches.",
    tags: ["Distributed systems", "Kubernetes", "GCP", "SaaS"],
    status: "Ready to review",
    source: "Lever",
  },
  {
    id: "deccan",
    company: "Deccan AI",
    initials: "DA",
    role: "AI Backend Engineer",
    location: "Hyderabad",
    mode: "On-site",
    posted: "1d ago",
    score: 87,
    tone: "violet",
    classification: "Strong match",
    fit: "AI orchestration, distributed backends, GCP, Kubernetes and end-to-end production ownership create clear differentiation.",
    gaps: "The team is Python-first; your production AI experience offsets some language risk.",
    tags: ["AI agents", "Event driven", "Kubernetes", "LLMs"],
    status: "Resume tweak suggested",
    source: "Company site",
  },
  {
    id: "sarvam",
    company: "Sarvam",
    initials: "SA",
    role: "Backend Engineer, Chanakya",
    location: "Bengaluru",
    mode: "On-site",
    posted: "6h ago",
    score: 86,
    tone: "orange",
    classification: "Strong match",
    fit: "Async processing, queues, Redis, failure handling, LLM integrations and high-ownership delivery fit your AIVA work closely.",
    gaps: "FastAPI and vector databases are the largest missing requirements.",
    tags: ["AI infrastructure", "Redis", "Async", "APIs"],
    status: "Ready to review",
    source: "Ashby",
  },
  {
    id: "learntube",
    company: "LearnTube.ai",
    initials: "LT",
    role: "AI Backend Engineer",
    location: "India",
    mode: "Remote",
    posted: "1d ago",
    score: 84,
    tone: "green",
    classification: "Strong match",
    fit: "Production AI agents, MongoDB, Redis, GCP and observability align well with an AI-backend builder role.",
    gaps: "Python and FastAPI are mandatory stack gaps.",
    tags: ["AI agents", "MongoDB", "Redis", "Remote"],
    status: "Needs one answer",
    source: "Wellfound",
  },
];

const applicationRows = [
  ["Onehouse", "Backend Engineer — Distributed Systems", "Ready to review", "Today", "88"],
  ["Deccan AI", "AI Backend Engineer", "Resume draft", "Today", "87"],
  ["Sarvam", "Backend Engineer, Chanakya", "Saved", "Yesterday", "86"],
  ["LearnTube.ai", "AI Backend Engineer", "Needs input", "Yesterday", "84"],
];

const navItems: { id: View; label: string; mark: string }[] = [
  { id: "dashboard", label: "Overview", mark: "⌂" },
  { id: "matches", label: "Matches", mark: "◎" },
  { id: "autopilot", label: "Autopilot", mark: "↗" },
  { id: "applications", label: "Applications", mark: "▤" },
  { id: "profile", label: "Career profile", mark: "◇" },
];

export function RoleSignalApp() {
  const [view, setView] = useState<View>("dashboard");
  const [autoApply, setAutoApply] = useState(false);
  const [threshold, setThreshold] = useState(82);
  const [dailyLimit, setDailyLimit] = useState(5);
  const [resumeName, setResumeName] = useState("Rohit_Kumar_Backend_Engineer.pdf");
  const [uploadState, setUploadState] = useState<"idle" | "uploading" | "saved" | "error">("idle");
  const [savedJobs, setSavedJobs] = useState<string[]>(["onehouse", "sarvam"]);
  const [toast, setToast] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const readyCount = useMemo(() => jobs.filter((job) => job.score >= threshold).length, [threshold]);

  async function uploadResume(file: File) {
    setUploadState("uploading");
    const data = new FormData();
    data.append("resume", file);
    try {
      const response = await fetch("/api/rolesignal/resumes", { method: "POST", body: data });
      if (!response.ok) throw new Error("Upload failed");
      setResumeName(file.name);
      setUploadState("saved");
      setToast("Resume stored securely. Profile review is ready.");
    } catch {
      setUploadState("error");
      setToast("Upload could not be completed. Please try again.");
    }
  }

  async function saveRules(nextAutoApply = autoApply) {
    try {
      const response = await fetch("/api/rolesignal/preferences", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          targetRoles: ["Backend Engineer", "Software Engineer II", "AI Infrastructure Engineer"],
          locations: ["India", "Remote"],
          workModes: ["Remote", "Hybrid"],
          matchThreshold: threshold,
          dailyLimit,
          autoApply: nextAutoApply,
        }),
      });
      if (!response.ok) throw new Error("Save failed");
      setToast("Autopilot rules saved.");
    } catch {
      setToast("Rules could not be saved. Please retry.");
    }
  }

  function toggleSaved(id: string) {
    setSavedJobs((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  function FileInput() {
    return <input ref={fileInput} className="sr-only" type="file" accept=".pdf,.docx,.txt" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadResume(file); }} />;
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => setView("dashboard")} aria-label="RoleSignal home">
          <span className="brand-mark"><span /></span>
          <span>RoleSignal</span>
        </button>

        <div className="workspace-switcher">
          <span className="workspace-avatar">RK</span>
          <span><strong>Rohit Kumar</strong><small>Backend Engineering</small></span>
          <b>⌄</b>
        </div>

        <nav aria-label="Primary navigation">
          <p className="nav-label">Workspace</p>
          {navItems.map((item) => (
            <button key={item.id} className={view === item.id ? "nav-item active" : "nav-item"} onClick={() => setView(item.id)}>
              <span>{item.mark}</span>{item.label}
              {item.id === "matches" && <b>7</b>}
              {item.id === "applications" && <b>4</b>}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="autopilot-mini">
            <span className="pulse-dot" />
            <div><strong>Autopilot is {autoApply ? "on" : "paused"}</strong><small>{autoApply ? `Watching for ${threshold}+ matches` : "Review mode is active"}</small></div>
            <button className={autoApply ? "switch on" : "switch"} onClick={() => { const next = !autoApply; setAutoApply(next); void saveRules(next); }} aria-label="Toggle autopilot"><span /></button>
          </div>
          <button className="help-link"><span>?</span> Help & feedback</button>
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div className="mobile-brand"><span className="brand-mark"><span /></span>RoleSignal</div>
          <div className="top-actions">
            <span className="secure-pill"><i /> Profile verified</span>
            <button className="icon-button" aria-label="Notifications">♢<b /></button>
            <button className="avatar-button">RK</button>
          </div>
        </header>

        {view === "dashboard" && (
          <div className="page dashboard-page">
            <section className="hero-row">
              <div>
                <span className="eyebrow">Sunday, 16 August</span>
                <h1>Good evening, Rohit.</h1>
                <p>Your profile is producing a clear signal. Four new roles are worth your attention.</p>
              </div>
              <button className="primary-button" onClick={() => setView("matches")}><span>＋</span> Find new roles</button>
            </section>

            <section className="metric-grid" aria-label="Job search metrics">
              <Metric label="Roles analyzed" value="24" note="12 this week" trend="up" />
              <Metric label="Strong matches" value="7" note="29% hit rate" trend="up" />
              <Metric label="Ready to apply" value={String(readyCount)} note={`Score ≥ ${threshold}`} trend="neutral" />
              <Metric label="Profile strength" value="92%" note="Excellent signal" trend="up" progress={92} />
            </section>

            <section className="content-grid">
              <div className="opportunities-column">
                <div className="section-heading">
                  <div><span className="eyebrow">Ranked for you</span><h2>Highest-signal opportunities</h2></div>
                  <button className="text-button" onClick={() => setView("matches")}>View all matches →</button>
                </div>
                <div className="job-stack">
                  {jobs.slice(0, 3).map((job) => <JobCard key={job.id} job={job} saved={savedJobs.includes(job.id)} onSave={() => toggleSaved(job.id)} onReview={() => setView("matches")} />)}
                </div>
              </div>

              <aside className="insights-column">
                <ResumePanel resumeName={resumeName} state={uploadState} onChoose={() => fileInput.current?.click()} />
                <FileInput />

                <div className="insight-card differentiation-card">
                  <span className="card-kicker"><i>✦</i> Your differentiator</span>
                  <h3>AI voice + distributed backend</h3>
                  <p>Your combination of production AI orchestration, event-driven systems, Kubernetes and on-call ownership appears in only <strong>8% of comparable profiles.</strong></p>
                  <div className="signal-bars"><span style={{ width: "86%" }} /><span style={{ width: "68%" }} /><span style={{ width: "92%" }} /></div>
                </div>

                <div className="insight-card preference-card">
                  <div className="card-heading"><span className="card-kicker">Search preferences</span><button onClick={() => setView("profile")}>Edit</button></div>
                  <PreferenceRow label="Roles" value="Backend · SDE II · AI infra" />
                  <PreferenceRow label="Location" value="India · Remote" />
                  <PreferenceRow label="Experience" value="2–5 years" />
                  <PreferenceRow label="Minimum score" value={`${threshold}/100`} />
                </div>
              </aside>
            </section>

            <section className="activity-strip">
              <div><span className="pulse-dot" /><strong>Search activity</strong><p>Last scan found <b>4 new matches</b> across 126 openings.</p></div>
              <div className="source-list"><span>GH</span><span>in</span><span>A</span><span>L</span><small>+ company careers</small></div>
              <button className="secondary-button" onClick={() => setToast("Fresh scan queued. We’ll rank only meaningful matches.")}>Run scan now</button>
            </section>
          </div>
        )}

        {view === "matches" && (
          <div className="page inner-page">
            <PageTitle eyebrow="Explainable matching" title="Your strongest opportunities" copy="Every score is tied to evidence from your verified profile—not keyword overlap alone." action="Refresh matches" onAction={() => setToast("Match refresh queued.")} />
            <div className="filter-row"><span className="filter active">All 24</span><span className="filter">Exceptional 0</span><span className="filter">Strong 7</span><span className="filter">Good 9</span><button>Sort: Match score ⌄</button></div>
            <div className="matches-layout">
              <div className="job-stack expanded">{jobs.map((job) => <JobCard key={job.id} job={job} expanded saved={savedJobs.includes(job.id)} onSave={() => toggleSaved(job.id)} onReview={() => setToast(`${job.company} moved to your review queue.`)} />)}</div>
              <aside className="score-legend">
                <span className="card-kicker">How scoring works</span><h3>Signal over keywords.</h3><p>RoleSignal translates equivalent engineering experience and shows uncertainty instead of hiding it.</p>
                {[['Backend engineering', '20'], ['Distributed systems', '15'], ['Stack proximity', '15'], ['Data systems', '10'], ['Cloud & infra', '10'], ['Domain advantage', '10'], ['Level & quality', '15'], ['Recency', '5']].map(([label, score]) => <div className="legend-row" key={label}><span>{label}</span><b>{score}</b></div>)}
              </aside>
            </div>
          </div>
        )}

        {view === "autopilot" && (
          <div className="page inner-page">
            <PageTitle eyebrow="Guarded automation" title="Autopilot, with judgment built in" copy="Automatically prepare—and optionally submit—only the opportunities that clear your rules." />
            <div className="autopilot-grid">
              <section className="rules-card">
                <div className="rules-hero"><div><span className="pulse-dot" /><span><strong>{autoApply ? "Autopilot is active" : "Review mode is active"}</strong><small>{autoApply ? "Eligible roles can proceed under your rules." : "Applications stop before submission."}</small></span></div><button className={autoApply ? "switch large on" : "switch large"} onClick={() => setAutoApply(!autoApply)}><span /></button></div>
                <RuleSlider label="Minimum match score" value={threshold} min={70} max={95} onChange={setThreshold} suffix="/100" help={`${readyCount} current roles qualify`} />
                <RuleSlider label="Daily application limit" value={dailyLimit} min={1} max={12} onChange={setDailyLimit} suffix=" roles" help="Quality cap across all sources" />
                <div className="rule-block"><span><strong>Unknown required answers</strong><small>Never guess compensation, legal or relocation details</small></span><span className="rule-value safe">Always pause</span></div>
                <div className="rule-block"><span><strong>Resume customization</strong><small>Allow up to five evidence-backed changes</small></span><span className="rule-value">When material</span></div>
                <div className="rule-block"><span><strong>CAPTCHA or bot protection</strong><small>Hand control back without bypassing restrictions</small></span><span className="rule-value safe">Manual action</span></div>
                <button className="primary-button wide" onClick={() => void saveRules()}>Save automation rules</button>
              </section>
              <aside className="guardrail-card">
                <div className="shield-mark">✓</div><span className="card-kicker">Submission guardrails</span><h3>Your data never fills a blank with a guess.</h3><p>RoleSignal proceeds only when the role, resume and every mandatory answer are supported by your verified profile.</p>
                <ul><li><i>✓</i> Duplicate detection</li><li><i>✓</i> Evidence-locked answers</li><li><i>✓</i> Domain and seniority checks</li><li><i>✓</i> Final submission audit trail</li></ul>
                <div className="qualifying-box"><span>Eligible right now</span><strong>{readyCount} roles</strong><small>Based on a {threshold}+ threshold</small></div>
              </aside>
            </div>
          </div>
        )}

        {view === "applications" && (
          <div className="page inner-page">
            <PageTitle eyebrow="Application ledger" title="Every opportunity, one clear state" copy="Prepared, blocked and completed applications remain traceable from discovery to outcome." action="Export ledger" onAction={() => setToast("Ledger export is being prepared.")} />
            <div className="table-card">
              <div className="table-tools"><div className="filter active">All applications</div><div className="filter">Needs attention 1</div><label><span>⌕</span><input placeholder="Search company or role" /></label></div>
              <div className="application-table">
                <div className="table-row table-head"><span>Company & role</span><span>Status</span><span>Updated</span><span>Score</span><span /></div>
                {applicationRows.map((row) => <div className="table-row" key={row[0]}><span><b>{row[0]}</b><small>{row[1]}</small></span><span><i className={`status-dot ${row[2].toLowerCase().replaceAll(" ", "-")}`} />{row[2]}</span><span>{row[3]}</span><span><b className="score-badge">{row[4]}</b></span><button>•••</button></div>)}
              </div>
            </div>
          </div>
        )}

        {view === "profile" && (
          <div className="page inner-page">
            <PageTitle eyebrow="Source of truth" title="Your verified career profile" copy="Review what RoleSignal is allowed to use. Unverified assumptions never enter an application." action="Upload new resume" onAction={() => fileInput.current?.click()} />
            <FileInput />
            <div className="profile-grid">
              <section className="profile-card wide-card"><span className="card-kicker">Current role</span><div className="profile-title"><div className="company-avatar">SL</div><div><h3>Software Development Engineer II</h3><p>SaaS Labs / JustCall · Apr 2025–Present</p></div><span className="verified-tag">✓ Verified</span></div><p className="profile-summary">Backend engineer with production ownership across distributed systems, AI voice infrastructure, databases, Kubernetes and reliability.</p></section>
              <ResumePanel resumeName={resumeName} state={uploadState} onChoose={() => fileInput.current?.click()} />
              <section className="profile-card wide-card"><div className="card-heading"><span className="card-kicker">Strongest evidence</span><button>Edit</button></div><div className="evidence-grid"><Evidence value="7,000+" label="AI voice customers" /><Evidence value="5,000/day" label="AI calls orchestrated" /><Evidence value="100M+" label="Rows migrated" /><Evidence value="60%" label="Database load reduced" /></div></section>
              <section className="profile-card wide-card"><span className="card-kicker">Verified skills</span><div className="skill-cloud">{["TypeScript", "Node.js", "NestJS", "Distributed systems", "Event-driven architecture", "GCP", "Pub/Sub", "Cloud Tasks", "Kubernetes", "Redis", "MySQL", "MongoDB", "OpenAI", "Twilio", "Deepgram", "Production reliability"].map((skill) => <span key={skill}>{skill}<i>✓</i></span>)}</div></section>
            </div>
          </div>
        )}
      </main>
      {toast && <div className="toast"><span>✓</span>{toast}</div>}
    </div>
  );
}

function Metric({ label, value, note, trend, progress }: { label: string; value: string; note: string; trend: string; progress?: number }) {
  return <div className="metric-card"><span>{label}</span><strong>{value}</strong><small className={trend}>{trend === "up" ? "↗" : "•"} {note}</small>{progress && <div className="metric-progress"><i style={{ width: `${progress}%` }} /></div>}</div>;
}

function JobCard({ job, saved, onSave, onReview, expanded = false }: { job: Job; saved: boolean; onSave: () => void; onReview: () => void; expanded?: boolean }) {
  const ringStyle = { "--score": `${job.score * 3.6}deg` } as CSSProperties;
  return <article className={expanded ? "job-card expanded" : "job-card"}>
    <div className="job-main"><div className={`company-logo ${job.tone}`}>{job.initials}</div><div className="job-info"><div className="job-company"><span>{job.company}</span><i>Verified</i></div><h3>{job.role}</h3><p>{job.location}<b>·</b>{job.mode}<b>·</b>{job.posted}<b>·</b>{job.source}</p><div className="tag-row">{job.tags.map((tag) => <span key={tag}>{tag}</span>)}</div></div></div>
    <div className="job-actions"><div className="score-ring" style={ringStyle}><span><b>{job.score}</b><small>match</small></span></div><button className={saved ? "save-button saved" : "save-button"} onClick={onSave} aria-label={saved ? "Unsave job" : "Save job"}>{saved ? "◆" : "◇"}</button></div>
    {expanded && <div className="job-explanation"><div><span className="fit-label">Why it fits</span><p>{job.fit}</p></div><div><span className="gap-label">Watch-out</span><p>{job.gaps}</p></div></div>}
    <div className="job-footer"><span className="match-class"><i />{job.classification}</span><span>{job.status}</span><button onClick={onReview}>{expanded ? "Add to review queue" : "Review match"} →</button></div>
  </article>;
}

function ResumePanel({ resumeName, state, onChoose }: { resumeName: string; state: string; onChoose: () => void }) {
  return <div className="insight-card resume-card"><div className="resume-icon"><span>PDF</span></div><div className="resume-copy"><span className="card-kicker">Primary resume</span><h3>{resumeName}</h3><p>{state === "uploading" ? "Uploading securely…" : state === "saved" ? "Stored · analysis queued" : "Verified profile · Updated today"}</p></div><button onClick={onChoose}>{state === "uploading" ? "…" : "Replace"}</button><div className="resume-progress"><span style={{ width: state === "uploading" ? "54%" : "100%" }} /></div></div>;
}

function PreferenceRow({ label, value }: { label: string; value: string }) {
  return <div className="preference-row"><span>{label}</span><strong>{value}</strong></div>;
}

function PageTitle({ eyebrow, title, copy, action, onAction }: { eyebrow: string; title: string; copy: string; action?: string; onAction?: () => void }) {
  return <section className="page-title"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{copy}</p></div>{action && <button className="primary-button" onClick={onAction}><span>＋</span>{action}</button>}</section>;
}

function RuleSlider({ label, value, min, max, onChange, suffix, help }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void; suffix: string; help: string }) {
  const width = ((value - min) / (max - min)) * 100;
  return <div className="slider-block"><div><span><strong>{label}</strong><small>{help}</small></span><b>{value}{suffix}</b></div><input aria-label={label} type="range" min={min} max={max} value={value} style={{ "--range": `${width}%` } as CSSProperties} onChange={(event) => onChange(Number(event.target.value))} /></div>;
}

function Evidence({ value, label }: { value: string; label: string }) {
  return <div><strong>{value}</strong><span>{label}</span></div>;
}
