import type { CandidateProfile, ScoredJob } from "./rolesignal";

export type StudioSection = {
  id: string;
  title: string;
  items: string[];
};

export type StudioAnswer = {
  id: string;
  question: string;
  answer: string;
};

export type StudioContent = {
  name: string;
  headline: string;
  contactLine: string;
  summary: string;
  skills: string[];
  sections: StudioSection[];
  coverNote: string;
  answers: StudioAnswer[];
};

export type EvidenceBinding = {
  path: string;
  claim: string;
  source: string;
  sourceType: "resume" | "career_profile" | "answer_vault" | "job_description";
  status: "VERIFIED" | "NEEDS_REVIEW";
};

export type StudioJob = {
  id: string;
  company: string;
  role: string;
  location: string;
  description: string;
  applicationUrl: string;
  score: number;
};

const stopWords = new Set([
  "about", "after", "against", "also", "among", "and", "are", "been", "being", "build", "built", "company", "for", "from",
  "have", "into", "more", "role", "that", "the", "their", "this", "through", "using", "with", "work", "your",
]);

function clean(value: string, max = 500) {
  return value.replace(/[\u2010-\u2015]/g, "-").replace(/\s+/g, " ").trim().slice(0, max);
}

function normalized(value: string) {
  return clean(value).toLowerCase().replace(/[^a-z0-9+#.]+/g, " ").replace(/\s+/g, " ").trim();
}

function tokens(value: string) {
  return [...new Set(normalized(value).split(" ").filter((token) => token.length > 2 && !stopWords.has(token)))];
}

function overlapScore(value: string, reference: string) {
  const left = tokens(value);
  if (!left.length) return 0;
  const right = new Set(tokens(reference));
  return left.filter((token) => right.has(token)).length / left.length;
}

function unique(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = normalized(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function ranked(values: string[], reference: string) {
  return unique(values.map((value) => clean(value, 700))).sort((a, b) => overlapScore(b, reference) - overlapScore(a, reference));
}

const headingAliases: Array<[RegExp, string]> = [
  [/^(professional\s+)?experience|employment|work history$/i, "Experience"],
  [/^projects?|selected projects$/i, "Projects"],
  [/^education|academic background$/i, "Education"],
  [/^certifications?|licenses?$/i, "Certifications"],
  [/^achievements?|awards?|highlights?$/i, "Achievements"],
];

function extractResumeSections(rawText: string, reserved: string[]) {
  const lines = rawText.replace(/\r/g, "").split(/\n+/).map((line) => clean(line.replace(/^[\s\u2022\u00b7*-]+/, ""), 700)).filter(Boolean);
  const sections: StudioSection[] = [];
  let active: StudioSection | null = null;
  const reservedKeys = new Set(reserved.map(normalized));

  for (const line of lines) {
    const heading = headingAliases.find(([pattern]) => pattern.test(line.replace(/[:|]+$/, "").trim()));
    if (heading) {
      active = { id: heading[1].toLowerCase().replace(/\s+/g, "-"), title: heading[1], items: [] };
      sections.push(active);
      continue;
    }
    if (!active || line.length < 3 || line.length > 700 || reservedKeys.has(normalized(line))) continue;
    if (/^(summary|objective|skills?|technologies|contact|profile)$/i.test(line)) continue;
    active.items.push(line);
  }

  const priority: Record<string, number> = { Experience: 1, Projects: 2, Achievements: 3, Education: 4, Certifications: 5 };
  return sections
    .map((section) => ({ ...section, items: unique(section.items).slice(0, section.title === "Experience" ? 24 : 12) }))
    .filter((section) => section.items.length)
    .sort((a, b) => (priority[a.title] ?? 9) - (priority[b.title] ?? 9));
}

function primaryEvidence(profile: CandidateProfile, scored: Partial<ScoredJob>, job: StudioJob) {
  const semantic = (scored.semanticMatches ?? []).map((item) => item.evidence);
  return ranked([...profile.evidence, ...semantic], `${job.role} ${job.description}`).slice(0, 7);
}

function primarySkills(profile: CandidateProfile, job: StudioJob) {
  return ranked(profile.skills, `${job.role} ${job.description}`).slice(0, 18);
}

function contactLine(profile: CandidateProfile, vault: Record<string, string>, rawText: string) {
  const extractedEmail = rawText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || "";
  const extractedPhone = rawText.match(/(?:\+\d{1,3}[\s-]?)?(?:\(?\d{2,4}\)?[\s-]?)?\d{3,5}[\s-]\d{3,5}/)?.[0] || "";
  const extractedLinkedIn = rawText.match(/https?:\/\/(?:www\.)?linkedin\.com\/[^\s|]+/i)?.[0] || "";
  const extractedGitHub = rawText.match(/https?:\/\/(?:www\.)?github\.com\/[^\s|]+/i)?.[0] || "";
  return unique([
    profile.email || extractedEmail,
    vault.phone || extractedPhone,
    vault.current_location,
    vault.linkedin_url || extractedLinkedIn,
    vault.github_url || extractedGitHub,
  ].map((value) => clean(value ?? "", 180))).join(" | ");
}

export function buildStudioContent(
  profile: CandidateProfile,
  rawText: string,
  job: StudioJob,
  scored: Partial<ScoredJob>,
  vault: Record<string, string>,
) {
  const evidence = primaryEvidence(profile, scored, job);
  const skills = primarySkills(profile, job);
  const focus = unique([...profile.domains, ...skills]).slice(0, 4);
  const summary = clean(
    `${profile.title || "Software Engineer"} focused on ${focus.join(", ") || "production software delivery"}. ` +
    `Brings verified experience across ${skills.slice(0, 6).join(", ") || "backend engineering, systems design and reliability"}.`,
    700,
  );
  const selectedImpact: StudioSection = { id: "selected-impact", title: "Selected Impact", items: evidence };
  const parsedSections = extractResumeSections(rawText, evidence);
  const sections = [selectedImpact, ...parsedSections].filter((section) => section.items.length).slice(0, 6);
  const lead = evidence[0] || `Delivered production ${profile.title || "software engineering"} work.`;
  const second = evidence[1] || profile.domains[0] || skills[0] || "production engineering";
  const coverNote = clean(
    `I am interested in the ${job.role} opportunity at ${job.company}. My background aligns with the role through ${lead} ` +
    `I would bring the same evidence-led approach to ${second}, while learning the company-specific context quickly.`,
    1_800,
  );
  const answers: StudioAnswer[] = [
    {
      id: "why-this-role",
      question: "Why are you interested in this role?",
      answer: clean(`The ${job.role} role connects directly with my experience in ${skills.slice(0, 4).join(", ") || profile.domains.slice(0, 2).join(" and ")}. ${lead}`, 1_200),
    },
    {
      id: "relevant-achievement",
      question: "What relevant achievement best demonstrates your fit?",
      answer: clean(lead, 1_200),
    },
  ];
  const content: StudioContent = {
    name: clean(profile.name || "Candidate", 120),
    headline: clean(`${profile.title || "Software Engineer"} | Target: ${job.role}`, 180),
    contactLine: contactLine(profile, vault, rawText),
    summary,
    skills,
    sections,
    coverNote,
    answers,
  };
  const bindings = createGeneratedBindings(content, profile, rawText, job, vault, evidence);
  return { content, evidence: bindings, groundingScore: 100 };
}

function contentClaims(content: StudioContent) {
  const claims: Array<{ path: string; claim: string }> = [
    { path: "name", claim: content.name },
    { path: "headline", claim: content.headline },
    { path: "contactLine", claim: content.contactLine },
    { path: "summary", claim: content.summary },
    { path: "coverNote", claim: content.coverNote },
    ...content.skills.map((claim, index) => ({ path: `skills.${index}`, claim })),
    ...content.sections.flatMap((section) => section.items.map((claim, index) => ({ path: `sections.${section.id}.${index}`, claim }))),
    ...content.answers.map((answer) => ({ path: `answers.${answer.id}`, claim: answer.answer })),
  ];
  return claims.filter((item) => clean(item.claim).length > 0);
}

function sourceTypeFor(source: string, rawText: string, vault: Record<string, string>, job: StudioJob): EvidenceBinding["sourceType"] {
  if (Object.values(vault).some((value) => value && normalized(source).includes(normalized(value)))) return "answer_vault";
  if (normalized(rawText).includes(normalized(source))) return "resume";
  if (normalized(`${job.role} ${job.company} ${job.description}`).includes(normalized(source))) return "job_description";
  return "career_profile";
}

function createGeneratedBindings(
  content: StudioContent,
  profile: CandidateProfile,
  rawText: string,
  job: StudioJob,
  vault: Record<string, string>,
  rankedEvidence: string[],
) {
  const profileSource = unique([profile.title, ...profile.skills, ...profile.domains, ...profile.evidence]).join(" | ");
  const answersById = Object.fromEntries(content.answers.map((answer) => [answer.id, answer.answer]));
  return contentClaims(content).map(({ path, claim }) => {
    let source = profileSource;
    if (path === "name") source = profile.name;
    if (path === "headline") source = `${profile.title} | ${job.role}`;
    if (path === "contactLine") source = unique([profile.email, ...Object.values(vault), ...rawText.split(/\n+/).filter((line) => /@|linkedin|github|\+\d/.test(line))]).join(" | ");
    if (path.startsWith("sections.")) source = rankedEvidence.find((item) => normalized(item) === normalized(claim)) || claim;
    if (path.startsWith("skills.")) source = profile.skills.find((item) => normalized(item) === normalized(claim)) || claim;
    if (path === "coverNote" || path.startsWith("answers.")) {
      const answerId = path.replace("answers.", "");
      source = `${job.role} at ${job.company} | ${rankedEvidence.slice(0, 2).join(" | ")} | ${answersById[answerId] ?? ""}`;
    }
    return { path, claim, source, sourceType: sourceTypeFor(source, rawText, vault, job), status: "VERIFIED" as const };
  });
}

export function validateStudioContent(
  content: StudioContent,
  previous: EvidenceBinding[],
  profile: CandidateProfile,
  rawText: string,
  job: StudioJob,
  vault: Record<string, string>,
) {
  const sourceLines = unique([
    ...rawText.replace(/\r/g, "").split(/\n+/).map((line) => clean(line, 700)),
    profile.name,
    profile.title,
    ...profile.skills,
    ...profile.domains,
    ...profile.evidence,
    job.role,
    job.company,
    job.location,
    ...Object.values(vault),
  ]).filter(Boolean);
  const previousByPath = new Map(previous.map((binding) => [binding.path, binding]));
  const evidence = contentClaims(content).map(({ path, claim }) => {
    const prior = previousByPath.get(path);
    if (prior && normalized(prior.claim) === normalized(claim) && prior.status === "VERIFIED") return { ...prior, claim };
    const exact = sourceLines.find((source) => normalized(source) === normalized(claim) || normalized(source).includes(normalized(claim)));
    const best = exact || [...sourceLines].sort((a, b) => overlapScore(claim, b) - overlapScore(claim, a))[0] || "";
    const score = overlapScore(claim, best);
    const verified = Boolean(exact) || (tokens(claim).length >= 3 && score >= 0.58);
    return {
      path,
      claim,
      source: best,
      sourceType: sourceTypeFor(best, rawText, vault, job),
      status: verified ? "VERIFIED" as const : "NEEDS_REVIEW" as const,
    };
  });
  const verifiedCount = evidence.filter((item) => item.status === "VERIFIED").length;
  return { evidence, groundingScore: evidence.length ? Math.round((verifiedCount / evidence.length) * 100) : 0 };
}

function xml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function paragraph(text: string, style = "Normal", bold = false) {
  return `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr><w:r><w:rPr>${bold ? "<w:b/>" : ""}</w:rPr><w:t xml:space="preserve">${xml(clean(text, 4_000))}</w:t></w:r></w:p>`;
}

function bullet(text: string) {
  return `<w:p><w:pPr><w:pStyle w:val="ListBullet"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t xml:space="preserve">${xml(clean(text, 4_000))}</w:t></w:r></w:p>`;
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function write16(view: DataView, offset: number, value: number) { view.setUint16(offset, value, true); }
function write32(view: DataView, offset: number, value: number) { view.setUint32(offset, value >>> 0, true); }

function concatBytes(parts: Uint8Array[]) {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length; }
  return output;
}

function zipStore(files: Array<{ name: string; data: string }>) {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let localOffset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = encoder.encode(file.data);
    const checksum = crc32(data);
    const local = new Uint8Array(30 + name.length);
    const localView = new DataView(local.buffer);
    write32(localView, 0, 0x04034b50); write16(localView, 4, 20); write16(localView, 6, 0x0800); write16(localView, 8, 0);
    write16(localView, 10, 0); write16(localView, 12, 0); write32(localView, 14, checksum); write32(localView, 18, data.length); write32(localView, 22, data.length);
    write16(localView, 26, name.length); write16(localView, 28, 0); local.set(name, 30);
    localParts.push(local, data);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    write32(centralView, 0, 0x02014b50); write16(centralView, 4, 20); write16(centralView, 6, 20); write16(centralView, 8, 0x0800); write16(centralView, 10, 0);
    write16(centralView, 12, 0); write16(centralView, 14, 0); write32(centralView, 16, checksum); write32(centralView, 20, data.length); write32(centralView, 24, data.length);
    write16(centralView, 28, name.length); write16(centralView, 30, 0); write16(centralView, 32, 0); write16(centralView, 34, 0); write16(centralView, 36, 0);
    write32(centralView, 38, 0); write32(centralView, 42, localOffset); central.set(name, 46);
    centralParts.push(central);
    localOffset += local.length + data.length;
  }
  const central = concatBytes(centralParts);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  write32(endView, 0, 0x06054b50); write16(endView, 4, 0); write16(endView, 6, 0); write16(endView, 8, files.length); write16(endView, 10, files.length);
  write32(endView, 12, central.length); write32(endView, 16, localOffset); write16(endView, 20, 0);
  return concatBytes([...localParts, central, end]);
}

const atsResumeStyle = {
  basePreset: "standard_business_brief",
  headerPattern: "memo_masthead",
  page: { marginDxa: 1440, headerFooterDxa: 708 },
  namedOverrides: {
    resumeTitle: "24pt centered",
    compactSectionHeading: "13pt, 12pt before, 4pt after",
    compactEvidenceList: "5pt after, 1.167 line spacing",
  },
} as const;

export function buildResumeDocx(content: StudioContent, job: StudioJob, generatedAt: string) {
  const body = [
    paragraph(content.name, "Title"),
    paragraph(content.headline, "Subtitle"),
    content.contactLine ? paragraph(content.contactLine, "Contact") : "",
    paragraph("Professional Summary", "Heading1"),
    paragraph(content.summary),
    paragraph("Core Skills", "Heading1"),
    paragraph(content.skills.join(" | "), "Skills"),
    ...content.sections.flatMap((section) => [paragraph(section.title, "Heading1"), ...section.items.map(bullet)]),
  ].filter(Boolean).join("");
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body}<w:sectPr><w:footerReference w:type="default" r:id="rId4"/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="${atsResumeStyle.page.marginDxa}" w:right="${atsResumeStyle.page.marginDxa}" w:bottom="${atsResumeStyle.page.marginDxa}" w:left="${atsResumeStyle.page.marginDxa}" w:header="${atsResumeStyle.page.headerFooterDxa}" w:footer="${atsResumeStyle.page.headerFooterDxa}" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/><w:color w:val="1E2923"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:before="0" w:after="120" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:spacing w:before="0" w:after="120" w:line="264" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/><w:spacing w:before="0" w:after="60"/><w:pBdr><w:bottom w:val="single" w:sz="10" w:space="8" w:color="2B6B52"/></w:pBdr></w:pPr><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:b/><w:sz w:val="48"/><w:color w:val="173F31"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/><w:spacing w:before="0" w:after="40"/></w:pPr><w:rPr><w:b/><w:sz w:val="22"/><w:color w:val="465B51"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Contact"><w:name w:val="Contact"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/><w:spacing w:before="0" w:after="120"/></w:pPr><w:rPr><w:sz w:val="19"/><w:color w:val="5D6B64"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="Heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:keepNext/><w:pPr><w:spacing w:before="240" w:after="80"/><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="4" w:color="BFD5CA"/></w:pBdr></w:pPr><w:rPr><w:b/><w:caps/><w:sz w:val="26"/><w:color w:val="2B6B52"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Skills"><w:name w:val="Skills"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="100" w:line="252" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="20"/><w:color w:val="273A31"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="0" w:after="100" w:line="280" w:lineRule="auto"/></w:pPr></w:style></w:styles>`;
  const numbering = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="&#x2022;"/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="360"/></w:tabs><w:ind w:left="720" w:hanging="360"/></w:pPr><w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol"/></w:rPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`;
  const footer = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:sz w:val="16"/><w:color w:val="7B8A82"/></w:rPr><w:t>${xml(`Tailored for ${job.company} | `)}</w:t></w:r><w:fldSimple w:instr="PAGE"><w:r><w:rPr><w:sz w:val="16"/><w:color w:val="7B8A82"/></w:rPr><w:t>1</w:t></w:r></w:fldSimple></w:p></w:ftr>`;
  return zipStore([
    { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>` },
    { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>` },
    { name: "word/document.xml", data: documentXml },
    { name: "word/styles.xml", data: styles },
    { name: "word/numbering.xml", data: numbering },
    { name: "word/settings.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:zoom w:percent="100"/><w:defaultTabStop w:val="720"/><w:evenAndOddHeaders w:val="0"/></w:settings>` },
    { name: "word/footer1.xml", data: footer },
    { name: "word/_rels/document.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>` },
    { name: "docProps/core.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(`${content.name} - ${job.role}`)}</dc:title><dc:subject>Evidence-grounded tailored resume</dc:subject><dc:creator>${xml(content.name)}</dc:creator><cp:lastModifiedBy>RoleSignal</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${xml(generatedAt)}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${xml(generatedAt)}</dcterms:modified></cp:coreProperties>` },
    { name: "docProps/app.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>RoleSignal</Application><AppVersion>6.0</AppVersion></Properties>` },
  ]);
}

function ascii(value: string) {
  return value.replace(/[\u2010-\u2015]/g, "-").replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/[^\x20-\x7e]/g, " ").replace(/\s+/g, " ").trim();
}

function pdfEscape(value: string) {
  return ascii(value).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function wrapPdf(value: string, fontSize: number, width: number) {
  const words = ascii(value).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length * fontSize * 0.51 <= width || !line) line = next;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines;
}

export function buildResumePdf(content: StudioContent, job: StudioJob) {
  const pages: string[][] = [[]];
  let page = pages[0];
  let y = 728;
  const left = 72;
  const width = 468;
  const addPage = () => { page = []; pages.push(page); y = 726; page.push(`BT /F2 9 Tf 0.28 0.36 0.32 rg 1 0 0 1 ${left} 746 Tm (${pdfEscape(content.name)} | ${pdfEscape(job.role)}) Tj ET`); };
  const ensure = (height: number) => { if (y - height < 58) addPage(); };
  const line = (text: string, size = 10.2, bold = false, indent = 0, color = "0.12 0.16 0.14") => {
    const wrapped = wrapPdf(text, size, width - indent);
    ensure(wrapped.length * (size + 3) + 2);
    for (const item of wrapped) {
      page.push(`BT /F${bold ? 2 : 1} ${size.toFixed(1)} Tf ${color} rg 1 0 0 1 ${left + indent} ${y.toFixed(1)} Tm (${pdfEscape(item)}) Tj ET`);
      y -= size + 3;
    }
  };
  const heading = (text: string) => {
    ensure(30); y -= 7;
    line(text.toUpperCase(), 11.5, true, 0, "0.11 0.34 0.25");
    page.push(`0.72 0.83 0.77 RG 0.7 w ${left} ${(y + 5).toFixed(1)} m ${left + width} ${(y + 5).toFixed(1)} l S`);
    y -= 4;
  };
  line(content.name, 23, true, 0, "0.07 0.23 0.17");
  y += 2; line(content.headline, 10.5, true, 0, "0.24 0.34 0.29");
  if (content.contactLine) line(content.contactLine, 8.7, false, 0, "0.34 0.42 0.38");
  heading("Professional Summary"); line(content.summary, 10.2);
  heading("Core Skills"); line(content.skills.join(" | "), 9.4);
  for (const section of content.sections) {
    heading(section.title);
    for (const item of section.items) { ensure(28); line(`- ${item}`, 10, false, 10); y -= 1; }
  }
  pages.forEach((commands, index) => {
    commands.push(`BT /F1 8 Tf 0.45 0.52 0.48 rg 1 0 0 1 ${left} 34 Tm (Tailored for ${pdfEscape(job.company)}) Tj ET`);
    commands.push(`BT /F1 8 Tf 0.45 0.52 0.48 rg 1 0 0 1 520 34 Tm (${index + 1}) Tj ET`);
  });

  const objects: string[] = ["", "<< /Type /Catalog /Pages 2 0 R >>", "", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>"];
  const kids: string[] = [];
  pages.forEach((commands) => {
    const pageId = objects.length;
    const contentId = pageId + 1;
    kids.push(`${pageId} 0 R`);
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`);
    const stream = commands.join("\n");
    objects.push(`<< /Length ${new TextEncoder().encode(stream).length} >>\nstream\n${stream}\nendstream`);
  });
  objects[2] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${kids.length} >>`;
  let pdf = "%PDF-1.4\n%RSIG\n";
  const offsets = [0];
  for (let index = 1; index < objects.length; index += 1) {
    offsets[index] = new TextEncoder().encode(pdf).length;
    pdf += `${index} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xref = new TextEncoder().encode(pdf).length;
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let index = 1; index < objects.length; index += 1) pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}
