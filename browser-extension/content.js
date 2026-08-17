if (!globalThis.__roleSignalCompanionLoaded) {
  globalThis.__roleSignalCompanionLoaded = true;
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "ROLE_SIGNAL_STAGE") {
      try { sendResponse(stagePacket(message.packet)); }
      catch (error) { sendResponse({ error: error instanceof Error ? error.message : "Fill failed", filled: 0, unknownRequired: [] }); }
    }
    if (message?.type === "ROLE_SIGNAL_EXECUTE") {
      executePacket(message.packet).then(sendResponse).catch((error) => sendResponse({ error: error instanceof Error ? error.message : "Execution failed", fieldsFilled: 0, unknownRequired: [] }));
      return true;
    }
    if (message?.type === "ROLE_SIGNAL_CAPTURE") {
      try { sendResponse(captureVisibleJobs()); }
      catch (error) { sendResponse({ error: error instanceof Error ? error.message : "Capture failed", jobs: [] }); }
    }
  });
}

function captureVisibleJobs() {
  const portal = portalName();
  const selectors = portal === "LinkedIn"
    ? [".jobs-search-results__list-item", ".job-card-container", "[data-occludable-job-id]"]
    : portal === "Naukri"
      ? [".srp-jobtuple-wrapper", ".jobTuple", "article.jobTuple"]
      : portal === "Workday"
        ? ["[data-automation-id='jobTitle']", "[data-automation-id='jobSearchResult']", "li"]
        : portal === "Indeed"
          ? [".job_seen_beacon", ".result", "li.css-5lfssm"]
          : ["article", "li", "[class*='job-card']", "[class*='jobCard']"];
  const cards = [...new Set(selectors.flatMap((selector) => [...document.querySelectorAll(selector)]))];
  const jobs = [];
  const seen = new Set();
  for (const card of cards) {
    const anchor = bestJobAnchor(card);
    if (!anchor?.href) continue;
    const applicationUrl = cleanJobUrl(anchor.href);
    if (!applicationUrl || seen.has(applicationUrl)) continue;
    const role = textFrom(card, ["[data-automation-id='jobTitle']", ".job-card-list__title", ".title", ".jobTitle", "h2", "h3", "a[aria-label]"]) || cleanText(anchor.textContent);
    if (!role || role.length < 3 || role.length > 180) continue;
    const company = textFrom(card, ["[data-automation-id='company']", ".artdeco-entity-lockup__subtitle", ".comp-name", ".companyName", "[class*='company']"]);
    const location = textFrom(card, ["[data-automation-id='locations']", ".job-card-container__metadata-item", ".locWdth", ".companyLocation", "[class*='location']"]);
    const postedDate = textFrom(card, ["time", "[data-automation-id='postedOn']", ".job-post-day", ".date"]);
    const cardText = cleanText(card.textContent).slice(0, 6000);
    jobs.push({
      externalId: card.getAttribute("data-job-id") || card.getAttribute("data-occludable-job-id") || "",
      role,
      company: company || hostCompany(applicationUrl),
      location: location || "Not specified",
      postedDate,
      applicationUrl,
      description: cardText,
    });
    seen.add(applicationUrl);
    if (jobs.length >= 100) break;
  }
  return {
    captureVersion: 1,
    portal,
    sourceUrl: location.href,
    capturedAt: new Date().toISOString(),
    jobs,
  };
}

function portalName() {
  const host = location.hostname.toLowerCase();
  if (host.includes("linkedin")) return "LinkedIn";
  if (host.includes("naukri")) return "Naukri";
  if (host.includes("myworkdayjobs") || host.includes("workday")) return "Workday";
  if (host.includes("indeed")) return "Indeed";
  if (host.includes("wellfound")) return "Wellfound";
  if (host.includes("cutshort")) return "Cutshort";
  if (host.includes("instahyre")) return "Instahyre";
  if (host.includes("hirist")) return "Hirist";
  if (host.includes("foundit")) return "Foundit";
  if (host.includes("ycombinator")) return "YC Startups";
  if (host.includes("glassdoor")) return "Glassdoor";
  return "Browser capture";
}

function bestJobAnchor(card) {
  const anchors = [...card.querySelectorAll("a[href]")];
  return anchors.find((anchor) => /\/jobs?\/|jobview|jobposting|position|career|myworkdayjobs/i.test(anchor.href)) || anchors[0] || (card.matches("a[href]") ? card : null);
}

function cleanJobUrl(value) {
  try {
    const url = new URL(value, location.href);
    if (url.protocol !== "https:") return "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(trk|tracking|ref|refid|utm_|currentjobid)/i.test(key)) url.searchParams.delete(key);
    }
    url.hash = "";
    return url.toString();
  } catch { return ""; }
}

function textFrom(card, selectors) {
  for (const selector of selectors) {
    const element = card.matches?.(selector) ? card : card.querySelector(selector);
    const value = cleanText(element?.textContent || element?.getAttribute?.("aria-label"));
    if (value) return value.slice(0, 240);
  }
  return "";
}

function cleanText(value = "") {
  return value.replace(/\s+/g, " ").trim();
}

