"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";

type View = "dashboard" | "discovery" | "matches" | "sources" | "runs" | "autopilot" | "applications" | "profile";

type Profile = {
  name: string;
  email: string;
  title: string;
  experienceYears: number;
  skills: string[];
  domains: string[];
  evidence: string[];
  source: string;
};

type MatchJob = {
  id: string;
  company: string;
  role: string;
  location: string;
  workMode: string;
  platform: string;
  applicationUrl: string;
  postedDate?: string;
  description: string;
  score: number;
  classification: string;
  status: string;
  matchingExperience: string[];
  missingRequirements: string[];
  languageMismatch: string[];
  redFlags: string[];
  highPriority: boolean;
  resumeFit: string;
  resumeChanges: string[];
  breakdown?: Record<string, number>;
  isSample?: boolean;
};

type ApplicationPacket = {
  id: string;
  jobId: string;
  status: string;
  answers: Record<string, string>;
  blockers: Array<{ id: string; question: string; status: string }>;
  resumeStrategy: { fit?: string; changes?: string[]; evidence?: string[] };
  company: string;
  role: string;
  applicationUrl: string;
  score: number;
  kit?: {
    id: string;
    summary: string;
    whyAnswer: string;
    resumeChanges: string[];
    evidence: string[];
    formAnswers: Record<string, string>;
    status: string;
  };
};

type AnswerVaultRow = {
  field_key: string;
  label: string;
  value: string;
  status: string;
  sensitive: number;
  updated_at: string;
};

type SearchRun = {
  id: string;
  status: string;
  sourceCount: number;
  jobsDiscovered: number;
  uniqueJobs: number;
  analyzed: number;
  exceptional: number;
  strong: number;
  ready: number;
  needsInput: number;
  skipped: number;
  startedAt: string;
  completedAt?: string;
  report: {
    topOpportunities?: MatchJob[];
    highestPriority?: MatchJob[];
    failures?: Array<{ source: string; message: string }>;
    autoStaged?: Array<{ packetId: string; jobId: string; status: string }>;
    autoStageFailures?: Array<{ jobId: string; message: string }>;
  };
};

type DiscoverySearch = {
  id: string;
  name: string;
  keywords: string[];
  locations: string[];
  workModes: string[];
  portals: string[];
  minScore: number;
  active: boolean;
  lastRunAt?: string;
};

type DiscoveryRun = {
  id: string;
  searchId?: string;
  mode: string;
  status: string;
  providers: Array<{ provider: string; discovered: number; relevant?: number; imported: number; duplicates: number }>;
  discovered: number;
  imported: number;
  duplicates: number;
  qualified: number;
  cached?: boolean;
  report: {
    topOpportunities?: MatchJob[];
    highestPriority?: MatchJob[];
    failures?: Array<{ provider: string; message: string }>;
    autoStaged?: Array<{ packetId: string; jobId: string; status: string }>;
    portal?: string;
    sourceUrl?: string;
    rejected?: number;
  };
  startedAt: string;
  completedAt?: string;
};

type Workspace = {
  profile: Profile;
  jobs: MatchJob[];
  packets: ApplicationPacket[];
  sources: Array<{ id: string; provider: string; source_token: string; label: string; last_scanned_at?: string }>;
  resumes: Array<{ id: string; filename: string; status: string }>;
  preferences?: { match_threshold?: number; daily_limit?: number; auto_apply?: number };
  answerVault: AnswerVaultRow[];
  searchRuns: SearchRun[];
  discoverySearches: DiscoverySearch[];
  discoveryRuns: DiscoveryRun[];
};

type ScanReport = {
  source: string;
  provider: string;
  discovered: number;
  unique: number;
  duplicates: number;
  strong: number;
  ready: number;
  skipped: number;
};

const sampleJobs: MatchJob[] = [
  {
    id: "sample-onehouse",
    company: "Onehouse",
    role: "Backend Engineer - Distributed Systems",
    location: "Bengaluru",
    workMode: "Hybrid",
    platform: "Lever",
    applicationUrl: "",
    postedDate: "3d ago",
    description: "Curated product sample",
    score: 88,
    classification: "Strong",
    status: "HIGH_PRIORITY",
    matchingExperience: ["Distributed services, Kubernetes and GCP", "Caching and production ownership"],
    missingRequirements: ["gRPC"],
    languageMismatch: ["Java / Spring"],
    redFlags: [],
    highPriority: true,
    resumeFit: "CUSTOMIZE",
    resumeChanges: ["Move Pub/Sub and Redis evidence higher."],
    isSample: true,
  },
  {
    id: "sample-sarvam",
    company: "Sarvam",
    role: "AI Backend Engineer",
    location: "Bengaluru",
    workMode: "On-site",
    platform: "Ashby",
    applicationUrl: "",
    postedDate: "6h ago",
    description: "Curated product sample",
    score: 86,
    classification: "Strong",
    status: "HIGH_PRIORITY",
    matchingExperience: ["AI voice orchestration", "Queues, Redis and failure handling"],
    missingRequirements: ["Vector databases"],
    languageMismatch: ["Python"],
    redFlags: [],
    highPriority: true,
    resumeFit: "CUSTOMIZE",
    resumeChanges: ["Lead with AIVA scale and production AI integrations."],
    isSample: true,
  },
  {
    id: "sample-learntube",
    company: "LearnTube.ai",
    role: "Backend Engineer, AI Platform",
    location: "India",
    workMode: "Remote",
    platform: "Company site",
    applicationUrl: "",
    postedDate: "1d ago",
    description: "Curated product sample",
    score: 82,
    classification: "Strong",
    status: "READY_TO_APPLY",
    matchingExperience: ["MongoDB, Redis, GCP and observability"],
    missingRequirements: ["FastAPI"],
    languageMismatch: ["Python"],
    redFlags: [],
    highPriority: false,
    resumeFit: "CUSTOMIZE",
    resumeChanges: ["Keep transferable backend architecture prominent."],
    isSample: true,
  },
];

const fallbackProfile: Profile = {
  name: "Rohit Kumar",
  email: "",
  title: "Software Development Engineer II",
  experienceYears: 3,
  source: "verified-brief",
  skills: ["TypeScript", "Node.js", "NestJS", "Distributed systems", "GCP", "Kubernetes", "Redis", "MySQL", "MongoDB", "OpenAI"],
  domains: ["AI voice agents", "Event-driven architecture", "Production reliability"],
  evidence: [
    "Scaled an AI voice platform to 7,000+ customers and roughly 5,000 calls per day.",
    "Led a zero-downtime MySQL migration spanning 100M+ rows.",
    "Reduced database load by roughly 60% with Redis configuration caching.",
  ],
};

const navItems: Array<{ id: View; label: string; mark: string }> = [
  { id: "dashboard", label: "Overview", mark: "01" },
  { id: "discovery", label: "Discover jobs", mark: "02" },
  { id: "matches", label: "Matches", mark: "03" },
  { id: "sources", label: "Company boards", mark: "04" },
  { id: "runs", label: "ATS runs", mark: "05" },
  { id: "autopilot", label: "Autopilot", mark: "06" },
  { id: "applications", label: "Applications", mark: "07" },
  { id: "profile", label: "Career profile", mark: "08" },
];

