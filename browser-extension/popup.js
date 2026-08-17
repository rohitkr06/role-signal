const packetInput = document.querySelector("#packet");
const status = document.querySelector("#status");
const job = document.querySelector("#job");
const capturedInput = document.querySelector("#captured");
const siteUrlInput = document.querySelector("#site-url");
const connectionKeyInput = document.querySelector("#connection-key");
const autopilotEnabledInput = document.querySelector("#autopilot-enabled");

document.querySelectorAll(".tabs button").forEach((button) => button.addEventListener("click", () => {
  document.querySelectorAll(".tabs button").forEach((item) => item.classList.toggle("active", item === button));
  document.querySelectorAll(".panel").forEach((panel) => panel.classList.toggle("active", panel.id === button.dataset.panel));
  status.className = "";
  status.textContent = button.dataset.panel === "discover"
    ? "Capture reads only visible job cards."
    : button.dataset.panel === "apply"
      ? "Verified answer-vault fields can be staged for a manual review."
      : "Only approved queue items run. CAPTCHA and unknown required fields always pause.";
}));

chrome.storage.local.get(["rolesignalPacket", "rolesignalCapture", "rolesignalSiteUrl", "rolesignalConnectionKey", "rolesignalAutopilotEnabled"]).then(({ rolesignalPacket, rolesignalCapture, rolesignalSiteUrl, rolesignalConnectionKey, rolesignalAutopilotEnabled }) => {
  if (rolesignalPacket) {
    packetInput.value = JSON.stringify(rolesignalPacket, null, 2);
    showJob(rolesignalPacket);
  }
  if (rolesignalCapture) capturedInput.value = JSON.stringify(rolesignalCapture, null, 2);
  if (rolesignalSiteUrl) siteUrlInput.value = rolesignalSiteUrl;
  if (rolesignalConnectionKey) connectionKeyInput.value = rolesignalConnectionKey;
  autopilotEnabledInput.checked = Boolean(rolesignalAutopilotEnabled);
});

packetInput.addEventListener("input", () => {
  try { showJob(JSON.parse(packetInput.value)); } catch { job.textContent = ""; }
});

document.querySelector("#stage").addEventListener("click", async () => {
  try {
    const packet = JSON.parse(packetInput.value);
    validatePacket(packet);
    await chrome.storage.local.set({ rolesignalPacket: packet });
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("Open the application page first.");
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    const result = await chrome.tabs.sendMessage(tab.id, { type: "ROLE_SIGNAL_STAGE", packet });
    const unknown = result.unknownRequired?.length || 0;
    status.className = unknown ? "warn" : "";
    status.textContent = unknown
      ? `Filled ${result.filled} fields. ${unknown} required field(s) need your input. Nothing was submitted.`
      : `Filled ${result.filled} supported fields. Review everything, then submit manually.`;
  } catch (error) {
    status.className = "warn";
    status.textContent = error instanceof Error ? error.message : "The packet could not be staged.";
  }
});

document.querySelector("#open").addEventListener("click", async () => {
  try {
    const packet = JSON.parse(packetInput.value);
    validatePacket(packet);
    await chrome.tabs.create({ url: packet.applicationUrl });
  } catch (error) {
    status.className = "warn";
    status.textContent = error instanceof Error ? error.message : "The application URL is unavailable.";
  }
});

document.querySelector("#capture").addEventListener("click", async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("Open a job-search results page first.");
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    const batch = await chrome.tabs.sendMessage(tab.id, { type: "ROLE_SIGNAL_CAPTURE" });
    if (batch?.error) throw new Error(batch.error);
    if (!batch?.jobs?.length) throw new Error("No visible job cards were found. Scroll the results into view and try again.");
    const text = JSON.stringify(batch, null, 2);
    capturedInput.value = text;
    await chrome.storage.local.set({ rolesignalCapture: batch });
    await navigator.clipboard.writeText(text);
    status.className = "";
    status.textContent = `Captured ${batch.jobs.length} visible ${batch.portal} jobs and copied the discovery batch.`;
  } catch (error) {
    status.className = "warn";
    status.textContent = error instanceof Error ? error.message : "Visible jobs could not be captured.";
  }
});

document.querySelector("#copy-capture").addEventListener("click", async () => {
  try {
    if (!capturedInput.value) throw new Error("Capture a results page first.");
    await navigator.clipboard.writeText(capturedInput.value);
    status.className = "";
    status.textContent = "Discovery batch copied. Paste it into RoleSignal Discovery.";
  } catch (error) {
    status.className = "warn";
    status.textContent = error instanceof Error ? error.message : "The discovery batch could not be copied.";
  }
});

document.querySelector("#save-autopilot").addEventListener("click", async () => {
  try {
    const siteUrl = new URL(siteUrlInput.value);
    if (siteUrl.protocol !== "https:" && siteUrl.hostname !== "localhost") throw new Error("Use the secure RoleSignal URL.");
    const key = connectionKeyInput.value.trim();
    if (!key.startsWith("rs_live_")) throw new Error("Paste a connection key generated in Phase 7.");
    await chrome.storage.local.set({
      rolesignalSiteUrl: siteUrl.origin,
      rolesignalConnectionKey: key,
      rolesignalAutopilotEnabled: autopilotEnabledInput.checked,
    });
    status.className = "";
    status.textContent = autopilotEnabledInput.checked ? "Connected. Approved applications will be checked once per minute." : "Connection saved. Autopilot remains paused.";
  } catch (error) {
    status.className = "warn";
    status.textContent = error instanceof Error ? error.message : "The connection could not be saved.";
  }
});

document.querySelector("#run-next").addEventListener("click", async () => {
  status.className = "";
  status.textContent = "Checking the approved execution queue...";
  const result = await chrome.runtime.sendMessage({ type: "ROLE_SIGNAL_RUN_NEXT" });
  status.className = result?.error ? "warn" : "";
  status.textContent = result?.error || result?.message || "Queue check finished.";
});

function validatePacket(packet) {
  if (!packet || packet.schemaVersion !== 1 || !packet.applicationUrl || !packet.allowedHost) {
    throw new Error("Paste a valid RoleSignal application packet.");
  }
  if (packet.blockers?.length) throw new Error("Resolve every NEEDS_INPUT item in RoleSignal before browser fill.");
  if (packet.schemaVersion === 1 && packet.policy?.neverSubmit !== true) throw new Error("This packet is missing the no-submit safety policy.");
}

function showJob(packet) {
  job.textContent = packet?.job ? `${packet.job.company} · ${packet.job.role} · ${packet.job.score}/100` : "";
}
