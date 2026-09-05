"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { StudioView, type StudioContent, type StudioDocument } from "./studio-view";
import { ExecutionView, type ApplicationExecution, type CompanionDevice, type ExecutionSettings } from "./execution-view";

type View = "dashboard" | "discovery" | "matches" | "sources" | "runs" | "autopilot" | "applications" | "studio" | "execution" | "profile";
type DiscoveryScope = "BOTH" | "INDIA" | "GLOBAL_REMOTE";

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
  semanticMatches?: Array<{ requirement: string; evidence: string; confidence: "high" | "medium" }>;
  enrichedAt?: string;
  eligibility?: {
    decision: "ELIGIBLE" | "VERIFY" | "INELIGIBLE";
    status: string;
    label: string;
    confidence: "high" | "medium" | "low";
    reasons: string[];
  };
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
  providers: Array<{ provider: string; discovered: number; relevant?: number; imported: number; duplicates: number; eligible?: number; verify?: number; ineligible?: number }>;
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
    alertsCreated?: number;
    screening?: {
      fetched: number;
      roleOrLocationFiltered: number;
      indiaEligible: number;
      eligibilityNeedsVerification: number;
      locationRestricted: number;
    };
  };
  startedAt: string;
  completedAt?: string;
};

type AutomationSettings = {
  enabled: boolean;
  cadenceHours: number;
  minScore: number;
  browserAlerts: boolean;
  lastRunAt?: string;
  nextRunAt: string;
  lastStatus: string;
  lastError?: string;
  updatedAt: string;
};

type JobAlert = {
  id: string;
  jobId: string;
  discoveryRunId?: string;
  kind: string;
  status: string;
  title: string;
  summary: string;
  detail: { job?: MatchJob; score?: number; classification?: string };
  createdAt: string;
  readAt?: string;
};

type DiscoverySource = {
  id: string;
  name: string;
  lane: "PUBLIC_API" | "COMPANY_ATS" | "PORTAL_ALERTS" | "OPTIONAL_INDEX";
  status: "LIVE" | "CONNECTED" | "READY" | "NEEDS_KEY" | "NEVER_TESTED" | "DEGRADED" | "UNAVAILABLE";
  coverage: string;
  note: string;
  responseCount?: number;
  acceptedCount?: number;
  latencyMs?: number;
  lastAttemptAt?: string;
  lastSuccessAt?: string;
  lastError?: string;
};

type ProfileVersion = {
  id: string;
  resumeId?: string | null;
  version: number;
  status: string;
  profile: Profile;
  createdAt: string;
};

type AlertImport = {
  id: string;
  provider: string;
  subject: string;
  status: string;
  jobsFound: number;
  imported: number;
  duplicates: number;
  createdAt: string;
};

