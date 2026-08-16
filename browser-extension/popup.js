const packetInput = document.querySelector("#packet");
const status = document.querySelector("#status");
const job = document.querySelector("#job");

chrome.storage.local.get("rolesignalPacket").then(({ rolesignalPacket }) => {
  if (!rolesignalPacket) return;
  packetInput.value = JSON.stringify(rolesignalPacket, null, 2);
  showJob(rolesignalPacket);
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

function validatePacket(packet) {
  if (!packet || packet.schemaVersion !== 1 || !packet.applicationUrl || !packet.allowedHost) {
    throw new Error("Paste a valid RoleSignal application packet.");
  }
  if (packet.blockers?.length) throw new Error("Resolve every NEEDS_INPUT item in RoleSignal before browser fill.");
  if (packet.policy?.neverSubmit !== true) throw new Error("This packet is missing the no-submit safety policy.");
}

function showJob(packet) {
  job.textContent = packet?.job ? `${packet.job.company} · ${packet.job.role} · ${packet.job.score}/100` : "";
}
