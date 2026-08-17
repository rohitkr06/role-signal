"use client";

import { useMemo, useState, type CSSProperties, type ReactNode } from "react";

export type StudioContent = {
  name: string;
  headline: string;
  contactLine: string;
  summary: string;
  skills: string[];
  sections: Array<{ id: string; title: string; items: string[] }>;
  coverNote: string;
  answers: Array<{ id: string; question: string; answer: string }>;
};

export type StudioDocument = {
  id: string;
  jobId: string;
  resumeId?: string;
  version: number;
  status: string;
  title: string;
  content: StudioContent;
  evidence: Array<{ path: string; claim: string; source: string; sourceType: string; status: string }>;
  groundingScore: number;
  hasDocx: boolean;
  hasPdf: boolean;
  company: string;
  role: string;
  location: string;
  score: number;
  createdAt: string;
  updatedAt: string;
  approvedAt?: string;
};

type StudioJob = { id: string; company: string; role: string; score: number; isSample?: boolean };

type Props = {
  documents: StudioDocument[];
  jobs: StudioJob[];
  selectedId: string;
  busy: string;
  onSelect: (id: string) => void;
  onGenerate: (jobId: string) => Promise<void>;
  onSave: (id: string, content: StudioContent) => Promise<void>;
  onApprove: (id: string) => Promise<void>;
  onCopy: (value: string, label: string) => Promise<void>;
};

function cleanLines(value: string) {
  return value.split(/\n+/).map((item) => item.replace(/^[\s\u2022\u00b7*-]+/, "").trim()).filter(Boolean);
}

