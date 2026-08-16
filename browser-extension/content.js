if (!globalThis.__roleSignalCompanionLoaded) {
  globalThis.__roleSignalCompanionLoaded = true;
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "ROLE_SIGNAL_STAGE") {
      try { sendResponse(stagePacket(message.packet)); }
      catch (error) { sendResponse({ error: error instanceof Error ? error.message : "Fill failed", filled: 0, unknownRequired: [] }); }
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
  if (packet.policy?.neverSubmit !== true) throw new Error("Missing no-submit policy.");
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