const answerFields = [
  { key: "phone", label: "Phone number", placeholder: "+91 ...", sensitive: true },
  { key: "linkedin_url", label: "LinkedIn URL", placeholder: "https://linkedin.com/in/...", sensitive: false },
  { key: "github_url", label: "GitHub URL", placeholder: "https://github.com/...", sensitive: false },
  { key: "current_location", label: "Current location", placeholder: "Bengaluru, India", sensitive: false },
  { key: "notice_period", label: "Notice period", placeholder: "30 days", sensitive: true },
  { key: "current_compensation", label: "Current compensation", placeholder: "Enter only if you want it reused", sensitive: true },
  { key: "expected_compensation", label: "Expected compensation", placeholder: "Enter only if you want it reused", sensitive: true },
  { key: "work_authorization", label: "Work authorization", placeholder: "Authorized to work in India", sensitive: true },
  { key: "relocation", label: "Relocation preference", placeholder: "Open to Bengaluru / remote only", sensitive: true },
] as const;

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, options);
  const payload = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || "Request failed");
  return payload;
}

function readableStatus(status: string) {
  return status.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function postedLabel(value?: string) {
  if (!value) return "Date unknown";
  if (/ago|hour|day|today/i.test(value)) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function RoleSignalApp() {
  const [view, setView] = useState<View>("dashboard");
  const [profile, setProfile] = useState<Profile>(fallbackProfile);
  const [liveJobs, setLiveJobs] = useState<MatchJob[]>([]);
  const [packets, setPackets] = useState<ApplicationPacket[]>([]);
  const [sources, setSources] = useState<Workspace["sources"]>([]);
  const [searchRuns, setSearchRuns] = useState<SearchRun[]>([]);
  const [discoveryRuns, setDiscoveryRuns] = useState<DiscoveryRun[]>([]);
  const [answerVault, setAnswerVault] = useState<AnswerVaultRow[]>([]);
  const [answerValues, setAnswerValues] = useState<Record<string, string>>({
    phone: "",
    linkedin_url: "",
    github_url: "",
    current_location: "",
    notice_period: "",
    current_compensation: "",
    expected_compensation: "",
    work_authorization: "",
    relocation: "",
  });
  const [autoApply, setAutoApply] = useState(false);
  const [threshold, setThreshold] = useState(75);
  const [dailyLimit, setDailyLimit] = useState(5);
  const [resumeName, setResumeName] = useState("Rohit_Kumar_Backend_Engineer.pdf");
  const [uploadState, setUploadState] = useState<"idle" | "extracting" | "uploading" | "saved" | "error">("idle");
  const [resumeText, setResumeText] = useState("");
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState("");
  const [workspaceLoaded, setWorkspaceLoaded] = useState(false);
  const [scanReport, setScanReport] = useState<ScanReport | null>(null);
  const [sourceForm, setSourceForm] = useState({ provider: "greenhouse", token: "", label: "" });
  const [jobForm, setJobForm] = useState({ jobUrl: "", company: "", role: "", location: "", postedDate: "", description: "" });
  const [discoveryForm, setDiscoveryForm] = useState({
    name: "Backend roles / India + Remote",
    keywords: "Backend Engineer, Software Engineer, Platform Engineer, Node.js",
    locations: "India, Remote, APAC",
    workModes: ["Remote", "Hybrid"],
    minScore: 75,
  });
  const [captureText, setCaptureText] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const displayJobs = liveJobs.length ? liveJobs : sampleJobs;
  const qualifiedJobs = useMemo(() => liveJobs.filter((job) => job.score >= threshold && job.status !== "SKIPPED"), [liveJobs, threshold]);
  const needsAttention = packets.filter((packet) => packet.status === "NEEDS_INPUT").length;
  const latestRun = searchRuns[0];
  const latestDiscovery = discoveryRuns[0];
  const primaryKeyword = discoveryForm.keywords.split(",")[0]?.trim() || "Backend Engineer";
  const primaryLocation = discoveryForm.locations.split(",")[0]?.trim() || "India";
  const portalSearches = [
    { name: "LinkedIn", mark: "in", note: "Signed-in search", url: `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(primaryKeyword)}&location=${encodeURIComponent(primaryLocation)}` },
    { name: "Naukri", mark: "N", note: "India job search", url: `https://www.naukri.com/jobs-in-india?k=${encodeURIComponent(primaryKeyword)}&l=${encodeURIComponent(primaryLocation)}` },
    { name: "Indeed", mark: "i", note: "India listings", url: `https://in.indeed.com/jobs?q=${encodeURIComponent(primaryKeyword)}&l=${encodeURIComponent(primaryLocation)}` },
    { name: "Google Jobs", mark: "G", note: "Wider web search", url: `https://www.google.com/search?q=${encodeURIComponent(`${primaryKeyword} jobs ${primaryLocation}`)}` },
  ];

  useEffect(() => {
    void loadWorkspace();
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3400);
    return () => window.clearTimeout(timer);
  }, [toast]);

  async function loadWorkspace() {
    try {
      const data = await api<Workspace>("/api/rolesignal/workspace");
      setProfile(data.profile || fallbackProfile);
      setLiveJobs(data.jobs || []);
      setPackets(data.packets || []);
      setSources(data.sources || []);
      setSearchRuns(data.searchRuns || []);
      setDiscoveryRuns(data.discoveryRuns || []);
      if (data.discoverySearches?.[0]) {
        const search = data.discoverySearches[0];
        setDiscoveryForm({
          name: search.name,
          keywords: search.keywords.join(", "),
          locations: search.locations.join(", "),
          workModes: search.workModes,
          minScore: search.minScore,
        });
      }
      setAnswerVault(data.answerVault || []);
      setAnswerValues((current) => ({
        ...current,
        ...Object.fromEntries((data.answerVault || []).map((row) => [row.field_key, row.value])),
      }));
      if (data.resumes?.[0]) setResumeName(data.resumes[0].filename);
      if (data.preferences) {
        setThreshold(Number(data.preferences.match_threshold ?? 75));
        setDailyLimit(Number(data.preferences.daily_limit ?? 5));
        setAutoApply(Boolean(data.preferences.auto_apply));
      }
    } catch {
      setToast("The workspace could not sync. The interface is showing curated samples.");
    } finally {
      setWorkspaceLoaded(true);
    }
  }

  async function extractResumeText(file: File) {
    if (file.type === "text/plain") return file.text();
    if (file.type === "application/pdf") {
      const { extractText } = await import("unpdf");
      const result = await extractText(new Uint8Array(await file.arrayBuffer()), { mergePages: true });
      return result.text;
    }
    if (file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
      const mammothModule = await import("mammoth");
      const mammoth = "extractRawText" in mammothModule ? mammothModule : mammothModule.default;
      const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
      return result.value;
    }
    throw new Error("Upload a PDF, DOCX or TXT resume.");
  }

  async function uploadResume(file: File) {
    setUploadState("extracting");
    try {
      const text = await extractResumeText(file);
      if (text.trim().length < 80) throw new Error("Very little text was found. Try a text-based PDF or paste the resume below.");
      setUploadState("uploading");
      const data = new FormData();
      data.append("resume", file);
      data.append("resumeText", text.slice(0, 200_000));
      const result = await api<{ profile?: Profile }>("/api/rolesignal/resumes", { method: "POST", body: data });
      setResumeName(file.name);
      if (result.profile) setProfile(result.profile);
      setResumeText(text);
      setUploadState("saved");
      setToast("Resume analyzed. Verified signals now drive every score.");
      await loadWorkspace();
    } catch (error) {
      setUploadState("error");
      setToast(error instanceof Error ? error.message : "Resume analysis failed.");
    }
  }

  async function analyzePastedResume() {
    setBusy("resume-text");
    try {
      const result = await api<{ profile: Profile }>("/api/rolesignal/profile/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resumeText }),
      });
      setProfile(result.profile);
      setToast("Resume text analyzed and saved as the current source of truth.");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Resume text could not be analyzed.");
    } finally {
      setBusy("");
    }
  }

  async function saveRules(nextAutoApply = autoApply) {
    try {
      await api("/api/rolesignal/preferences", {
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
      setToast("Automation rules saved.");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Rules could not be saved.");
    }
  }

  async function importJob(event: FormEvent) {
    event.preventDefault();
    setBusy("job-import");
    try {
      const result = await api<{ job: MatchJob }>("/api/rolesignal/jobs/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(jobForm),
      });
      setToast(`${result.job.company} scored ${result.job.score}/100.`);
      setJobForm({ jobUrl: "", company: "", role: "", location: "", postedDate: "", description: "" });
      await loadWorkspace();
      setView("matches");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "The job could not be imported.");
    } finally {
      setBusy("");
    }
  }

  async function scanSource(event: FormEvent) {
    event.preventDefault();
    setBusy("source-scan");
    try {
      const result = await api<{ report: ScanReport }>("/api/rolesignal/sources/scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(sourceForm),
      });
      setScanReport(result.report);
      setToast(`Scored ${result.report.discovered} published roles from ${result.report.source}.`);
      await loadWorkspace();
    } catch (error) {
      setToast(error instanceof Error ? error.message : "The source scan could not finish.");
    } finally {
      setBusy("");
    }
  }

  async function runAllSources() {
    setBusy("scan-all");
    try {
      const result = await api<{ run: SearchRun }>("/api/rolesignal/sources/scan-all", { method: "POST" });
      await loadWorkspace();
      setView("runs");
      const staged = result.run.report.autoStaged?.length || 0;
      setToast(staged ? `Search run completed and ${staged} application kit${staged === 1 ? " was" : "s were"} auto-staged.` : `Search run completed: ${result.run.ready} roles are ready to review.`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "The full search run could not finish.");
    } finally {
      setBusy("");
    }
  }

  async function disconnectSource(sourceId: string) {
    setBusy(`source-remove-${sourceId}`);
    try {
      await api("/api/rolesignal/sources/remove", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceId }),
      });
      await loadWorkspace();
      setToast("Job source disconnected. Existing scored roles remain in the ledger.");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "The job source could not be disconnected.");
    } finally {
      setBusy("");
    }
  }

  async function runDiscovery(event?: FormEvent) {
    event?.preventDefault();
    setBusy("discovery-run");
    try {
      const result = await api<{ run: DiscoveryRun }>("/api/rolesignal/discovery/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...discoveryForm,
          keywords: discoveryForm.keywords.split(",").map((value) => value.trim()).filter(Boolean),
          locations: discoveryForm.locations.split(",").map((value) => value.trim()).filter(Boolean),
          portals: ["Jobicy", "Arbeitnow", "Connected ATS boards"],
        }),
      });
      await loadWorkspace();
      setView("discovery");
      setToast(result.run.cached ? "Public feeds refresh hourly. Showing the latest matching discovery run." : `Discovery complete: ${result.run.qualified} qualified matches from ${result.run.discovered} listings.`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "The discovery run could not finish.");
    } finally {
      setBusy("");
    }
  }

  async function importPortalCapture(event: FormEvent) {
    event.preventDefault();
    setBusy("capture-import");
    try {
      const batch = JSON.parse(captureText) as Record<string, unknown>;
      const result = await api<{ run: DiscoveryRun }>("/api/rolesignal/discovery/capture", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ batch }),
      });
      setCaptureText("");
      await loadWorkspace();
      setToast(`Imported ${result.run.imported} new portal jobs; ${result.run.duplicates} duplicates were merged.`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "The portal capture could not be imported.");
    } finally {
      setBusy("");
    }
  }

  async function pasteCapture() {
    try {
      setCaptureText(await navigator.clipboard.readText());
      setToast("Discovery batch pasted from the browser companion.");
    } catch {
      setToast("Clipboard access was blocked. Paste the discovery batch manually.");
    }
  }

  async function saveAnswerVault(event: FormEvent) {
    event.preventDefault();
    setBusy("answer-vault");
    try {
      const result = await api<{ answerVault: AnswerVaultRow[] }>("/api/rolesignal/answers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ values: answerValues }),
      });
      setAnswerVault(result.answerVault);
      setToast("Verified answers saved. Future packets can reuse them without guessing.");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "The answer vault could not be saved.");
    } finally {
      setBusy("");
    }
  }

  async function prepareApplication(job: MatchJob) {
    if (job.isSample) {
      setView("sources");
      setToast("Connect a live source or import a job before preparing an application.");
      return;
    }
    setBusy(`prepare-${job.id}`);
    try {
      await api("/api/rolesignal/applications/prepare", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jobId: job.id }),
      });
      await loadWorkspace();
      setView("applications");
      setToast("Application packet prepared. Submission remains locked.");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "The application packet could not be prepared.");
    } finally {
      setBusy("");
    }
  }

  async function approvePacket(packet: ApplicationPacket) {
    setBusy(`approve-${packet.id}`);
    try {
      await api("/api/rolesignal/applications/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ packetId: packet.id }),
      });
      await loadWorkspace();
      setToast("Approved for browser fill. Final submission is still manual.");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "This packet cannot be approved yet.");
    } finally {
      setBusy("");
    }
  }

  async function copyBrowserPacket(packet: ApplicationPacket) {
    try {
      const result = await api<{ packet: Record<string, unknown> }>(`/api/rolesignal/applications/browser-packet?id=${encodeURIComponent(packet.id)}`);
      await navigator.clipboard.writeText(JSON.stringify(result.packet, null, 2));
      setToast("Browser packet copied. Paste it into the RoleSignal companion.");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "The browser packet could not be copied.");
    }
  }

  async function copyApplicationKit(packet: ApplicationPacket) {
    try {
      const result = await api<{ kit: ApplicationPacket["kit"] & { company: string; role: string; score: number } }>(`/api/rolesignal/applications/kit?id=${encodeURIComponent(packet.id)}`);
      const kit = result.kit;
      if (!kit) throw new Error("Application kit is not ready.");
      const text = [
        `# ${kit.company} - ${kit.role}`,
        `Match score: ${kit.score}/100`,
        "",
        "## Application strategy",
        kit.summary,
        "",
        "## Why this role",
        kit.whyAnswer,
        "",
        "## Resume changes",
        ...(kit.resumeChanges || []).map((item) => `- ${item}`),
        "",
        "## Supporting evidence",
        ...(kit.evidence || []).map((item) => `- ${item}`),
      ].join("\n");
      await navigator.clipboard.writeText(text);
      setToast("Application kit copied as clean Markdown.");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "The application kit could not be copied.");
    }
  }

  function openApplication(packet: ApplicationPacket) {
    window.open(packet.applicationUrl, "_blank", "noopener,noreferrer");
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
          <span><strong>{profile.name}</strong><small>{profile.title}</small></span>
          <b>v4</b>
        </div>
        <nav aria-label="Primary navigation">
          <p className="nav-label">Workspace</p>
          {navItems.map((item) => (
            <button key={item.id} className={view === item.id ? "nav-item active" : "nav-item"} onClick={() => setView(item.id)}>
              <span>{item.mark}</span>{item.label}
              {item.id === "discovery" && discoveryRuns.length > 0 && <b>{discoveryRuns.length}</b>}
              {item.id === "matches" && <b>{liveJobs.length}</b>}
              {item.id === "runs" && searchRuns.length > 0 && <b>{searchRuns.length}</b>}
              {item.id === "applications" && packets.length > 0 && <b>{packets.length}</b>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="autopilot-mini">
            <span className="pulse-dot" />
            <div><strong>{autoApply ? "Auto-stage is on" : "Review mode is on"}</strong><small>Final submit always stays manual</small></div>
            <button className={autoApply ? "switch on" : "switch"} onClick={() => { const next = !autoApply; setAutoApply(next); void saveRules(next); }} aria-label="Toggle auto-stage"><span /></button>
          </div>
          <a className="help-link" href="/rolesignal-browser-companion.zip" download><span>+</span> Browser companion</a>
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div className="mobile-brand"><span className="brand-mark"><span /></span>RoleSignal</div>
          <select className="mobile-view-select" value={view} onChange={(event) => setView(event.target.value as View)} aria-label="Choose section">
            {navItems.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
          <div className="top-actions">
            <span className="secure-pill"><i /> Evidence-locked</span>
            <span className="phase-pill">Phase 4</span>
            <button className="avatar-button" aria-label="Career profile">RK</button>
          </div>
        </header>

        {view === "dashboard" && (
          <div className="page dashboard-page">
            <section className="hero-row">
              <div>
                <span className="eyebrow">Cross-portal discovery workspace</span>
                <h1>Find work worth applying for.</h1>
                <p>{liveJobs.length ? `${liveJobs.length} roles from public feeds, company boards and portal captures have been scored against verified engineering evidence.` : "Run discovery across public feeds, company boards and browser-assisted job portals."}</p>
              </div>
              <button className="primary-button" disabled={busy === "discovery-run"} onClick={() => void runDiscovery()}><span>&#8599;</span>{busy === "discovery-run" ? "Searching feeds..." : "Discover matching jobs"}</button>
            </section>

            {latestDiscovery && <section className="latest-run-strip discovery-strip"><div><span className={`run-status ${latestDiscovery.status.toLowerCase()}`}>{readableStatus(latestDiscovery.status)}</span><span><strong>Latest cross-portal discovery</strong><small>{latestDiscovery.discovered} listings checked / {latestDiscovery.imported} new / {latestDiscovery.qualified} qualified / {postedLabel(latestDiscovery.completedAt || latestDiscovery.startedAt)}</small></span></div><button className="text-button" onClick={() => setView("discovery")}>Open discovery -&gt;</button></section>}
            {latestRun && <section className="latest-run-strip"><div><span className={`run-status ${latestRun.status.toLowerCase()}`}>{readableStatus(latestRun.status)}</span><span><strong>Latest search run</strong><small>{latestRun.uniqueJobs} unique jobs / {latestRun.ready} ready to review / {postedLabel(latestRun.completedAt || latestRun.startedAt)}</small></span></div><button className="text-button" onClick={() => setView("runs")}>Open run center -&gt;</button></section>}

            <section className="metric-grid" aria-label="Job search metrics">
              <Metric label="Live roles" value={String(liveJobs.length)} note={latestDiscovery ? `${latestDiscovery.providers.length} discovery providers` : "Ready for discovery"} trend={liveJobs.length ? "up" : "neutral"} />
              <Metric label="Strong matches" value={String(liveJobs.filter((job) => job.score >= 82).length)} note="82+ match score" trend="up" />
              <Metric label="Ready to review" value={String(qualifiedJobs.length)} note={`Threshold ${threshold}+`} trend="neutral" />
              <Metric label="Needs attention" value={String(needsAttention)} note="Unknown required answers" trend={needsAttention ? "warn" : "up"} />
            </section>

            {!liveJobs.length && workspaceLoaded && (
              <section className="setup-banner">
                <div><span className="card-kicker">Curated preview</span><h3>Your discovery engine is ready.</h3><p>The roles below demonstrate scoring. Run public discovery or capture a signed-in LinkedIn, Naukri, Workday, or Indeed results page.</p></div>
                <button className="secondary-button" onClick={() => setView("discovery")}>Open discovery</button>
              </section>
            )}

            <section className="content-grid">
              <div className="opportunities-column">
                <div className="section-heading">
                  <div><span className="eyebrow">Ranked for you</span><h2>{liveJobs.length ? "Highest-signal opportunities" : "What a strong match looks like"}</h2></div>
                  <button className="text-button" onClick={() => setView("matches")}>View all matches -&gt;</button>
                </div>
                <div className="job-stack">
                  {displayJobs.slice(0, 3).map((job) => <JobCard key={job.id} job={job} onReview={() => void prepareApplication(job)} busy={busy === `prepare-${job.id}`} />)}
                </div>
              </div>
              <aside className="insights-column">
                <ResumePanel resumeName={resumeName} state={uploadState} onChoose={() => fileInput.current?.click()} />
                <div className="insight-card differentiation-card">
                  <span className="card-kicker">Your differentiator</span>
                  <h3>AI voice + distributed backend</h3>
                  <p>Scores translate queues, caching, scale and production ownership into equivalent JD requirements. Language mismatch stays separate from engineering mismatch.</p>
                  <div className="signal-bars"><span style={{ width: "92%" }} /><span style={{ width: "76%" }} /><span style={{ width: "87%" }} /></div>
                </div>
                <div className="insight-card preference-card">
                  <div className="card-heading"><span className="card-kicker">Safety posture</span><button onClick={() => setView("autopilot")}>Edit</button></div>
                  <PreferenceRow label="Preparation" value={autoApply ? "Auto-stage" : "Manual"} />
                  <PreferenceRow label="Minimum score" value={`${threshold}/100`} />
                  <PreferenceRow label="Unknown answers" value="Always pause" />
                  <PreferenceRow label="Submission" value="Manual only" />
                </div>
              </aside>
            </section>
          </div>
        )}

        {view === "discovery" && (
          <div className="page inner-page discovery-page">
            <PageTitle eyebrow="Market-wide discovery" title="Search beyond one company" copy="Combine broad public feeds, connected company boards and jobs captured from your signed-in portal searches. Every listing enters the same resume-scoring pipeline." action={busy === "discovery-run" ? "Searching feeds..." : "Run public discovery"} actionDisabled={busy === "discovery-run"} onAction={() => void runDiscovery()} />

            <section className="discovery-hero-grid">
              <form className="discovery-config-card" onSubmit={runDiscovery}>
                <div className="card-heading"><div><span className="card-kicker">Saved search profile</span><h2>What should RoleSignal hunt for?</h2></div><span className="verified-tag">Resume-linked</span></div>
                <label>Search name<input value={discoveryForm.name} onChange={(event) => setDiscoveryForm({ ...discoveryForm, name: event.target.value })} /></label>
                <label>Target roles and technologies<input value={discoveryForm.keywords} onChange={(event) => setDiscoveryForm({ ...discoveryForm, keywords: event.target.value })} placeholder="Backend Engineer, Platform Engineer, Node.js" /><small>Separate targets with commas.</small></label>
                <label>Locations<input value={discoveryForm.locations} onChange={(event) => setDiscoveryForm({ ...discoveryForm, locations: event.target.value })} placeholder="India, Remote, APAC" /></label>
                <div className="discovery-controls"><label>Minimum match<input type="number" min={65} max={95} value={discoveryForm.minScore} onChange={(event) => setDiscoveryForm({ ...discoveryForm, minScore: Number(event.target.value) })} /></label><div><span>Work modes</span><div className="mode-pills">{["Remote", "Hybrid", "On-site"].map((mode) => <button type="button" key={mode} className={discoveryForm.workModes.includes(mode) ? "active" : ""} onClick={() => setDiscoveryForm({ ...discoveryForm, workModes: discoveryForm.workModes.includes(mode) ? discoveryForm.workModes.filter((value) => value !== mode) : [...discoveryForm.workModes, mode] })}>{mode}</button>)}</div></div></div>
                <button className="primary-button wide" disabled={busy === "discovery-run"}>{busy === "discovery-run" ? "Fetching, deduplicating and scoring..." : "Search public feeds and company boards"}</button>
                <p className="refresh-note">Public feeds refresh at most once per hour. Existing results are reused between refreshes.</p>
              </form>

              <aside className="coverage-card">
                <span className="card-kicker">Coverage map</span><h2>Three discovery lanes</h2><p>No single API covers the whole job market. RoleSignal combines the reliable paths without bypassing logins or bot protection.</p>
                <div className="coverage-row"><span className="coverage-mark public">01</span><span><strong>Public job feeds</strong><small>Jobicy remote roles + Arbeitnow aggregated ATS listings</small></span><b>Automatic</b></div>
                <div className="coverage-row"><span className="coverage-mark ats">02</span><span><strong>Company ATS boards</strong><small>{sources.length ? `${sources.length} Greenhouse / Lever boards connected` : "Connect Greenhouse or Lever boards"}</small></span><b>Automatic</b></div>
                <div className="coverage-row"><span className="coverage-mark portal">03</span><span><strong>Signed-in portals</strong><small>LinkedIn, Naukri, Workday and Indeed via companion capture</small></span><b>Assisted</b></div>
                <a className="download-button" href="/rolesignal-browser-companion.zip" download>Download Discovery Companion v0.4</a>
              </aside>
            </section>

            <section className="portal-search-section">
              <div className="section-heading"><div><span className="eyebrow">Authenticated portal searches</span><h2>Launch your search, then capture visible jobs</h2></div><span className="quiet-label">Your login stays in your browser</span></div>
              <div className="portal-grid">{portalSearches.map((portal) => <a key={portal.name} href={portal.url} target="_blank" rel="noreferrer"><span className="portal-mark">{portal.mark}</span><span><strong>{portal.name}</strong><small>{portal.note}</small></span><b>-&gt;</b></a>)}<div className="portal-info"><span className="portal-mark">W</span><span><strong>Workday</strong><small>Open a company&apos;s Workday careers page</small></span><b>Per company</b></div></div>
            </section>

            <section className="capture-workflow">
              <div className="capture-instructions"><span className="card-kicker">Browser-assisted capture</span><h2>Bring signed-in results into RoleSignal</h2><ol><li><b>1</b><span>Open a results page on LinkedIn, Naukri, Workday or Indeed.</span></li><li><b>2</b><span>Open the RoleSignal companion and choose <strong>Capture visible jobs</strong>.</span></li><li><b>3</b><span>Paste the copied discovery batch here and import it.</span></li></ol><p>The companion reads only the job cards visible in your active tab. It does not crawl hidden pages, bypass CAPTCHAs or submit applications.</p></div>
              <form className="capture-import-card" onSubmit={importPortalCapture}><div className="card-heading"><span className="card-kicker">Discovery batch</span><button type="button" onClick={() => void pasteCapture()}>Paste from clipboard</button></div><textarea required rows={9} value={captureText} onChange={(event) => setCaptureText(event.target.value)} placeholder={'Paste JSON from the browser companion\n{ "captureVersion": 1, "portal": "LinkedIn", "jobs": [...] }'} /><button className="primary-button wide" disabled={busy === "capture-import"}>{busy === "capture-import" ? "Normalizing and scoring..." : "Import captured jobs"}</button></form>
            </section>

            {latestDiscovery && <section className="discovery-results">
              <div className="discovery-results-head"><div><span className="card-kicker">Latest discovery / {readableStatus(latestDiscovery.mode)}</span><h2>{latestDiscovery.qualified} qualified matches surfaced</h2><p>{latestDiscovery.discovered} listings inspected, {latestDiscovery.imported} new jobs imported and {latestDiscovery.duplicates} duplicates merged.</p></div><div><span className={`run-status ${latestDiscovery.status.toLowerCase()}`}>{readableStatus(latestDiscovery.status)}</span><a className="secondary-button" href={`/api/rolesignal/export/discovery-run.md?id=${encodeURIComponent(latestDiscovery.id)}`} download>Download report</a></div></div>
              <div className="provider-strip">{latestDiscovery.providers.map((provider) => <span key={provider.provider}><strong>{provider.provider}</strong><small>{provider.discovered} checked / {provider.imported} new</small></span>)}</div>
              {(latestDiscovery.report.highestPriority || []).length ? <><div className="section-heading discovery-priority-heading"><div><span className="eyebrow">Highest priority</span><h2>Best applications from this run</h2></div><button className="text-button" onClick={() => setView("matches")}>Review full match list -&gt;</button></div><div className="priority-grid">{(latestDiscovery.report.highestPriority || []).map((job, index) => <article className="priority-card" key={job.id}><span className="priority-number">0{index + 1}</span><span className="card-kicker">{job.company} / {job.platform}</span><h3>{job.role}</h3><p>{job.location} / {job.workMode}</p><div className="priority-score"><strong>{job.score}</strong><span>match<br />score</span></div><button className="text-button" onClick={() => void prepareApplication(job)}>Prepare application -&gt;</button></article>)}</div></> : <div className="discovery-no-match"><strong>No qualified roles in this run.</strong><span>Broaden the location or role terms, or capture another portal results page.</span></div>}
            </section>}

            {discoveryRuns.length > 0 && <section className="run-history discovery-history"><div className="section-heading"><div><span className="eyebrow">Discovery history</span><h2>Public and portal runs together</h2></div></div>{discoveryRuns.slice(0, 8).map((run) => <div className="run-row" key={run.id}><span className={`run-status ${run.status.toLowerCase()}`}>{readableStatus(run.status)}</span><span><strong>{readableStatus(run.mode)}</strong><small>{postedLabel(run.completedAt || run.startedAt)} / {run.discovered} checked / {run.imported} new</small></span><span><b>{run.qualified}</b><small>qualified</small></span><a href={`/api/rolesignal/export/discovery-run.md?id=${encodeURIComponent(run.id)}`} download>Report</a></div>)}</section>}
          </div>
        )}

        {view === "matches" && (
          <div className="page inner-page">
            <PageTitle eyebrow="Explainable matching" title="Every score has receipts" copy="Backend fit, distributed systems, stack proximity, infrastructure and role quality remain separately inspectable." action="Discover more jobs" onAction={() => setView("discovery")} />
            <div className="filter-row">
              <span className="filter active">All {displayJobs.length}</span>
              <span className="filter">Exceptional {displayJobs.filter((job) => job.score >= 90).length}</span>
              <span className="filter">Strong {displayJobs.filter((job) => job.score >= 82 && job.score < 90).length}</span>
              <span className="filter">Good {displayJobs.filter((job) => job.score >= 75 && job.score < 82).length}</span>
            </div>
            <div className="matches-layout">
              <div className="job-stack expanded">
                {displayJobs.map((job) => <JobCard key={job.id} job={job} expanded onReview={() => void prepareApplication(job)} busy={busy === `prepare-${job.id}`} />)}
              </div>
              <aside className="score-legend">
                <span className="card-kicker">100-point rubric</span><h3>Signal over keywords.</h3><p>A language gap can be learned. An engineering-domain mismatch is treated much more seriously.</p>
                {[["Backend engineering", "20"], ["Distributed systems", "15"], ["Stack proximity", "15"], ["Data systems", "10"], ["Cloud & infrastructure", "10"], ["AI / voice advantage", "10"], ["Experience level", "10"], ["Quality & recency", "10"]].map(([label, score]) => <div className="legend-row" key={label}><span>{label}</span><b>{score}</b></div>)}
              </aside>
            </div>
          </div>
        )}

        {view === "sources" && (
          <div className="page inner-page">
            <PageTitle eyebrow="Live ingestion" title="Bring official jobs into one signal" copy="Scan public Greenhouse and Lever boards, or import a single official job page and full description." action={sources.length ? (busy === "scan-all" ? "Running all sources..." : "Run all connected") : undefined} actionDisabled={busy === "scan-all"} onAction={() => void runAllSources()} />
            <div className="source-grid">
              <form className="source-card" onSubmit={scanSource}>
                <span className="card-kicker">ATS board scan</span><h3>Connect a company board</h3><p>Use the company token from a Greenhouse or Lever careers URL. Public job listings are fetched without application credentials.</p>
                <label>Provider<select value={sourceForm.provider} onChange={(event) => setSourceForm({ ...sourceForm, provider: event.target.value })}><option value="greenhouse">Greenhouse</option><option value="lever">Lever</option></select></label>
                <label>Company token<input required value={sourceForm.token} onChange={(event) => setSourceForm({ ...sourceForm, token: event.target.value })} placeholder="example-company" /></label>
                <label>Company name<input value={sourceForm.label} onChange={(event) => setSourceForm({ ...sourceForm, label: event.target.value })} placeholder="Example Company" /></label>
                <button className="primary-button wide" disabled={busy === "source-scan"}>{busy === "source-scan" ? "Scanning and scoring..." : "Scan published roles"}</button>
              </form>

              <form className="source-card import-card" onSubmit={importJob}>
                <span className="card-kicker">Single opportunity</span><h3>Import any official job</h3><p>RoleSignal attempts to read the page. Paste the description when the careers site blocks automated retrieval.</p>
                <label className="full-field">Official application URL<input required type="url" value={jobForm.jobUrl} onChange={(event) => setJobForm({ ...jobForm, jobUrl: event.target.value })} placeholder="https://company.com/careers/job" /></label>
                <div className="form-split"><label>Company<input value={jobForm.company} onChange={(event) => setJobForm({ ...jobForm, company: event.target.value })} placeholder="Auto-detect" /></label><label>Role<input value={jobForm.role} onChange={(event) => setJobForm({ ...jobForm, role: event.target.value })} placeholder="Auto-detect" /></label></div>
                <div className="form-split"><label>Location<input value={jobForm.location} onChange={(event) => setJobForm({ ...jobForm, location: event.target.value })} placeholder="Bengaluru / Remote" /></label><label>Posted<input value={jobForm.postedDate} onChange={(event) => setJobForm({ ...jobForm, postedDate: event.target.value })} placeholder="Today / 2026-08-16" /></label></div>
                <label className="full-field">Full job description<textarea value={jobForm.description} onChange={(event) => setJobForm({ ...jobForm, description: event.target.value })} placeholder="Optional unless the page blocks import" rows={5} /></label>
                <button className="secondary-button wide" disabled={busy === "job-import"}>{busy === "job-import" ? "Reading and scoring..." : "Import and score"}</button>
              </form>
            </div>

            {scanReport && <section className="run-report"><div><span className="card-kicker">Latest run report</span><h3>{scanReport.source} via {readableStatus(scanReport.provider)}</h3></div><Metric label="Discovered" value={String(scanReport.discovered)} note="Published jobs" trend="neutral" /><Metric label="Unique" value={String(scanReport.unique)} note={`${scanReport.duplicates} duplicates`} trend="up" /><Metric label="Strong" value={String(scanReport.strong)} note="Score 82+" trend="up" /><Metric label="Ready" value={String(scanReport.ready)} note="Score 75+" trend="up" /><Metric label="Skipped" value={String(scanReport.skipped)} note="Reasons retained" trend="neutral" /></section>}

            {sources.length > 0 && <section className="connected-sources"><div className="section-heading"><div><span className="eyebrow">Persistent sources</span><h2>Connected career boards</h2></div></div>{sources.map((source) => <div className="source-row" key={source.id}><span className="source-logo">{source.provider === "greenhouse" ? "GH" : "LV"}</span><span><strong>{source.label}</strong><small>{readableStatus(source.provider)} / {source.source_token}</small></span><b>{source.last_scanned_at ? `Scanned ${postedLabel(source.last_scanned_at)}` : "Ready"}</b><button className="text-button" disabled={busy === `source-remove-${source.id}`} onClick={() => void disconnectSource(source.id)}>Disconnect</button></div>)}</section>}
          </div>
        )}

        {view === "runs" && (
          <div className="page inner-page">
            <PageTitle eyebrow="Search operations" title="One run. Every connected source." copy="Scan all active boards, deduplicate listings, score the full set and keep a durable report of what deserves attention." action={sources.length ? (busy === "scan-all" ? "Running search..." : "Run all sources") : "Connect a source"} actionDisabled={busy === "scan-all"} onAction={() => sources.length ? void runAllSources() : setView("sources")} />
            {!latestRun ? <EmptyState title="No full search run yet" copy="Connect a public Greenhouse or Lever board, then run the complete search workflow from here." action={sources.length ? "Run all sources" : "Connect a source"} onAction={() => sources.length ? void runAllSources() : setView("sources")} /> : <>
              <section className="run-hero-card">
                <div className="run-hero-heading"><div><span className="card-kicker">Latest run / {postedLabel(latestRun.completedAt || latestRun.startedAt)}</span><h2>{latestRun.ready} roles ready for deliberate review</h2><p>{latestRun.sourceCount} sources scanned. Duplicates, hard filters and scoring decisions are retained in the report.{latestRun.report.autoStaged?.length ? ` ${latestRun.report.autoStaged.length} qualified application kit${latestRun.report.autoStaged.length === 1 ? " was" : "s were"} staged for review.` : ""}</p></div><span className={`run-status ${latestRun.status.toLowerCase()}`}>{readableStatus(latestRun.status)}</span></div>
                <div className="run-summary-grid"><Metric label="Discovered" value={String(latestRun.jobsDiscovered)} note={`${latestRun.uniqueJobs} unique`} trend="neutral" /><Metric label="Analyzed" value={String(latestRun.analyzed)} note="Evidence scored" trend="up" /><Metric label="Exceptional" value={String(latestRun.exceptional)} note="Score 90+" trend="up" /><Metric label="Strong" value={String(latestRun.strong)} note="Score 82-89" trend="up" /><Metric label="Needs input" value={String(latestRun.needsInput)} note="Approval blocked" trend={latestRun.needsInput ? "warn" : "up"} /></div>
                <div className="run-actions"><a className="secondary-button" href={`/api/rolesignal/export/run.md?id=${encodeURIComponent(latestRun.id)}`} download>Download run report</a><button className="primary-button" onClick={() => setView("matches")}>Review all matches</button></div>
              </section>

              <section className="priority-section"><div className="section-heading"><div><span className="eyebrow">Highest priority</span><h2>The three applications worth focusing on</h2></div></div><div className="priority-grid">{(latestRun.report.highestPriority || []).map((job, index) => <article className="priority-card" key={job.id}><span className="priority-number">0{index + 1}</span><span className="card-kicker">{job.company}</span><h3>{job.role}</h3><p>{job.location} / {job.workMode}</p><div className="priority-score"><strong>{job.score}</strong><span>match<br />score</span></div><button className="text-button" onClick={() => void prepareApplication(job)}>Prepare application -&gt;</button></article>)}</div></section>

              {latestRun.report.failures?.length ? <section className="run-issues"><span className="card-kicker">Source issues retained</span>{latestRun.report.failures.map((failure) => <div key={`${failure.source}-${failure.message}`}><strong>{failure.source}</strong><span>{failure.message}</span></div>)}</section> : null}

              <section className="run-history"><div className="section-heading"><div><span className="eyebrow">Run history</span><h2>Every search, traceable</h2></div></div>{searchRuns.map((run) => <div className="run-row" key={run.id}><span className={`run-status ${run.status.toLowerCase()}`}>{readableStatus(run.status)}</span><span><strong>{postedLabel(run.completedAt || run.startedAt)}</strong><small>{run.sourceCount} sources / {run.jobsDiscovered} discovered / {run.uniqueJobs} unique</small></span><span><b>{run.ready}</b><small>ready</small></span><a href={`/api/rolesignal/export/run.md?id=${encodeURIComponent(run.id)}`} download>Report</a></div>)}</section>
            </>}
          </div>
        )}

        {view === "autopilot" && (
          <div className="page inner-page">
            <PageTitle eyebrow="Approval-first automation" title="Automation that knows where to stop" copy="RoleSignal can stage qualified applications and fill supported fields. It never guesses, bypasses protection or clicks final submit." />
            <div className="autopilot-grid">
              <section className="rules-card">
                <div className="rules-hero"><div><span className="pulse-dot" /><span><strong>{autoApply ? "Auto-stage is active" : "Review mode is active"}</strong><small>{autoApply ? "Qualified jobs can enter the preparation queue." : "You choose every job before preparation."}</small></span></div><button className={autoApply ? "switch large on" : "switch large"} onClick={() => { const next = !autoApply; setAutoApply(next); void saveRules(next); }}><span /></button></div>
                <RuleSlider label="Minimum match score" value={threshold} min={70} max={95} onChange={setThreshold} suffix="/100" help={`${qualifiedJobs.length} live roles currently qualify`} />
                <RuleSlider label="Daily preparation limit" value={dailyLimit} min={1} max={12} onChange={setDailyLimit} suffix=" roles" help="A quality cap, not an application quota" />
                <Guardrail title="Unknown required answers" copy="Compensation, notice period, authorization and declarations" value="Always pause" />
                <Guardrail title="CAPTCHA or bot protection" copy="No bypasses or security workarounds" value="Manual action" />
                <Guardrail title="Final submission" copy="Browser companion fills but never submits" value="You click" />
                <button className="primary-button wide" onClick={() => void saveRules()}>Save automation rules</button>
              </section>
              <aside className="guardrail-card">
                <div className="shield-mark">✓</div><span className="card-kicker">Browser companion</span><h3>Fill the facts. Stop at judgment.</h3><p>The extension accepts a signed-off application packet, fills only mapped fields on supported ATS pages and highlights anything it cannot verify.</p>
                <ul><li><i>✓</i> Greenhouse, Lever and Ashby pages</li><li><i>✓</i> Host-locked application packets</li><li><i>✓</i> Unknown required-field detection</li><li><i>✓</i> No automatic final submission</li></ul>
                <a className="download-button" href="/rolesignal-browser-companion.zip" download>Download Chrome companion</a>
              </aside>
            </div>
          </div>
        )}

        {view === "applications" && (
          <div className="page inner-page">
            <PageTitle eyebrow="Application ledger" title="Prepared, blocked and approved" copy="Every state change remains traceable. Approval means browser fill is allowed; final submission remains your action." action="Export ledger" onAction={() => { window.location.href = "/api/rolesignal/export/ledger.csv"; }} />
            {!packets.length ? <EmptyState title="No application packets yet" copy="Prepare a qualified live match to generate resume guidance and a browser-safe field packet." action="Review matches" onAction={() => setView("matches")} /> : <div className="packet-stack">{packets.map((packet) => <article className="packet-card" key={packet.id}>
              <div className="packet-main"><div><span className="card-kicker">{packet.company}</span><h3>{packet.role}</h3><p><b>{packet.score}/100</b> match / Resume: {packet.resumeStrategy.fit || "DEFAULT"}</p></div><span className={`packet-status ${packet.status.toLowerCase()}`}>{readableStatus(packet.status)}</span></div>
              {packet.kit && <div className="kit-box"><div><span className="card-kicker">Reusable application kit</span><p>{packet.kit.summary}</p></div><div className="kit-answer"><strong>Why this role</strong><p>{packet.kit.whyAnswer}</p></div></div>}
              {packet.resumeStrategy.changes?.length ? <div className="packet-guidance"><strong>Recommended evidence order</strong><ul>{packet.resumeStrategy.changes.map((change) => <li key={change}>{change}</li>)}</ul></div> : null}
              {packet.blockers.length > 0 && <div className="blocker-box"><strong>Needs your input</strong>{packet.blockers.map((blocker) => <span key={blocker.id}>{blocker.question}</span>)}</div>}
              <div className="packet-actions">{packet.kit && <button className="secondary-button" onClick={() => void copyApplicationKit(packet)}>Copy application kit</button>}<button className="secondary-button" onClick={() => void copyBrowserPacket(packet)}>Copy browser packet</button><button className="secondary-button" onClick={() => openApplication(packet)}>Open application</button><button className="primary-button" disabled={packet.blockers.length > 0 || packet.status === "APPROVED_FOR_FILL" || busy === `approve-${packet.id}`} onClick={() => void approvePacket(packet)}>{packet.status === "APPROVED_FOR_FILL" ? "Approved for fill" : "Approve for fill"}</button></div>
            </article>)}</div>}
          </div>
        )}

        {view === "profile" && (
          <div className="page inner-page">
            <PageTitle eyebrow="Source of truth" title="Your verified career profile" copy="PDF, DOCX and TXT resumes are extracted locally, then stored with the evidence used for matching." action="Upload new resume" onAction={() => fileInput.current?.click()} />
            <div className="profile-grid">
              <section className="profile-card wide-card"><span className="card-kicker">Current profile</span><div className="profile-title"><div className="company-avatar">RK</div><div><h3>{profile.title}</h3><p>{profile.name} / approximately {profile.experienceYears || 3} years</p></div><span className="verified-tag">✓ Evidence locked</span></div><p className="profile-summary">{profile.domains.slice(0, 5).join(" / ")}</p></section>
              <ResumePanel resumeName={resumeName} state={uploadState} onChoose={() => fileInput.current?.click()} />
              <section className="profile-card wide-card"><div className="card-heading"><span className="card-kicker">Extracted evidence</span><span className="quiet-label">{profile.source === "resume" ? "Resume-derived" : "Verified brief"}</span></div><div className="evidence-list">{profile.evidence.slice(0, 6).map((item) => <p key={item}>{item}</p>)}</div></section>
              <section className="profile-card wide-card"><span className="card-kicker">Verified skills</span><div className="skill-cloud">{profile.skills.slice(0, 24).map((skill) => <span key={skill}>{skill}<i>✓</i></span>)}</div></section>
              <form className="profile-card wide-card answer-vault-card" onSubmit={saveAnswerVault}><div className="card-heading"><div><span className="card-kicker">Verified answer vault</span><h3>Facts safe to reuse</h3></div><span className="quiet-label">{answerVault.length}/9 saved</span></div><p>Store recurring form answers once. RoleSignal can fill only these verified values; sensitive or missing judgments still pause for you.</p><div className="vault-grid">{answerFields.map((field) => <label className="vault-field" key={field.key}><span>{field.label}{field.sensitive && <i className="sensitive-tag">Sensitive</i>}</span><input type={field.key === "phone" ? "tel" : field.key.endsWith("_url") ? "url" : "text"} value={answerValues[field.key] || ""} placeholder={field.placeholder} onChange={(event) => setAnswerValues({ ...answerValues, [field.key]: event.target.value })} /></label>)}</div><div className="vault-footer"><span>Saved values are private to this signed-in workspace.</span><button className="primary-button" disabled={busy === "answer-vault"}>{busy === "answer-vault" ? "Saving..." : "Save verified answers"}</button></div></form>
              <section className="profile-card paste-card"><span className="card-kicker">Fallback extraction</span><h3>Paste resume text</h3><p>Use this when a scanned PDF contains no selectable text. Nothing is inferred beyond the pasted evidence.</p><textarea rows={9} value={resumeText} onChange={(event) => setResumeText(event.target.value)} placeholder="Paste the complete resume text here..." /><button className="secondary-button wide" disabled={busy === "resume-text"} onClick={() => void analyzePastedResume()}>{busy === "resume-text" ? "Analyzing..." : "Analyze pasted resume"}</button></section>
            </div>
          </div>
        )}
      </main>
      <input ref={fileInput} className="sr-only" type="file" accept=".pdf,.docx,.txt" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadResume(file); }} />
      {toast && <div className="toast"><span>✓</span>{toast}</div>}
    </div>
  );
}

function Metric({ label, value, note, trend }: { label: string; value: string; note: string; trend: string }) {
  return <div className="metric-card"><span>{label}</span><strong>{value}</strong><small className={trend}>{trend === "up" ? "↗" : trend === "warn" ? "!" : "•"} {note}</small></div>;
}

function JobCard({ job, onReview, expanded = false, busy = false }: { job: MatchJob; onReview: () => void; expanded?: boolean; busy?: boolean }) {
  const ringStyle = { "--score": `${job.score * 3.6}deg` } as CSSProperties;
  const initials = job.company.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  return <article className={expanded ? "job-card expanded" : "job-card"}>
    <div className="job-main"><div className="company-logo green">{initials}</div><div className="job-info"><div className="job-company"><span>{job.company}</span>{job.highPriority && <i>High priority</i>}{job.isSample && <i>Sample</i>}</div><h3>{job.role}</h3><p>{job.location}<b>·</b>{job.workMode}<b>·</b>{postedLabel(job.postedDate)}<b>·</b>{job.platform}</p><div className="tag-row">{job.matchingExperience.slice(0, 3).map((tag) => <span key={tag}>{tag}</span>)}</div></div></div>
    <div className="job-actions"><div className="score-ring" style={ringStyle}><span><b>{job.score}</b><small>match</small></span></div></div>
    {expanded && <div className="job-explanation"><div><span className="fit-label">Matching experience</span>{job.matchingExperience.length ? job.matchingExperience.slice(0, 3).map((item) => <p key={item}>{item}</p>) : <p>No verified overlap was strong enough to cite.</p>}</div><div><span className="gap-label">Missing / watch-outs</span>{[...job.missingRequirements, ...job.redFlags].length ? [...job.missingRequirements, ...job.redFlags].slice(0, 3).map((item) => <p key={item}>{item}</p>) : <p>No material gap detected.</p>}</div></div>}
    <div className="job-footer"><span className="match-class"><i />{job.classification} match</span><span>{readableStatus(job.status)}</span><button disabled={busy || job.status === "SKIPPED"} onClick={onReview}>{busy ? "Preparing..." : job.status === "SKIPPED" ? "Not eligible" : "Prepare application"} -&gt;</button></div>
  </article>;
}

function ResumePanel({ resumeName, state, onChoose }: { resumeName: string; state: string; onChoose: () => void }) {
  const status = state === "extracting" ? "Extracting text locally..." : state === "uploading" ? "Saving verified evidence..." : state === "saved" ? "Analyzed and stored" : state === "error" ? "Needs attention" : "PDF / DOCX / TXT supported";
  return <div className="insight-card resume-card"><div className="resume-icon"><span>CV</span></div><div className="resume-copy"><span className="card-kicker">Primary resume</span><h3>{resumeName}</h3><p>{status}</p></div><button onClick={onChoose}>{state === "extracting" || state === "uploading" ? "..." : "Replace"}</button><div className="resume-progress"><span style={{ width: state === "extracting" ? "35%" : state === "uploading" ? "72%" : "100%" }} /></div></div>;
}

function PreferenceRow({ label, value }: { label: string; value: string }) {
  return <div className="preference-row"><span>{label}</span><strong>{value}</strong></div>;
}

function PageTitle({ eyebrow, title, copy, action, actionDisabled = false, onAction }: { eyebrow: string; title: string; copy: string; action?: string; actionDisabled?: boolean; onAction?: () => void }) {
  return <section className="page-title"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{copy}</p></div>{action && <button className="primary-button" disabled={actionDisabled} onClick={onAction}><span>+</span>{action}</button>}</section>;
}

function RuleSlider({ label, value, min, max, onChange, suffix, help }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void; suffix: string; help: string }) {
  const width = ((value - min) / (max - min)) * 100;
  return <div className="slider-block"><div><span><strong>{label}</strong><small>{help}</small></span><b>{value}{suffix}</b></div><input aria-label={label} type="range" min={min} max={max} value={value} style={{ "--range": `${width}%` } as CSSProperties} onChange={(event) => onChange(Number(event.target.value))} /></div>;
}

function Guardrail({ title, copy, value }: { title: string; copy: string; value: string }) {
  return <div className="rule-block"><span><strong>{title}</strong><small>{copy}</small></span><span className="rule-value safe">{value}</span></div>;
}

function EmptyState({ title, copy, action, onAction }: { title: string; copy: string; action: string; onAction: () => void }) {
  return <section className="empty-state"><span className="empty-mark">↗</span><h3>{title}</h3><p>{copy}</p><button className="primary-button" onClick={onAction}>{action}</button></section>;
}