function statusLabel(value: string) {
  return value.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function StudioView({ documents, jobs, selectedId, busy, onSelect, onGenerate, onSave, onApprove, onCopy }: Props) {
  const active = documents.find((document) => document.id === selectedId) || documents[0];
  const [jobId, setJobId] = useState("");
  const [drafts, setDrafts] = useState<Record<string, StudioContent>>({});
  const [panel, setPanel] = useState<"resume" | "cover" | "answers">("resume");
  const draft = active ? drafts[active.id] || active.content : null;
  const selectedJobId = jobId || active?.jobId || jobs[0]?.id || "";

  const versions = useMemo(() => documents.filter((document) => document.jobId === active?.jobId), [documents, active?.jobId]);
  const needsReview = active?.evidence.filter((item) => item.status !== "VERIFIED") || [];
  const approved = active?.status === "APPROVED" || active?.status === "SUPERSEDED";

  function update<K extends keyof StudioContent>(key: K, value: StudioContent[K]) {
    if (!draft || !active) return;
    setDrafts((current) => ({ ...current, [active.id]: { ...draft, [key]: value } }));
  }

  function updateSection(index: number, key: "title" | "items", value: string | string[]) {
    if (!draft || !active) return;
    const sections = draft.sections.map((section, sectionIndex) => sectionIndex === index ? { ...section, [key]: value } : section);
    setDrafts((current) => ({ ...current, [active.id]: { ...draft, sections } }));
  }

  function updateAnswer(index: number, answer: string) {
    if (!draft || !active) return;
    setDrafts((current) => ({ ...current, [active.id]: { ...draft, answers: draft.answers.map((item, itemIndex) => itemIndex === index ? { ...item, answer } : item) } }));
  }

  return (
    <div className="page inner-page studio-page">
      <section className="studio-titlebar">
        <div><span className="eyebrow">Phase 6 / Tailored Application Studio</span><h1>Turn verified evidence into a sharper application.</h1><p>Create a role-specific resume, cover note and written answers. Every claim remains connected to resume evidence before export.</p></div>
        <div className="studio-create-control"><label>Build for<select value={selectedJobId} onChange={(event) => setJobId(event.target.value)}>{jobs.length ? jobs.map((job) => <option key={job.id} value={job.id}>{job.company} / {job.role} / {job.score}</option>) : <option value="">Prepare a live match first</option>}</select></label><button className="primary-button" disabled={!selectedJobId || busy === "studio-generate"} onClick={() => void onGenerate(selectedJobId)}><span>+</span>{busy === "studio-generate" ? "Building..." : active?.jobId === selectedJobId ? "Create new version" : "Generate tailored version"}</button></div>
      </section>

      {!documents.length ? (
        <section className="studio-empty"><span className="studio-document-mark">Aa</span><h2>Your first grounded draft starts here.</h2><p>Choose a qualified live match. RoleSignal will rank the strongest resume evidence, compose reusable answers and keep export locked until every claim is verified.</p><div><span>01 / Resume evidence</span><span>02 / Role requirements</span><span>03 / Approval</span></div></section>
      ) : active && draft ? (
        <div className="studio-layout">
          <aside className="studio-library">
            <div className="studio-library-head"><span className="card-kicker">Version library</span><strong>{active.company}</strong><small>{active.role}</small></div>
            {versions.map((document) => <button key={document.id} className={document.id === active.id ? "studio-version active" : "studio-version"} onClick={() => onSelect(document.id)}><span>v{document.version}</span><span><strong>{statusLabel(document.status)}</strong><small>{new Date(document.updatedAt).toLocaleDateString()}</small></span><b>{document.groundingScore}%</b></button>)}
            <div className="studio-library-note"><i>✓</i><span><strong>Evidence lock</strong><small>Edits are rescored against your resume before approval.</small></span></div>
          </aside>

          <section className="studio-workbench">
            <div className="studio-workbench-head"><div><span className="card-kicker">{active.company} / version {active.version}</span><h2>{active.role}</h2></div><div className="studio-tabs"><button className={panel === "resume" ? "active" : ""} onClick={() => setPanel("resume")}>Resume</button><button className={panel === "cover" ? "active" : ""} onClick={() => setPanel("cover")}>Cover note</button><button className={panel === "answers" ? "active" : ""} onClick={() => setPanel("answers")}>Answers</button></div></div>

            {panel === "resume" && <div className="resume-editor-paper">
              <input className="resume-name-input" value={draft.name} onChange={(event) => update("name", event.target.value)} aria-label="Candidate name" />
              <input className="resume-headline-input" value={draft.headline} onChange={(event) => update("headline", event.target.value)} aria-label="Resume headline" />
              <input className="resume-contact-input" value={draft.contactLine} onChange={(event) => update("contactLine", event.target.value)} placeholder="Email | phone | location | links" aria-label="Contact details" />
              <EditorSection title="Professional summary"><textarea rows={4} value={draft.summary} onChange={(event) => update("summary", event.target.value)} /></EditorSection>
              <EditorSection title="Core skills"><textarea rows={3} value={draft.skills.join(" | ")} onChange={(event) => update("skills", event.target.value.split(/[|,]/).map((item) => item.trim()).filter(Boolean))} /></EditorSection>
              {draft.sections.map((section, index) => <EditorSection key={section.id} title={section.title} editableTitle onTitle={(value) => updateSection(index, "title", value)}><textarea rows={Math.min(12, Math.max(4, section.items.length * 2))} value={section.items.join("\n")} onChange={(event) => updateSection(index, "items", cleanLines(event.target.value))} /></EditorSection>)}
            </div>}

            {panel === "cover" && <div className="studio-writing-panel"><span className="card-kicker">Role-specific cover note</span><h3>A concise, evidence-grounded opening</h3><textarea rows={15} value={draft.coverNote} onChange={(event) => update("coverNote", event.target.value)} /><button className="secondary-button" onClick={() => void onCopy(draft.coverNote, "Cover note")}>Copy cover note</button></div>}

            {panel === "answers" && <div className="studio-answer-list">{draft.answers.map((answer, index) => <label key={answer.id}><span>{answer.question}</span><textarea rows={6} value={answer.answer} onChange={(event) => updateAnswer(index, event.target.value)} /><button type="button" className="text-button" onClick={() => void onCopy(answer.answer, "Application answer")}>Copy answer -&gt;</button></label>)}</div>}

            <div className="studio-actionbar"><span><strong>{active.groundingScore}% grounded</strong><small>{needsReview.length ? `${needsReview.length} claim${needsReview.length === 1 ? "" : "s"} need source evidence` : "All current claims trace to verified inputs"}</small></span><button className="secondary-button" disabled={busy === `studio-save-${active.id}`} onClick={() => void onSave(active.id, draft)}>{busy === `studio-save-${active.id}` ? "Checking..." : "Save & recheck"}</button><button className="primary-button" disabled={needsReview.length > 0 || busy === `studio-approve-${active.id}`} onClick={() => void onApprove(active.id)}>{busy === `studio-approve-${active.id}` ? "Generating files..." : approved ? "Re-approve current version" : "Approve & generate files"}</button></div>
          </section>

          <aside className="studio-evidence-rail">
            <div className="grounding-gauge"><span style={{ "--grounding": `${active.groundingScore * 3.6}deg` } as CSSProperties}><b>{active.groundingScore}</b><small>grounded</small></span><div><strong>{needsReview.length ? "Review required" : "Evidence complete"}</strong><small>{active.evidence.length} mapped claims</small></div></div>
            <div className="evidence-rail-head"><span className="card-kicker">Claim provenance</span><small>Latest saved version</small></div>
            <div className="studio-evidence-list">{active.evidence.slice(0, 18).map((binding) => <article key={`${binding.path}-${binding.claim}`} className={binding.status === "VERIFIED" ? "verified" : "review"}><span>{binding.status === "VERIFIED" ? "✓" : "!"}</span><div><strong>{binding.claim}</strong><small>{binding.sourceType.replaceAll("_", " ")} / {binding.source}</small></div></article>)}</div>
            {approved && <div className="studio-downloads"><span className="card-kicker">Approved exports</span><a href={`/api/rolesignal/studio/download?id=${encodeURIComponent(active.id)}&format=docx`} download>Download ATS resume .DOCX</a><a href={`/api/rolesignal/studio/download?id=${encodeURIComponent(active.id)}&format=pdf`} download>Download polished resume .PDF</a><small>Exports are generated only from this approved version.</small></div>}
          </aside>
        </div>
      ) : null}
    </div>
  );
}

function EditorSection({ title, children, editableTitle = false, onTitle }: { title: string; children: ReactNode; editableTitle?: boolean; onTitle?: (value: string) => void }) {
  return <section className="studio-editor-section">{editableTitle ? <input value={title} onChange={(event) => onTitle?.(event.target.value)} aria-label="Section title" /> : <h3>{title}</h3>}{children}</section>;
}