function hostCompany(urlValue) {
  try { return new URL(urlValue).hostname.replace(/^www\./, "").split(".")[0].replace(/[-_]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
  catch { return "Unknown company"; }
}

function stagePacket(packet) {
  if (location.hostname !== packet.allowedHost && !location.hostname.endsWith(`.${packet.allowedHost}`)) {
    throw new Error(`This packet is locked to ${packet.allowedHost}.`);
  }
  if (packet.schemaVersion === 1 && packet.policy?.neverSubmit !== true) throw new Error("Missing no-submit policy.");
  const values = { ...(packet.fields || {}), ...(packet.answers || {}) };
  const fields = [...document.querySelectorAll("input:not([type=hidden]):not([type=submit]), textarea, select")];
  const unknownRequired = [];
  let filled = 0;

  for (const field of fields) {
    if (field.disabled || field.readOnly || field.type === "file" || field.type === "checkbox" || field.type === "radio") continue;
    const context = fieldContext(field);
    const key = fieldKey(context);
    const value = key ? values[key] : "";
    if (value) {
      setNativeValue(field, String(value));
      field.style.outline = "2px solid #3ea879";
      field.dataset.rolesignal = "filled";
      filled += 1;
    } else if (field.required) {
      field.style.outline = "2px solid #d89250";
      field.dataset.rolesignal = "needs-input";
      unknownRequired.push(context || field.name || field.id || "Required field");
    }
  }

  showBanner(filled, unknownRequired.length);
  return { filled, unknownRequired };
}

async function executePacket(packet) {
  if (packet.schemaVersion !== 2 || !packet.executionId) throw new Error("This is not a Phase 7 execution packet.");
  if (location.hostname !== packet.allowedHost && !location.hostname.endsWith(`.${packet.allowedHost}`)) throw new Error(`This execution is locked to ${packet.allowedHost}.`);
  const captchaDetected = hasCaptcha();
  if (captchaDetected) {
    showExecutionBanner("RoleSignal paused: CAPTCHA or bot protection requires you.", true);
    return { outcome: "PAUSED", fieldsFilled: 0, unknownRequired: [], captchaDetected: true, submissionConfirmed: false };
  }

  const staged = stagePacket(packet);
  let resumeUploaded = false;
  const fileInput = [...document.querySelectorAll("input[type='file']")].find((field) => !field.disabled);
  if (fileInput && packet.approvedResume) {
    const download = await chrome.runtime.sendMessage({ type: "ROLE_SIGNAL_FETCH_RESUME", path: packet.approvedResume.downloadPath });
    if (download?.error) throw new Error(download.error);
    const bytes = Uint8Array.from(atob(download.base64), (character) => character.charCodeAt(0));
    const file = new File([bytes], packet.approvedResume.filename, { type: download.type || "application/pdf" });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    fileInput.files = transfer.files;
    fileInput.dispatchEvent(new Event("input", { bubbles: true }));
    fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    fileInput.dataset.rolesignal = "filled";
    fileInput.style.outline = "2px solid #3ea879";
    resumeUploaded = true;
  }

  await pause(400);
  const unknownRequired = [...new Set([...staged.unknownRequired, ...requiredFieldsStillEmpty()])];
  if (unknownRequired.length) {
    showExecutionBanner(`RoleSignal paused: ${unknownRequired.length} required field${unknownRequired.length === 1 ? "" : "s"} need your input.`, true);
    return { outcome: "PAUSED", fieldsFilled: staged.filled + (resumeUploaded ? 1 : 0), unknownRequired, captchaDetected: false, submissionConfirmed: false };
  }

  if (!packet.policy?.allowAutoSubmit) {
    showExecutionBanner("RoleSignal filled the application. Review and submit when ready.", false);
    return { outcome: "READY_TO_SUBMIT", fieldsFilled: staged.filled + (resumeUploaded ? 1 : 0), unknownRequired: [], captchaDetected: false, submissionConfirmed: false };
  }

  const submit = findFinalSubmit();
  if (!submit || submit.disabled) {
    const missing = ["Final application submit control"];
    showExecutionBanner("RoleSignal filled the application but could not verify the final submit control.", true);
    return { outcome: "SUBMIT_UNCONFIRMED", fieldsFilled: staged.filled + (resumeUploaded ? 1 : 0), unknownRequired: missing, captchaDetected: false, submissionConfirmed: false };
  }

  const beforeUrl = location.href;
  submit.click();
  await pause(3500);
  const submissionConfirmed = confirmsSubmission(beforeUrl);
  showExecutionBanner(submissionConfirmed ? "RoleSignal confirmed the application was submitted." : "RoleSignal clicked submit but needs you to confirm the result.", !submissionConfirmed);
  return {
    outcome: submissionConfirmed ? "SUBMITTED" : "SUBMIT_UNCONFIRMED",
    fieldsFilled: staged.filled + (resumeUploaded ? 1 : 0),
    unknownRequired: submissionConfirmed ? [] : ["Confirm whether the portal accepted the submission"],
    captchaDetected: hasCaptcha(),
    submissionConfirmed,
  };
}

function requiredFieldsStillEmpty() {
  const missing = [];
  const fields = [...document.querySelectorAll("input[required], textarea[required], select[required]")];
  for (const field of fields) {
    if (field.disabled) continue;
    const context = fieldContext(field) || field.name || field.id || "Required field";
    if (field.type === "checkbox" && !field.checked) missing.push(context);
    else if (field.type === "radio") {
      const name = CSS.escape(field.name || field.id || "");
      if (name && !document.querySelector(`input[type='radio'][name='${name}']:checked`)) missing.push(context);
    } else if (field.type === "file" && !(field.files?.length)) missing.push(context);
    else if (field.tagName === "SELECT" && !field.value) missing.push(context);
    else if (!field.value?.trim?.()) missing.push(context);
  }
  return missing;
}

function hasCaptcha() {
  return Boolean(document.querySelector("iframe[src*='recaptcha'], iframe[src*='hcaptcha'], .g-recaptcha, .h-captcha, [data-sitekey]")) || /captcha|verify you are human|security check/i.test(document.body?.innerText?.slice(0, 12000) || "");
}

function findFinalSubmit() {
  const controls = [...document.querySelectorAll("button, input[type='submit']")];
  return controls.find((control) => {
    const text = cleanText(control.innerText || control.value || control.getAttribute("aria-label") || "");
    return /^(submit( application)?|send application|complete application|apply now)$/i.test(text) && !/next|continue|save|review/i.test(text);
  });
}

function confirmsSubmission(beforeUrl) {
  const text = cleanText(document.body?.innerText || "").slice(0, 20000);
  return /application (has been )?(submitted|received)|thank you for (applying|your application)|we received your application/i.test(text) || (location.href !== beforeUrl && /thank|confirmation|submitted|success/i.test(location.href));
}

function pause(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }

function showExecutionBanner(message, warning) {
  document.querySelector("#rolesignal-companion-banner")?.remove();
  const banner = document.createElement("div");
  banner.id = "rolesignal-companion-banner";
  banner.textContent = message;
  Object.assign(banner.style, { position: "fixed", right: "18px", top: "18px", zIndex: "2147483647", maxWidth: "390px", padding: "13px 16px", borderRadius: "10px", background: warning ? "#7a471f" : "#15392b", color: "white", font: "600 12px/1.45 system-ui", boxShadow: "0 12px 32px rgba(0,0,0,.2)" });
  document.body.appendChild(banner);
}

function fieldContext(field) {
  const labels = field.labels ? [...field.labels].map((label) => label.textContent || "") : [];
  const nearby = field.closest("label")?.textContent || field.parentElement?.textContent?.slice(0, 120) || "";
  return [field.name, field.id, field.getAttribute("aria-label"), field.placeholder, ...labels, nearby]
    .filter(Boolean).join(" ").toLowerCase().replace(/\s+/g, " ").trim();
}

function fieldKey(context) {
  const rules = [
    ["first_name", /first\s*name|first_name|firstname/],
    ["last_name", /last\s*name|surname|last_name|lastname/],
    ["full_name", /full\s*name|candidate\s*name|your\s*name|^name$/],
    ["email", /e-?mail/],
    ["phone", /phone|mobile|telephone/],
    ["linkedin_url", /linkedin/],
    ["github_url", /github/],
    ["current_location", /current\s*location|where\s*(are\s*)?you\s*located|city\s*(of\s*)?residence/],
    ["current_company", /current\s*(company|employer)|organization/],
    ["current_title", /current\s*(title|role)|job\s*title/],
    ["notice_period", /notice\s*period|available\s*to\s*start|joining\s*time/],
    ["current_compensation", /current\s*(compensation|salary|ctc)/],
    ["expected_compensation", /expected\s*(compensation|salary|ctc)|salary\s*expectation/],
    ["work_authorization", /work\s*authorization|legally\s*authorized|visa\s*(status|sponsorship)|require\s*sponsorship/],
    ["relocation", /relocat/],
  ];
  return rules.find(([, pattern]) => pattern.test(context))?.[0] || "";
}

function setNativeValue(field, value) {
  const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : field instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (setter) setter.call(field, value); else field.value = value;
  field.dispatchEvent(new Event("input", { bubbles: true }));
  field.dispatchEvent(new Event("change", { bubbles: true }));
}

function showBanner(filled, unknown) {
  document.querySelector("#rolesignal-companion-banner")?.remove();
  const banner = document.createElement("div");
  banner.id = "rolesignal-companion-banner";
  banner.textContent = unknown
    ? `RoleSignal filled ${filled} fields · ${unknown} required fields need input · review before submitting`
    : `RoleSignal filled ${filled} fields · review before submitting`;
  Object.assign(banner.style, { position: "fixed", right: "18px", top: "18px", zIndex: "2147483647", maxWidth: "360px", padding: "12px 15px", borderRadius: "10px", background: unknown ? "#7a471f" : "#15392b", color: "white", font: "600 12px/1.4 system-ui", boxShadow: "0 12px 32px rgba(0,0,0,.2)" });
  document.body.appendChild(banner);
  setTimeout(() => banner.remove(), 9000);
}
