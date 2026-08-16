if (!globalThis.__roleSignalCompanionLoaded) {
  globalThis.__roleSignalCompanionLoaded = true;
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "ROLE_SIGNAL_STAGE") return;
    try { sendResponse(stagePacket(message.packet)); }
    catch (error) { sendResponse({ error: error instanceof Error ? error.message : "Fill failed", filled: 0, unknownRequired: [] }); }
  });
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