type Workspace = {
  user?: { id: string; email: string; name: string };
  profile: Profile;
  profileStatus: "EMPTY" | "PENDING_REVIEW" | "VERIFIED";
  activeProfileVersionId?: string | null;
  activeResumeId?: string | null;
  pendingProfileVersion?: ProfileVersion | null;
  jobs: MatchJob[];
  packets: ApplicationPacket[];
  sources: Array<{ id: string; provider: string; source_token: string; label: string; last_scanned_at?: string }>;
  resumes: Array<{ id: string; filename: string; status: string }>;
  preferences?: { match_threshold?: number; daily_limit?: number; auto_apply?: number };
  answerVault: AnswerVaultRow[];
  searchRuns: SearchRun[];
  discoverySearches: DiscoverySearch[];
  discoveryRuns: DiscoveryRun[];
  discoverySources: DiscoverySource[];
  automation?: AutomationSettings | null;
  alerts: JobAlert[];
  alertImports: AlertImport[];
  studioDocuments: StudioDocument[];
  executionSettings: ExecutionSettings;
  companionDevices: CompanionDevice[];
  executions: ApplicationExecution[];
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

const fallbackProfile: Profile = {
  name: "",
  email: "",
  title: "",
  experienceYears: 0,
  source: "resume",
  skills: [],
  domains: [],
  evidence: [],
};

const defaultExecutionSettings: ExecutionSettings = {
  enabled: false,
  minScore: 75,
  dailyLimit: 5,
  mode: "FILL_ONLY",
  requireTailoredResume: false,
};

const navItems: Array<{ id: View; label: string; mark: string }> = [
  { id: "dashboard", label: "Overview", mark: "01" },
  { id: "discovery", label: "Discover jobs", mark: "02" },
  { id: "applications", label: "Applications", mark: "03" },
  { id: "profile", label: "Profile & settings", mark: "04" },
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

function scopeFromLocations(locations: string[]): DiscoveryScope {
  const text = locations.join(" ").toLowerCase();
  const india = /india|bengaluru|bangalore|hyderabad|pune|mumbai|delhi|gurugram|noida|chennai/.test(text);
  const remote = /remote|worldwide|global|apac/.test(text);
  return india && remote ? "BOTH" : india ? "INDIA" : "GLOBAL_REMOTE";
}

function scopeSettings(scope: DiscoveryScope) {
  if (scope === "INDIA") return { locations: "India", workModes: ["Remote", "Hybrid", "On-site"] };
  if (scope === "GLOBAL_REMOTE") return { locations: "Remote, Worldwide, APAC", workModes: ["Remote"] };
  return { locations: "India, Remote, Worldwide, APAC", workModes: ["Remote", "Hybrid", "On-site"] };
}

export function RoleSignalApp() {
  const [view, setView] = useState<View>("dashboard");
  const [profile, setProfile] = useState<Profile>(fallbackProfile);
  const [profileStatus, setProfileStatus] = useState<Workspace["profileStatus"]>("EMPTY");
  const [activeProfileVersionId, setActiveProfileVersionId] = useState("");
  const [pendingProfile, setPendingProfile] = useState<ProfileVersion | null>(null);
  const [accountName, setAccountName] = useState("RoleSignal user");
  const [liveJobs, setLiveJobs] = useState<MatchJob[]>([]);
  const [packets, setPackets] = useState<ApplicationPacket[]>([]);
  const [sources, setSources] = useState<Workspace["sources"]>([]);
  const [searchRuns, setSearchRuns] = useState<SearchRun[]>([]);
  const [discoveryRuns, setDiscoveryRuns] = useState<DiscoveryRun[]>([]);
  const [discoverySources, setDiscoverySources] = useState<DiscoverySource[]>([]);
  const [automation, setAutomation] = useState<AutomationSettings | null>(null);
  const [alerts, setAlerts] = useState<JobAlert[]>([]);
  const [alertImports, setAlertImports] = useState<AlertImport[]>([]);
  const [studioDocuments, setStudioDocuments] = useState<StudioDocument[]>([]);
  const [selectedStudioId, setSelectedStudioId] = useState("");
  const [executionSettings, setExecutionSettings] = useState<ExecutionSettings>(defaultExecutionSettings);
  const [companionDevices, setCompanionDevices] = useState<CompanionDevice[]>([]);
  const [executions, setExecutions] = useState<ApplicationExecution[]>([]);
  const [connectionKey, setConnectionKey] = useState("");
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
  const [resumeName, setResumeName] = useState("No resume uploaded");
  const [uploadState, setUploadState] = useState<"idle" | "extracting" | "uploading" | "saved" | "error">("idle");
  const [resumeText, setResumeText] = useState("");
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState("");
  const [workspaceLoaded, setWorkspaceLoaded] = useState(false);
  const [scanReport, setScanReport] = useState<ScanReport | null>(null);
  const [sourceForm, setSourceForm] = useState({ provider: "greenhouse", token: "", label: "" });
  const [jobForm, setJobForm] = useState({ jobUrl: "", company: "", role: "", location: "", postedDate: "", description: "" });
  const [discoveryForm, setDiscoveryForm] = useState({
    name: "Backend roles / India + Global Remote",
    keywords: "Backend Engineer, Software Engineer, Platform Engineer, Node.js",
    locations: "India, Remote, Worldwide, APAC",
    workModes: ["Remote", "Hybrid", "On-site"],
    minScore: 65,
    scope: "BOTH" as DiscoveryScope,
  });
  const [alertForm, setAlertForm] = useState({ provider: "LinkedIn", subject: "", content: "" });
  const [alertFeedback, setAlertFeedback] = useState<{ tone: "success" | "error"; message: string } | null>(null);
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [cadenceHours, setCadenceHours] = useState(24);
  const [alertThreshold, setAlertThreshold] = useState(82);
  const [browserAlerts, setBrowserAlerts] = useState(true);
  const fileInput = useRef<HTMLInputElement>(null);

  const displayJobs = liveJobs;
  const qualifiedJobs = useMemo(() => liveJobs.filter((job) => job.score >= threshold && job.status !== "SKIPPED"), [liveJobs, threshold]);
  const needsAttention = packets.filter((packet) => packet.status === "NEEDS_INPUT").length;
  const latestRun = searchRuns[0];
  const latestDiscovery = discoveryRuns[0];
  const unreadAlerts = alerts.filter((alert) => alert.status === "UNREAD");
  const availableDiscoverySources = discoverySources.filter((source) =>
    source.lane === "PUBLIC_API" && source.status !== "NEEDS_KEY" && source.status !== "UNAVAILABLE",
  );
  const latestAlertImport = alertImports[0];
  const approvedQueueCount = packets.filter((packet) => packet.status === "APPROVED_FOR_FILL").length;
  const profileInitials = (profile.name || accountName).split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "RS";
  const studioJobs = liveJobs.filter((job) => job.score >= 75 && job.status !== "SKIPPED");
  const primaryKeyword = discoveryForm.keywords.split(",")[0]?.trim() || "Backend Engineer";
  const primaryLocation = discoveryForm.locations.split(",")[0]?.trim() || "India";
  const portalSearches = [
    { name: "LinkedIn", mark: "in", note: "Signed-in search", url: `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(primaryKeyword)}&location=${encodeURIComponent(primaryLocation)}` },
    { name: "Naukri", mark: "N", note: "India job search", url: `https://www.naukri.com/jobs-in-india?k=${encodeURIComponent(primaryKeyword)}&l=${encodeURIComponent(primaryLocation)}` },
    { name: "Indeed", mark: "i", note: "India listings", url: `https://in.indeed.com/jobs?q=${encodeURIComponent(primaryKeyword)}&l=${encodeURIComponent(primaryLocation)}` },
    { name: "Google Jobs", mark: "G", note: "Wider web search", url: `https://www.google.com/search?q=${encodeURIComponent(`${primaryKeyword} jobs ${primaryLocation}`)}` },
    { name: "Wellfound", mark: "W", note: "Startup roles", url: `https://wellfound.com/jobs` },
    { name: "Cutshort", mark: "C", note: "India tech roles", url: `https://cutshort.io/jobs` },
    { name: "Instahyre", mark: "I", note: "Curated tech hiring", url: `https://www.instahyre.com/search-jobs/` },
    { name: "Hirist", mark: "H", note: "Engineering roles", url: `https://www.hirist.tech/` },
    { name: "Foundit", mark: "F", note: "India listings", url: `https://www.foundit.in/search/${encodeURIComponent(primaryKeyword)}-jobs` },
    { name: "Weekday", mark: "W", note: "India startup roles", url: `https://www.weekday.works/jobs?query=${encodeURIComponent(primaryKeyword)}` },
    { name: "YC Startups", mark: "Y", note: "Work at a Startup", url: `https://www.ycombinator.com/jobs?role=eng` },
  ];

  useEffect(() => {
    void loadWorkspace();
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3400);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!browserAlerts || typeof Notification === "undefined" || Notification.permission !== "granted" || !unreadAlerts.length) return;
    const latest = unreadAlerts[0];
    const key = `rolesignal-alert-${latest.id}`;
    if (window.localStorage.getItem(key)) return;
    new Notification(latest.title, { body: latest.summary, tag: latest.id });
    window.localStorage.setItem(key, "shown");
  }, [browserAlerts, unreadAlerts]);

  async function loadWorkspace() {
    try {
      const data = await api<Workspace>("/api/rolesignal/workspace");
      setProfile(data.profile || fallbackProfile);
      setProfileStatus(data.profileStatus || "EMPTY");
      setActiveProfileVersionId(data.activeProfileVersionId || "");
      setPendingProfile(data.pendingProfileVersion || null);
      setAccountName(data.profile?.name || data.user?.name || "RoleSignal user");
      setLiveJobs(data.jobs || []);
      setPackets(data.packets || []);
      setSources(data.sources || []);
      setSearchRuns(data.searchRuns || []);
      setDiscoveryRuns(data.discoveryRuns || []);
      setDiscoverySources(data.discoverySources || []);
      setAutomation(data.automation || null);
      setAlerts(data.alerts || []);
      setAlertImports(data.alertImports || []);
      setStudioDocuments(data.studioDocuments || []);
      setExecutionSettings(data.executionSettings || defaultExecutionSettings);
      setCompanionDevices(data.companionDevices || []);
      setExecutions(data.executions || []);
      setSelectedStudioId((current) => current || data.studioDocuments?.[0]?.id || "");
      if (data.automation) {
        setScheduleEnabled(data.automation.enabled);
        setCadenceHours(data.automation.cadenceHours);
        setAlertThreshold(data.automation.minScore);
        setBrowserAlerts(data.automation.browserAlerts);
      }
      if (data.discoverySearches?.[0]) {
        const search = data.discoverySearches[0];
        setDiscoveryForm({
          name: search.name,
          keywords: search.keywords.join(", "),
          locations: search.locations.join(", "),
          workModes: search.workModes,
          minScore: search.minScore,
          scope: scopeFromLocations(search.locations),
        });
      }
      setAnswerVault(data.answerVault || []);
      setAnswerValues((current) => ({
        ...current,
        ...Object.fromEntries((data.answerVault || []).map((row) => [row.field_key, row.value])),
      }));
      setResumeName(data.resumes?.[0]?.filename || "No resume uploaded");
      if (data.preferences) {
        setThreshold(Number(data.preferences.match_threshold ?? 75));
        setDailyLimit(Number(data.preferences.daily_limit ?? 5));
        setAutoApply(Boolean(data.preferences.auto_apply));
      }
    } catch {
      setToast("The workspace could not sync. Retry before continuing.");
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
      const result = await api<{ profileVersion: ProfileVersion }>("/api/rolesignal/resumes", { method: "POST", body: data });
      setResumeName(file.name);
      setPendingProfile(result.profileVersion);
      setProfileStatus("PENDING_REVIEW");
      setResumeText(text);
      setUploadState("saved");
      setToast("Resume analyzed. Review the extracted profile before it can affect matching or applications.");
      await loadWorkspace();
      setView("profile");
    } catch (error) {
      setUploadState("error");
      setToast(error instanceof Error ? error.message : "Resume analysis failed.");
    }
  }

  async function analyzePastedResume() {
    setBusy("resume-text");
    try {
      const result = await api<{ profileVersion: ProfileVersion }>("/api/rolesignal/profile/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resumeText }),
      });
      setPendingProfile(result.profileVersion);
      setProfileStatus("PENDING_REVIEW");
      setToast("Resume text analyzed. Review and confirm it before matching begins.");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Resume text could not be analyzed.");
    } finally {
      setBusy("");
    }
  }

  async function confirmPendingProfile() {
    if (!pendingProfile) return;
    setBusy("profile-confirm");
    try {
      const result = await api<{ profile: Profile; activeProfileVersionId: string }>("/api/rolesignal/profile/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ profileVersionId: pendingProfile.id, profile: pendingProfile.profile }),
      });
      setProfile(result.profile);
      setActiveProfileVersionId(result.activeProfileVersionId);
      setPendingProfile(null);
      setProfileStatus("VERIFIED");
      setToast("Profile confirmed. New discovery and applications will use only this evidence version.");
      await loadWorkspace();
    } catch (error) {
      setToast(error instanceof Error ? error.message : "The profile could not be confirmed.");
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

  async function saveExecutionSettings(settings: ExecutionSettings) {
    setBusy("execution-settings");
    try {
      const result = await api<{ settings: ExecutionSettings }>("/api/rolesignal/execution/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(settings),
      });
      setExecutionSettings(result.settings);
      setToast(settings.enabled ? "The guarded apply runner is active." : "The guarded apply runner is paused.");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Execution settings could not be saved.");
    } finally {
      setBusy("");
    }
  }

  async function queueQualifiedForExecution() {
    setBusy("execution-queue");
    try {
      const result = await api<{ queued: Array<{ execution?: ApplicationExecution }>; dailyLimitReached: boolean }>("/api/rolesignal/execution/queue-qualified", { method: "POST" });
      await loadWorkspace();
      setToast(result.dailyLimitReached ? "Today’s application cap has already been reached." : `${result.queued.length} qualified application${result.queued.length === 1 ? " was" : "s were"} evaluated for execution.`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Qualified jobs could not be queued.");
    } finally {
      setBusy("");
    }
  }

  async function queueJobForExecution(jobId: string) {
    setBusy(`execution-queue-${jobId}`);
    try {
      await api("/api/rolesignal/execution/queue", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jobId }),
      });
      await loadWorkspace();
      setToast("Application added to the guarded execution ledger.");
      setView("execution");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "The application could not be queued.");
    } finally {
      setBusy("");
    }
  }

  async function pairCompanion(name: string) {
    setBusy("execution-pair");
    try {
      const result = await api<{ connectionKey: string; device: CompanionDevice }>("/api/rolesignal/execution/pair", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      setConnectionKey(result.connectionKey);
      setCompanionDevices((current) => [result.device, ...current]);
      setToast("Chrome connection key created. Copy it into Companion → Autopilot.");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "The browser companion could not be paired.");
    } finally {
      setBusy("");
    }
  }

  async function revokeCompanion(deviceId: string) {
    setBusy(`execution-revoke-${deviceId}`);
    try {
      await api("/api/rolesignal/execution/revoke-device", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deviceId }),
      });
      await loadWorkspace();
      setToast("Browser companion access revoked.");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "The device could not be revoked.");
    } finally {
      setBusy("");
    }
  }

  async function retryExecution(executionId: string) {
    setBusy(`execution-retry-${executionId}`);
    try {
      await api("/api/rolesignal/execution/retry", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ executionId }),
      });
      await loadWorkspace();
      setToast("Application rechecked and returned to the appropriate queue.");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "The application could not be retried.");
    } finally {
      setBusy("");
    }
  }

  async function copyConnectionKey() {
    try {
      await navigator.clipboard.writeText(connectionKey);
      setToast("Connection key copied. Paste it into Companion → Autopilot.");
    } catch {
      setToast("Clipboard access was blocked. Select and copy the key manually.");
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
      let provider = sourceForm.provider;
      let token = sourceForm.token.trim();
      if (/^https?:\/\//i.test(token)) {
        const boardUrl = new URL(token);
        const host = boardUrl.hostname.toLowerCase();
        const pathToken = boardUrl.pathname.split("/").filter(Boolean)[0] || "";
        if (host.includes("greenhouse")) provider = "greenhouse";
        else if (host === "jobs.lever.co") provider = "lever";
        else if (host === "jobs.ashbyhq.com") provider = "ashby";
        else throw new Error("Use a Greenhouse, Lever or Ashby careers URL.");
        token = pathToken;
      }
      if (!token) throw new Error("Enter a company careers URL or board token.");
      const result = await api<{ report: ScanReport }>("/api/rolesignal/sources/scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...sourceForm, provider, token }),
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
          portals: ["Public APIs", "Official company boards", "Portal alert inbox"],
        }),
      });
      await loadWorkspace();
      setView("discovery");
      const failedSources = result.run.report.failures?.length ?? 0;
      setToast(
        result.run.cached
          ? "Showing the latest successful result for this search. Automatic feeds refresh every six hours."
          : result.run.status === "FAILED"
            ? `Discovery could not reach ${failedSources || "any"} automatic sources. See Source health for the exact errors.`
            : `Discovery complete: ${result.run.qualified} qualified matches from ${result.run.discovered} listings.`,
      );
    } catch (error) {
      setToast(error instanceof Error ? error.message : "The discovery run could not finish.");
    } finally {
      setBusy("");
    }
  }

  async function importJobAlert(event: FormEvent) {
    event.preventDefault();
    setBusy("alert-import");
    setAlertFeedback(null);
    try {
      const result = await api<{ duplicate: boolean; run: DiscoveryRun | null; alertImport: AlertImport }>("/api/rolesignal/discovery/alerts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(alertForm),
      });
      await loadWorkspace();
      if (result.duplicate) {
        const message = "Already imported: no duplicate jobs were created.";
        setAlertFeedback({ tone: "success", message });
        setToast(message);
      } else {
        setAlertForm((current) => ({ ...current, subject: "", content: "" }));
        const message = `Parsed ${result.alertImport.jobsFound} links: ${result.alertImport.imported} new, ${result.alertImport.duplicates} duplicates, ${result.run?.qualified || 0} qualified.`;
        setAlertFeedback({ tone: "success", message });
        setToast(message);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "The job alert could not be imported.";
      setAlertFeedback({ tone: "error", message });
      setToast(message);
    } finally {
      setBusy("");
    }
  }

  async function pasteJobAlert() {
    try {
      setAlertForm((current) => ({ ...current, content: "" }));
      const content = await navigator.clipboard.readText();
      setAlertForm((current) => ({ ...current, content }));
      setToast("Job alert pasted and ready to process.");
    } catch {
      setToast("Clipboard access was blocked. Paste the alert email manually.");
    }
  }

  async function saveSchedule(event?: FormEvent) {
    event?.preventDefault();
    setBusy("automation-save");
    try {
      const result = await api<{ automation: AutomationSettings }>("/api/rolesignal/automation/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: scheduleEnabled, cadenceHours, minScore: alertThreshold, browserAlerts }),
      });
      setAutomation(result.automation);
      setToast(scheduleEnabled ? `Scheduled discovery is active every ${cadenceHours} hours.` : "Scheduled discovery paused. Manual runs remain available.");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Automation settings could not be saved.");
    } finally {
      setBusy("");
    }
  }

  async function runScheduledNow() {
    setBusy("automation-run");
    try {
      const result = await api<{ run: DiscoveryRun; automation: AutomationSettings }>("/api/rolesignal/automation/run-now", { method: "POST" });
      setAutomation(result.automation);
      await loadWorkspace();
      setToast(`Automation checked ${result.run.discovered} listings and surfaced ${result.run.qualified} qualified matches.`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "The scheduled workflow could not run.");
    } finally {
      setBusy("");
    }
  }

  async function enableBrowserNotifications() {
    if (typeof Notification === "undefined") {
      setToast("This browser does not support desktop notifications.");
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission === "granted") {
      setBrowserAlerts(true);
      setToast("Browser alerts enabled for new high-quality matches.");
    } else {
      setToast("Notification permission was not granted. Matches will still appear in the Signal inbox.");
    }
  }

  async function markAlertsRead(alertId?: string) {
    try {
      const result = await api<{ alerts: JobAlert[] }>("/api/rolesignal/alerts/read", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ alertId }),
      });
      setAlerts(result.alerts);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "The Signal inbox could not be updated.");
    }
  }

  async function deepAnalyze(job: MatchJob) {
    setBusy(`enrich-${job.id}`);
    try {
      await api("/api/rolesignal/jobs/enrich", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jobId: job.id }),
      });
      await loadWorkspace();
      setToast("Full job description retrieved and rescored against the evidence graph.");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "The official page could not be deeply analyzed.");
    } finally {
      setBusy("");
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

  async function generateStudio(jobId: string) {
    setBusy("studio-generate");
    try {
      const result = await api<{ document: StudioDocument }>("/api/rolesignal/studio/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jobId }),
      });
      await loadWorkspace();
      setSelectedStudioId(result.document.id);
      setView("studio");
      setToast(`Tailored resume v${result.document.version} created with ${result.document.groundingScore}% evidence coverage.`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "The tailored draft could not be generated.");
    } finally {
      setBusy("");
    }
  }

  async function saveStudio(id: string, content: StudioContent) {
    setBusy(`studio-save-${id}`);
    try {
      const result = await api<{ document: StudioDocument }>("/api/rolesignal/studio/documents", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, content }),
      });
      setStudioDocuments((current) => current.map((document) => document.id === id ? result.document : document));
      setToast(result.document.groundingScore === 100 ? "Draft saved. Every claim remains grounded." : `Draft saved. ${result.document.evidence.filter((item) => item.status !== "VERIFIED").length} edited claims need evidence review.`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "The tailored draft could not be saved.");
    } finally {
      setBusy("");
    }
  }

  async function approveStudio(id: string) {
    setBusy(`studio-approve-${id}`);
    try {
      const result = await api<{ document: StudioDocument }>("/api/rolesignal/studio/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      await loadWorkspace();
      setSelectedStudioId(result.document.id);
      setToast("Approved DOCX and PDF resumes are ready to download.");
    } catch (error) {
      await loadWorkspace();
      setToast(error instanceof Error ? error.message : "This version cannot be approved yet.");
    } finally {
      setBusy("");
    }
  }

  async function copyStudioText(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setToast(`${label} copied.`);
    } catch {
      setToast("Clipboard access was blocked. Select the text and copy it manually.");
    }
  }

  async function openStudioForPacket(packet: ApplicationPacket) {
    const existing = studioDocuments.find((document) => document.jobId === packet.jobId);
    if (existing) {
      setSelectedStudioId(existing.id);
      setView("studio");
      return;
    }
    await generateStudio(packet.jobId);
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
          <b>v8</b>
        </div>
        <nav aria-label="Primary navigation">
          <p className="nav-label">Workspace</p>
          {navItems.map((item) => (
            <button key={item.id} className={view === item.id ? "nav-item active" : "nav-item"} onClick={() => setView(item.id)}>
              <span>{item.mark}</span>{item.label}
              {item.id === "discovery" && discoveryRuns.length > 0 && <b>{discoveryRuns.length}</b>}
              {item.id === "matches" && <b>{liveJobs.length}</b>}
              {item.id === "runs" && searchRuns.length > 0 && <b>{searchRuns.length}</b>}
              {item.id === "autopilot" && unreadAlerts.length > 0 && <b>{unreadAlerts.length}</b>}
              {item.id === "applications" && packets.length > 0 && <b>{packets.length}</b>}
              {item.id === "studio" && studioDocuments.length > 0 && <b>{studioDocuments.length}</b>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="autopilot-mini">
            <span className="pulse-dot" />
            <div><strong>{executionSettings.enabled ? "Apply runner is on" : autoApply ? "Auto-stage is on" : "Review mode is on"}</strong><small>Browser fill always pauses before submit</small></div>
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
            <span className="secure-pill"><i />{profileStatus === "VERIFIED" ? "Evidence verified" : "Profile setup"}</span>
            <button className="signal-inbox-button" onClick={() => setView("autopilot")}><span>{unreadAlerts.length}</span> Signals</button>
            <button className="avatar-button" aria-label="Career profile" onClick={() => setView("profile")}>{profileInitials}</button>
          </div>
        </header>

        {view === "dashboard" && (
          <div className="page dashboard-page">
            <section className="hero-row">
              <div>
                <span className="eyebrow">Unified India-focused job search</span>
                <h1>Find work worth applying for.</h1>
                <p>{liveJobs.length ? `${liveJobs.length} roles from job APIs, official company boards and portal alerts have been scored against verified engineering evidence.` : "Search India-focused feeds, company career boards and portal alerts from one place."}</p>
              </div>
              <button className="primary-button" disabled={busy === "discovery-run" || profileStatus !== "VERIFIED"} onClick={() => void runDiscovery()}><span>&#8599;</span>{profileStatus !== "VERIFIED" ? "Confirm profile first" : busy === "discovery-run" ? "Searching feeds..." : "Discover matching jobs"}</button>
            </section>

            {latestDiscovery && <section className="latest-run-strip discovery-strip"><div><span className={`run-status ${latestDiscovery.status.toLowerCase()}`}>{readableStatus(latestDiscovery.status)}</span><span><strong>Latest cross-portal discovery</strong><small>{latestDiscovery.discovered} listings checked / {latestDiscovery.imported} new / {latestDiscovery.qualified} qualified / {postedLabel(latestDiscovery.completedAt || latestDiscovery.startedAt)}</small></span></div><button className="text-button" onClick={() => setView("discovery")}>Open discovery -&gt;</button></section>}
            {latestRun && <section className="latest-run-strip"><div><span className={`run-status ${latestRun.status.toLowerCase()}`}>{readableStatus(latestRun.status)}</span><span><strong>Latest search run</strong><small>{latestRun.uniqueJobs} unique jobs / {latestRun.ready} ready to review / {postedLabel(latestRun.completedAt || latestRun.startedAt)}</small></span></div><button className="text-button" onClick={() => setView("runs")}>Open run center -&gt;</button></section>}
            {unreadAlerts.length > 0 && <section className="signal-banner"><div><span className="signal-count">{unreadAlerts.length}</span><span><strong>New matches in your Signal inbox</strong><small>{unreadAlerts[0].title} / {unreadAlerts[0].detail.score || "Qualified"} match score</small></span></div><button className="text-button" onClick={() => setView("autopilot")}>Review signals -&gt;</button></section>}
            {studioDocuments.length > 0 && <section className="studio-banner"><div><span className="studio-banner-mark">Aa</span><span><strong>{studioDocuments.length} tailored resume version{studioDocuments.length === 1 ? "" : "s"}</strong><small>{studioDocuments.filter((document) => document.status === "APPROVED").length} approved export{studioDocuments.filter((document) => document.status === "APPROVED").length === 1 ? "" : "s"} ready</small></span></div><button className="text-button" onClick={() => setView("studio")}>Open studio -&gt;</button></section>}

            <section className="metric-grid" aria-label="Job search metrics">
              <Metric label="Live roles" value={String(liveJobs.length)} note={latestDiscovery ? `${latestDiscovery.providers.length} discovery providers` : "Ready for discovery"} trend={liveJobs.length ? "up" : "neutral"} />
              <Metric label="Strong matches" value={String(liveJobs.filter((job) => job.score >= 82).length)} note="82+ match score" trend="up" />
              <Metric label="Ready to review" value={String(qualifiedJobs.length)} note={`Threshold ${threshold}+`} trend="neutral" />
              <Metric label="Needs attention" value={String(needsAttention)} note="Unknown required answers" trend={needsAttention ? "warn" : "up"} />
            </section>

            {profileStatus !== "VERIFIED" && workspaceLoaded && (
              <section className="setup-banner">
                <div><span className="card-kicker">Required before matching</span><h3>{pendingProfile ? "Review the resume we extracted." : "Start with your resume."}</h3><p>RoleSignal will not score, tailor, fill or queue anything until you confirm the identity and evidence it extracted.</p></div>
                <button className="secondary-button" onClick={() => setView("profile")}>{pendingProfile ? "Review profile" : "Upload resume"}</button>
              </section>
            )}

            <section className="content-grid">
              <div className="opportunities-column">
                <div className="section-heading">
                  <div><span className="eyebrow">Ranked for you</span><h2>{liveJobs.length ? "Highest-signal opportunities" : "No live matches yet"}</h2></div>
                  <button className="text-button" onClick={() => setView("matches")}>View all matches -&gt;</button>
                </div>
                <div className="job-stack">{displayJobs.length ? displayJobs.slice(0, 3).map((job) => <JobCard key={job.id} job={job} onReview={() => void prepareApplication(job)} busy={busy === `prepare-${job.id}`} />) : <EmptyState title="Your real matches will appear here" copy={profileStatus === "VERIFIED" ? "Run discovery to fetch, deduplicate and score current jobs." : "Confirm your resume profile to unlock discovery."} action={profileStatus === "VERIFIED" ? "Open discovery" : "Review profile"} onAction={() => setView(profileStatus === "VERIFIED" ? "discovery" : "profile")} />}</div>
              </div>
              <aside className="insights-column">
                <ResumePanel resumeName={resumeName} state={uploadState} onChoose={() => fileInput.current?.click()} />
                {profileStatus === "VERIFIED" && <div className="insight-card differentiation-card">
                  <span className="card-kicker">Your differentiator</span>
                  <h3>{profile.domains.slice(0, 2).join(" + ") || profile.title}</h3>
                  <p>{profile.evidence[0] || "Only evidence confirmed from your active resume is used in match explanations."}</p>
                  <div className="signal-bars"><span style={{ width: "92%" }} /><span style={{ width: "76%" }} /><span style={{ width: "87%" }} /></div>
                </div>}
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
            <PageTitle eyebrow="Unified discovery" title="One search. India and worldwide remote." copy="RoleSignal searches open job data, official company boards and your portal alerts, then separates resume fit from whether an applicant in India can actually apply." action={profileStatus !== "VERIFIED" ? "Confirm profile first" : busy === "discovery-run" ? "Searching every source..." : "Find my best matches"} actionDisabled={busy === "discovery-run" || profileStatus !== "VERIFIED"} onAction={() => void runDiscovery()} />

            <section className="discovery-hero-grid">
              <form className="discovery-config-card" onSubmit={runDiscovery}>
                <div className="card-heading"><div><span className="card-kicker">Your search profile</span><h2>Tell us what good looks like</h2></div><span className="verified-tag">Resume-linked</span></div>
                <label>Search name<input value={discoveryForm.name} onChange={(event) => setDiscoveryForm({ ...discoveryForm, name: event.target.value })} /></label>
                <div className="search-scope"><span>Where should RoleSignal search?</span><div>{([[
                  "BOTH", "India + global remote"
                ], ["INDIA", "India only"], ["GLOBAL_REMOTE", "Global remote"]] as Array<[DiscoveryScope, string]>).map(([scope, label]) => <button type="button" key={scope} className={discoveryForm.scope === scope ? "active" : ""} onClick={() => setDiscoveryForm({ ...discoveryForm, scope, ...scopeSettings(scope) })}>{label}</button>)}</div><small>Worldwide roles are checked for India, APAC, global, or international-contractor eligibility.</small></div>
                <label>Roles and technologies<input value={discoveryForm.keywords} onChange={(event) => setDiscoveryForm({ ...discoveryForm, keywords: event.target.value })} placeholder="Backend Engineer, Platform Engineer, Node.js" /><small>RoleSignal searches all connected sources with these terms.</small></label>
                <label>Locations<input value={discoveryForm.locations} onChange={(event) => setDiscoveryForm({ ...discoveryForm, locations: event.target.value })} placeholder="India, Bengaluru, Remote" /></label>
                <div className="discovery-controls"><label>Minimum match<input type="number" min={50} max={95} value={discoveryForm.minScore} onChange={(event) => setDiscoveryForm({ ...discoveryForm, minScore: Number(event.target.value) })} /></label><div><span>Work modes</span><div className="mode-pills">{["Remote", "Hybrid", "On-site"].map((mode) => <button type="button" key={mode} className={discoveryForm.workModes.includes(mode) ? "active" : ""} onClick={() => setDiscoveryForm({ ...discoveryForm, workModes: discoveryForm.workModes.includes(mode) ? discoveryForm.workModes.filter((value) => value !== mode) : [...discoveryForm.workModes, mode] })}>{mode}</button>)}</div></div></div>
                <button className="primary-button wide" disabled={busy === "discovery-run"}>{busy === "discovery-run" ? "Fetching, deduplicating and scoring..." : "Find and rank matching jobs"}</button>
                <p className="refresh-note">One click checks every connected automatic source. Successful results are reused for six hours to respect source limits; failed or empty runs retry immediately.</p>
              </form>

              <aside className="coverage-card phase8-coverage">
                <span className="card-kicker">Discovery status</span><h2>Useful before you add any API keys</h2><p>Freehire and Remotive provide open India and remote coverage. Optional APIs, company boards and portal alerts widen the search without storing portal passwords.</p>
                <div className="coverage-stat"><strong>{availableDiscoverySources.length}</strong><span>automatic<br />sources ready</span></div>
                <div className="coverage-row"><span className="coverage-mark public">01</span><span><strong>India + global remote APIs</strong><small>Freehire and Remotive work without keys; Adzuna and Jooble are optional</small></span><b>Automatic</b></div>
                <div className="coverage-row"><span className="coverage-mark ats">02</span><span><strong>Official career boards</strong><small>{sources.length ? `${sources.length} employer boards connected` : "Ready for your target-employer list"}</small></span><b>Automatic</b></div>
                <div className="coverage-row"><span className="coverage-mark portal">03</span><span><strong>Portal alert inbox</strong><small>LinkedIn, Naukri, Indeed and Foundit alert emails</small></span><b>Safe import</b></div>
              </aside>
            </section>

            <section className="source-health-section">
              <div className="section-heading"><div><span className="eyebrow">Source health</span><h2>Exactly where your jobs come from</h2></div><span className="quiet-label">No hidden crawling</span></div>
              <div className="source-health-grid">{discoverySources.map((source) => <article key={source.id} className="source-health-card"><div><span className={`source-health-dot ${source.status.toLowerCase()}`} /><span className="card-kicker">{readableStatus(source.lane)}</span></div><h3>{source.name}</h3><p>{source.coverage}</p><footer><span>{source.note}{source.lastAttemptAt ? <small>Last checked {postedLabel(source.lastAttemptAt)}{source.latencyMs ? ` / ${source.latencyMs}ms` : ""}</small> : null}</span><b className={source.status.toLowerCase()}>{readableStatus(source.status)}</b></footer></article>)}</div>
            </section>

            <section className="alert-ingestion-section">
              <div className="alert-inbox-explainer"><span className="card-kicker">Portal alert inbox</span><h2>Let the portals send jobs to you</h2><p>Create daily alerts once on LinkedIn, Naukri, Indeed, Foundit or Weekday. RoleSignal extracts their job links, merges duplicates and scores them with the same resume model.</p><ol><li><b>1</b><span>Create a daily alert on the portal.</span></li><li><b>2</b><span>Copy the complete alert email for now; automatic forwarding uses the same endpoint when connected.</span></li><li><b>3</b><span>Paste it here and RoleSignal does the rest.</span></li></ol>{latestAlertImport && <div className="latest-alert-import"><span>Last import</span><strong>{latestAlertImport.provider} / {latestAlertImport.jobsFound} found / {latestAlertImport.imported} new</strong><small>{postedLabel(latestAlertImport.createdAt)}</small></div>}</div>
              <form className="alert-import-card" onSubmit={importJobAlert}><div className="card-heading"><span className="card-kicker">Import a job alert</span><button type="button" onClick={() => void pasteJobAlert()}>Paste email</button></div><div className="alert-form-row"><label>Portal<select value={alertForm.provider} onChange={(event) => setAlertForm({ ...alertForm, provider: event.target.value })}>{["LinkedIn", "Naukri", "Indeed", "Foundit", "Weekday", "Instahyre", "Cutshort", "Other"].map((provider) => <option key={provider}>{provider}</option>)}</select></label><label>Email subject<input value={alertForm.subject} onChange={(event) => setAlertForm({ ...alertForm, subject: event.target.value })} placeholder="Daily jobs for Backend Engineer" /></label></div><label>Complete alert email<textarea required rows={10} value={alertForm.content} onChange={(event) => setAlertForm({ ...alertForm, content: event.target.value })} placeholder="Paste the complete text or HTML of the job-alert email here..." /></label><button className="primary-button wide" disabled={busy === "alert-import" || profileStatus !== "VERIFIED"}>{profileStatus !== "VERIFIED" ? "Confirm profile before importing" : busy === "alert-import" ? "Extracting and scoring jobs..." : "Import, deduplicate and score"}</button>{alertFeedback && <div role="status" className={`operation-feedback ${alertFeedback.tone}`}>{alertFeedback.message}</div>}<p>Your portal password and session never enter RoleSignal.</p></form>
            </section>

            <section className="portal-search-section">
              <div className="section-heading"><div><span className="eyebrow">Set up alerts at the source</span><h2>Open a portal with your current search</h2></div><span className="quiet-label">One-time setup</span></div>
              <div className="portal-grid">{portalSearches.map((portal) => <a key={portal.name} href={portal.url} target="_blank" rel="noreferrer"><span className="portal-mark">{portal.mark}</span><span><strong>{portal.name}</strong><small>{portal.note}</small></span><b>-&gt;</b></a>)}<div className="portal-info"><span className="portal-mark">W</span><span><strong>Workday</strong><small>Covered through company career pages</small></span><b>Official</b></div></div>
            </section>

            {latestDiscovery && <section className="discovery-results">
              <div className="discovery-results-head"><div><span className="card-kicker">Latest discovery / {readableStatus(latestDiscovery.mode)}</span><h2>{latestDiscovery.qualified} qualified matches surfaced</h2><p>{latestDiscovery.discovered} listings inspected, {latestDiscovery.imported} new jobs imported and {latestDiscovery.duplicates} duplicates merged.</p></div><div><span className={`run-status ${latestDiscovery.status.toLowerCase()}`}>{readableStatus(latestDiscovery.status)}</span><a className="secondary-button" href={`/api/rolesignal/export/discovery-run.md?id=${encodeURIComponent(latestDiscovery.id)}`} download>Download report</a></div></div>
              <div className="provider-strip">{latestDiscovery.providers.map((provider) => <span key={provider.provider}><strong>{provider.provider}</strong><small>{provider.discovered} checked / {provider.relevant ?? provider.imported} relevant / {provider.imported} new</small>{provider.eligible !== undefined && <small className="provider-eligibility">{provider.eligible} India-ready / {provider.verify || 0} verify / {provider.ineligible || 0} restricted</small>}</span>)}</div>
              {latestDiscovery.report.screening && <div className="screening-grid"><span><strong>{latestDiscovery.report.screening.fetched}</strong><small>Fetched</small></span><span><strong>{latestDiscovery.report.screening.roleOrLocationFiltered}</strong><small>Role/location fit</small></span><span className="eligible"><strong>{latestDiscovery.report.screening.indiaEligible}</strong><small>India-ready</small></span><span className="verify"><strong>{latestDiscovery.report.screening.eligibilityNeedsVerification}</strong><small>Verify eligibility</small></span><span className="restricted"><strong>{latestDiscovery.report.screening.locationRestricted}</strong><small>Restricted</small></span></div>}
              {latestDiscovery.report.failures?.length ? <div className="discovery-failures"><strong>Some sources need attention</strong>{latestDiscovery.report.failures.map((failure) => <span key={`${failure.provider}-${failure.message}`}><b>{failure.provider}</b>{failure.message}</span>)}</div> : null}
              {(latestDiscovery.report.highestPriority || []).length ? <><div className="section-heading discovery-priority-heading"><div><span className="eyebrow">Highest priority</span><h2>Best applications from this run</h2></div><button className="text-button" onClick={() => setView("matches")}>Review full match list -&gt;</button></div><div className="priority-grid">{(latestDiscovery.report.highestPriority || []).map((job, index) => <article className="priority-card" key={job.id}><span className="priority-number">0{index + 1}</span><span className="card-kicker">{job.company} / {job.platform}</span><h3>{job.role}</h3><p>{job.location} / {job.workMode}</p>{job.eligibility && <span className={`eligibility-badge ${job.eligibility.decision.toLowerCase()}`}>{job.eligibility.label}</span>}<div className="priority-score"><strong>{job.score}</strong><span>match<br />score</span></div><button className="text-button" disabled={job.status === "SKIPPED"} onClick={() => void prepareApplication(job)}>{job.status === "SKIPPED" ? "Location restricted" : "Prepare application ->"}</button></article>)}</div></> : <div className="discovery-no-match"><strong>No qualified roles in this run.</strong><span>{latestDiscovery.report.screening?.locationRestricted ? `${latestDiscovery.report.screening.locationRestricted} otherwise relevant role${latestDiscovery.report.screening.locationRestricted === 1 ? " was" : "s were"} location-restricted. ` : ""}Try broader role terms, lower the match threshold, or capture another portal results page.</span></div>}
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
              <span className="filter">Borderline {displayJobs.filter((job) => job.score >= 65 && job.score < 75).length}</span>
              <span className="filter">Stretch {displayJobs.filter((job) => job.score >= 50 && job.score < 65).length}</span>
            </div>
            <div className="matches-layout">
              <div className="job-stack expanded">
                {displayJobs.map((job) => <JobCard key={job.id} job={job} expanded onReview={() => void prepareApplication(job)} onAnalyze={() => void deepAnalyze(job)} busy={busy === `prepare-${job.id}`} analyzing={busy === `enrich-${job.id}`} />)}
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
            <PageTitle eyebrow="Live ingestion" title="Bring official jobs into one signal" copy="Scan public Greenhouse, Lever and Ashby boards, or import a single official job page and full description." action={sources.length ? (busy === "scan-all" ? "Running all sources..." : "Run all connected") : undefined} actionDisabled={busy === "scan-all"} onAction={() => void runAllSources()} />
            <div className="source-grid">
              <form className="source-card" onSubmit={scanSource}>
                <span className="card-kicker">ATS board scan</span><h3>Connect a company board</h3><p>Paste a public Greenhouse, Lever or Ashby careers URL. RoleSignal detects the provider and company token automatically.</p>
                <label>Provider<select value={sourceForm.provider} onChange={(event) => setSourceForm({ ...sourceForm, provider: event.target.value })}><option value="greenhouse">Greenhouse</option><option value="lever">Lever</option><option value="ashby">Ashby</option></select></label>
                <label>Careers URL or token<input required value={sourceForm.token} onChange={(event) => setSourceForm({ ...sourceForm, token: event.target.value })} placeholder="https://jobs.lever.co/example-company" /></label>
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

            {sources.length > 0 && <section className="connected-sources"><div className="section-heading"><div><span className="eyebrow">Persistent sources</span><h2>Connected career boards</h2></div></div>{sources.map((source) => <div className="source-row" key={source.id}><span className="source-logo">{source.provider === "greenhouse" ? "GH" : source.provider === "lever" ? "LV" : "AS"}</span><span><strong>{source.label}</strong><small>{readableStatus(source.provider)} / {source.source_token}</small></span><b>{source.last_scanned_at ? `Scanned ${postedLabel(source.last_scanned_at)}` : "Ready"}</b><button className="text-button" disabled={busy === `source-remove-${source.id}`} onClick={() => void disconnectSource(source.id)}>Disconnect</button></div>)}</section>}
          </div>
        )}

        {view === "runs" && (
          <div className="page inner-page">
            <PageTitle eyebrow="Search operations" title="One run. Every connected source." copy="Scan all active boards, deduplicate listings, score the full set and keep a durable report of what deserves attention." action={sources.length ? (busy === "scan-all" ? "Running search..." : "Run all sources") : "Connect a source"} actionDisabled={busy === "scan-all"} onAction={() => sources.length ? void runAllSources() : setView("sources")} />
            {!latestRun ? <EmptyState title="No full search run yet" copy="Connect a public Greenhouse, Lever or Ashby board, then run the complete search workflow from here." action={sources.length ? "Run all sources" : "Connect a source"} onAction={() => sources.length ? void runAllSources() : setView("sources")} /> : <>
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
            <PageTitle eyebrow="Search automation" title="Your job search keeps watch" copy="A scheduled search checks whether your saved search is due, scores new roles against the active evidence version and places only qualified matches in the Signal inbox." action={busy === "automation-run" ? "Running now..." : "Run automation now"} actionDisabled={busy === "automation-run" || profileStatus !== "VERIFIED"} onAction={() => void runScheduledNow()} />
            <form className="automation-command-card" onSubmit={saveSchedule}>
              <div className="automation-state"><span className={scheduleEnabled ? "automation-orb on" : "automation-orb"} /><span><strong>{scheduleEnabled ? "Scheduled discovery is active" : "Scheduled discovery is paused"}</strong><small>{automation?.lastRunAt ? `Last run ${postedLabel(automation.lastRunAt)} / next ${postedLabel(automation.nextRunAt)}` : "Save a cadence to begin background discovery."}</small></span></div>
              <label>Cadence<select value={cadenceHours} onChange={(event) => setCadenceHours(Number(event.target.value))}><option value={6}>Every 6 hours</option><option value={12}>Every 12 hours</option><option value={24}>Daily</option><option value={72}>Every 3 days</option></select></label>
              <label>Alert threshold<input type="number" min={65} max={95} value={alertThreshold} onChange={(event) => setAlertThreshold(Number(event.target.value))} /></label>
              <button type="button" className={scheduleEnabled ? "switch large on" : "switch large"} onClick={() => setScheduleEnabled(!scheduleEnabled)} aria-label="Toggle scheduled discovery"><span /></button>
              <button className="primary-button" disabled={busy === "automation-save"}>{busy === "automation-save" ? "Saving..." : "Save schedule"}</button>
            </form>
            {automation?.lastError && <section className="automation-error"><strong>Latest automation issue</strong><span>{automation.lastError}</span></section>}
            <div className="autopilot-grid">
              <section className="rules-card">
                <div className="rules-hero"><div><span className="pulse-dot" /><span><strong>{autoApply ? "Auto-stage is active" : "Review mode is active"}</strong><small>{autoApply ? "Qualified jobs can enter the preparation queue." : "You choose every job before preparation."}</small></span></div><button className={autoApply ? "switch large on" : "switch large"} onClick={() => { const next = !autoApply; setAutoApply(next); void saveRules(next); }}><span /></button></div>
                <RuleSlider label="Minimum match score" value={threshold} min={70} max={95} onChange={setThreshold} suffix="/100" help={`${qualifiedJobs.length} live roles currently qualify`} />
                <RuleSlider label="Daily preparation limit" value={dailyLimit} min={1} max={12} onChange={setDailyLimit} suffix=" roles" help="A quality cap, not an application quota" />
                <Guardrail title="Unknown required answers" copy="Compensation, notice period, authorization and declarations" value="Always pause" />
                <Guardrail title="CAPTCHA or bot protection" copy="No bypasses or security workarounds" value="Manual action" />
                <Guardrail title="Final submission" copy="RoleSignal never clicks the final submit control" value="You click" />
                <button className="primary-button wide" onClick={() => void saveRules()}>Save automation rules</button>
              </section>
              <aside className="guardrail-card">
                <div className="shield-mark">✓</div><span className="card-kicker">Browser companion v0.8</span><h3>Fill the facts. Stop at uncertainty.</h3><p>The paired extension consumes only your current approved queue, fills verified fields and reports every outcome back to RoleSignal.</p>
                <ul><li><i>✓</i> Conservative Greenhouse, Lever and Ashby execution</li><li><i>✓</i> Host-locked application packets</li><li><i>✓</i> Unknown required-field and CAPTCHA pauses</li><li><i>✓</i> Portal-confirmed submission tracking</li></ul>
                <button className="download-button" onClick={() => setView("execution")}>Open Assisted Apply</button>
              </aside>
            </div>
            <section className="signal-inbox">
              <div className="section-heading"><div><span className="eyebrow">Signal inbox</span><h2>New matches, already explained</h2></div><div className="inbox-actions"><button className="secondary-button" onClick={() => void enableBrowserNotifications()}>Enable browser alerts</button>{unreadAlerts.length > 0 && <button className="text-button" onClick={() => void markAlertsRead()}>Mark all read</button>}</div></div>
              {!alerts.length ? <div className="inbox-empty"><strong>No signals yet</strong><span>Run discovery or enable the schedule. Only roles above your alert threshold appear here.</span></div> : <div className="signal-list">{alerts.slice(0, 20).map((alert) => <article className={alert.status === "UNREAD" ? "signal-row unread" : "signal-row"} key={alert.id}><span className="signal-score">{alert.detail.score || "–"}</span><span><strong>{alert.title}</strong><small>{alert.summary}</small></span><span className="signal-time">{postedLabel(alert.createdAt)}</span><button className="text-button" onClick={() => { void markAlertsRead(alert.id); setView("matches"); }}>Review -&gt;</button></article>)}</div>}
            </section>
          </div>
        )}

        {view === "applications" && (
          <div className="page inner-page">
            <PageTitle eyebrow="Applications" title="Prepared, blocked and approved" copy="Every packet is tied to the resume version that created it. Only reviewed, current evidence can enter guarded browser fill." action="Export ledger" onAction={() => { window.location.href = "/api/rolesignal/export/ledger.csv"; }} />
            <div className="application-tools"><button className="secondary-button" onClick={() => setView("studio")}>Tailored documents</button><button className="secondary-button" onClick={() => setView("execution")}>Guarded browser fill</button></div>
            {!packets.length ? <EmptyState title="No application packets yet" copy="Prepare a qualified live match to generate resume guidance and a browser-safe field packet." action="Review matches" onAction={() => setView("matches")} /> : <div className="packet-stack">{packets.map((packet) => <article className="packet-card" key={packet.id}>
              <div className="packet-main"><div><span className="card-kicker">{packet.company}</span><h3>{packet.role}</h3><p><b>{packet.score}/100</b> match / Resume: {packet.resumeStrategy.fit || "DEFAULT"}</p></div><span className={`packet-status ${packet.status.toLowerCase()}`}>{readableStatus(packet.status)}</span></div>
              {packet.kit && <div className="kit-box"><div><span className="card-kicker">Reusable application kit</span><p>{packet.kit.summary}</p></div><div className="kit-answer"><strong>Why this role</strong><p>{packet.kit.whyAnswer}</p></div></div>}
              {packet.resumeStrategy.changes?.length ? <div className="packet-guidance"><strong>Recommended evidence order</strong><ul>{packet.resumeStrategy.changes.map((change) => <li key={change}>{change}</li>)}</ul></div> : null}
              {packet.blockers.length > 0 && <div className="blocker-box"><strong>Needs your input</strong>{packet.blockers.map((blocker) => <span key={blocker.id}>{blocker.question}</span>)}</div>}
              <div className="packet-actions"><button className="studio-button" disabled={busy === "studio-generate"} onClick={() => void openStudioForPacket(packet)}>Tailor resume</button>{packet.kit && <button className="secondary-button" onClick={() => void copyApplicationKit(packet)}>Copy application kit</button>}<button className="secondary-button" onClick={() => void copyBrowserPacket(packet)}>Copy browser packet</button><button className="secondary-button" onClick={() => openApplication(packet)}>Open application</button>{executionSettings.enabled && <button className="execution-queue-button" disabled={packet.status !== "APPROVED_FOR_FILL" || packet.blockers.length > 0 || busy === `execution-queue-${packet.jobId}`} onClick={() => void queueJobForExecution(packet.jobId)}>{packet.status === "APPROVED_FOR_FILL" ? "Queue approved fill" : "Approve before queueing"}</button>}<button className="primary-button" disabled={packet.blockers.length > 0 || packet.status === "APPROVED_FOR_FILL" || busy === `approve-${packet.id}`} onClick={() => void approvePacket(packet)}>{packet.status === "APPROVED_FOR_FILL" ? "Approved for fill" : "Approve for fill"}</button></div>
            </article>)}</div>}
          </div>
        )}

        {view === "studio" && <StudioView documents={studioDocuments} jobs={studioJobs} selectedId={selectedStudioId} busy={busy} onSelect={setSelectedStudioId} onGenerate={generateStudio} onSave={saveStudio} onApprove={approveStudio} onCopy={copyStudioText} />}

        {view === "execution" && <ExecutionView key={executionSettings.updatedAt || "execution-default"} settings={executionSettings} executions={executions} devices={companionDevices} connectionKey={connectionKey} qualifiedCount={approvedQueueCount} busy={busy} onSave={saveExecutionSettings} onQueueAll={queueQualifiedForExecution} onPair={pairCompanion} onRevoke={revokeCompanion} onRetry={retryExecution} onCopyKey={copyConnectionKey} />}

        {view === "profile" && (
          <div className="page inner-page">
            <PageTitle eyebrow="Source of truth" title="Your career profile" copy="A resume becomes active only after you review its identity, skills and evidence. Older applications keep their history but cannot reuse stale claims." action="Upload new resume" onAction={() => fileInput.current?.click()} />
            <div className="profile-grid">
              {pendingProfile && <section className="profile-card wide-card profile-review-card"><div className="card-heading"><div><span className="card-kicker">Resume version {pendingProfile.version}</span><h3>Review before activating</h3></div><span className="pending-tag">Pending review</span></div><p>Correct anything extraction got wrong. Confirming this version will make older scores and drafts stale.</p><div className="profile-review-grid"><label>Name<input value={pendingProfile.profile.name} onChange={(event) => setPendingProfile({ ...pendingProfile, profile: { ...pendingProfile.profile, name: event.target.value } })} /></label><label>Email<input type="email" value={pendingProfile.profile.email} onChange={(event) => setPendingProfile({ ...pendingProfile, profile: { ...pendingProfile.profile, email: event.target.value } })} /></label><label>Current title<input value={pendingProfile.profile.title} onChange={(event) => setPendingProfile({ ...pendingProfile, profile: { ...pendingProfile.profile, title: event.target.value } })} /></label><label>Years of experience<input type="number" min="0" max="50" value={pendingProfile.profile.experienceYears} onChange={(event) => setPendingProfile({ ...pendingProfile, profile: { ...pendingProfile.profile, experienceYears: Number(event.target.value) } })} /></label></div><label>Verified skills<textarea rows={4} value={pendingProfile.profile.skills.join(", ")} onChange={(event) => setPendingProfile({ ...pendingProfile, profile: { ...pendingProfile.profile, skills: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) } })} /></label><label>Evidence statements<textarea rows={7} value={pendingProfile.profile.evidence.join("\n")} onChange={(event) => setPendingProfile({ ...pendingProfile, profile: { ...pendingProfile.profile, evidence: event.target.value.split("\n").map((item) => item.trim()).filter(Boolean) } })} /></label><button className="primary-button wide" disabled={busy === "profile-confirm"} onClick={() => void confirmPendingProfile()}>{busy === "profile-confirm" ? "Activating verified profile..." : "Confirm and activate this profile"}</button></section>}
              {profileStatus === "VERIFIED" ? <section className="profile-card wide-card"><span className="card-kicker">Active verified profile</span><div className="profile-title"><div className="company-avatar">{profileInitials}</div><div><h3>{profile.title}</h3><p>{profile.name} / approximately {profile.experienceYears} years</p></div><span className="verified-tag">✓ Version locked</span></div><p className="profile-summary">{profile.domains.slice(0, 5).join(" / ")}</p><small className="version-reference">Evidence version {activeProfileVersionId.slice(0, 8)}</small></section> : !pendingProfile && <EmptyState title="No verified profile yet" copy="Upload a PDF, DOCX or TXT resume. You will review the extracted evidence before anything is used." action="Upload resume" onAction={() => fileInput.current?.click()} />}
              <ResumePanel resumeName={resumeName} state={uploadState} onChoose={() => fileInput.current?.click()} />
              {profileStatus === "VERIFIED" && <section className="profile-card wide-card"><div className="card-heading"><span className="card-kicker">Extracted evidence</span><span className="quiet-label">Active resume only</span></div><div className="evidence-list">{profile.evidence.slice(0, 10).map((item) => <p key={item}>{item}</p>)}</div></section>}
              {profileStatus === "VERIFIED" && <section className="profile-card wide-card"><span className="card-kicker">Verified skills</span><div className="skill-cloud">{profile.skills.slice(0, 30).map((skill) => <span key={skill}>{skill}<i>✓</i></span>)}</div></section>}
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

function JobCard({ job, onReview, onAnalyze, expanded = false, busy = false, analyzing = false }: { job: MatchJob; onReview: () => void; onAnalyze?: () => void; expanded?: boolean; busy?: boolean; analyzing?: boolean }) {
  const ringStyle = { "--score": `${job.score * 3.6}deg` } as CSSProperties;
  const initials = job.company.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  return <article className={expanded ? "job-card expanded" : "job-card"}>
    <div className="job-main"><div className="company-logo green">{initials}</div><div className="job-info"><div className="job-company"><span>{job.company}</span>{job.highPriority && <i>High priority</i>}{job.eligibility && <i className={`eligibility-badge ${job.eligibility.decision.toLowerCase()}`}>{job.eligibility.label}</i>}</div><h3>{job.role}</h3><p>{job.location}<b>·</b>{job.workMode}<b>·</b>{postedLabel(job.postedDate)}<b>·</b>{job.platform}</p><div className="tag-row">{job.matchingExperience.slice(0, 3).map((tag) => <span key={tag}>{tag}</span>)}</div></div></div>
    <div className="job-actions"><div className="score-ring" style={ringStyle}><span><b>{job.score}</b><small>match</small></span></div></div>
    {expanded && <div className="job-explanation"><div><span className="fit-label">Evidence-semantic matches</span>{job.semanticMatches?.length ? job.semanticMatches.slice(0, 3).map((item) => <p key={item.requirement}><strong>{item.requirement}</strong> — {item.evidence}</p>) : job.matchingExperience.length ? job.matchingExperience.slice(0, 3).map((item) => <p key={item}>{item}</p>) : <p>No verified overlap was strong enough to cite.</p>}</div><div><span className="gap-label">Missing / watch-outs</span>{[...job.missingRequirements, ...job.redFlags].length ? [...job.missingRequirements, ...job.redFlags].slice(0, 3).map((item) => <p key={item}>{item}</p>) : <p>No material gap detected.</p>}{job.eligibility && <p className="eligibility-reason"><strong>{job.eligibility.label}</strong> — {job.eligibility.reasons[0]}</p>}</div></div>}
    <div className="job-footer"><span className="match-class"><i />{job.classification} match{job.enrichedAt ? " / Full JD" : ""}</span><span>{readableStatus(job.status)}</span>{onAnalyze && <button className="analyze-action" disabled={analyzing} onClick={onAnalyze}>{analyzing ? "Analyzing..." : job.enrichedAt ? "Re-analyze JD" : "Deep-analyze JD"}</button>}<button disabled={busy || job.status === "SKIPPED"} onClick={onReview}>{busy ? "Preparing..." : job.status === "SKIPPED" ? job.eligibility?.decision === "INELIGIBLE" ? "Location restricted" : "Low match" : "Prepare application"} -&gt;</button></div>
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
