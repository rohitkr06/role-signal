const DEFAULT_SITE = "https://rolesignal-rohit.rohitk61299.chatgpt.site";
let running = false;

chrome.runtime.onInstalled.addListener(() => chrome.alarms.create("rolesignal-execution", { periodInMinutes: 1 }));
chrome.runtime.onStartup.addListener(() => chrome.alarms.create("rolesignal-execution", { periodInMinutes: 1 }));
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "rolesignal-execution") void processQueue();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "ROLE_SIGNAL_RUN_NEXT") {
    processQueue(true).then(sendResponse).catch((error) => sendResponse({ error: error.message }));
    return true;
  }
  if (message?.type === "ROLE_SIGNAL_FETCH_RESUME") {
    fetchResume(message.path).then(sendResponse).catch((error) => sendResponse({ error: error.message }));
    return true;
  }
});

async function processQueue(force = false) {
  if (running) return { message: "An application is already running." };
  const settings = await chrome.storage.local.get(["rolesignalSiteUrl", "rolesignalConnectionKey", "rolesignalAutopilotEnabled"]);
  if (!force && !settings.rolesignalAutopilotEnabled) return { message: "Autopilot is paused." };
  if (!settings.rolesignalConnectionKey) return { error: "Add the Phase 7 connection key first." };
  running = true;
  let execution;
  try {
    const claimed = await api("/api/rolesignal/companion/claim", { method: "POST" }, settings);
    execution = claimed.execution;
    if (!execution) return { message: claimed.message || "No approved applications are waiting." };
    const tab = await chrome.tabs.create({ url: execution.applicationUrl, active: false });
    await waitForTab(tab.id);
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    const result = await chrome.tabs.sendMessage(tab.id, { type: "ROLE_SIGNAL_EXECUTE", packet: execution });
    if (result?.error) throw new Error(result.error);
    await api("/api/rolesignal/companion/report", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ executionId: execution.executionId, ...result }),
    }, settings);
    return { message: result.submissionConfirmed ? "Application submitted and confirmed." : result.unknownRequired?.length ? "Application paused for input." : "Application fields completed.", result };
  } catch (error) {
    if (execution?.executionId) {
      try {
        await api("/api/rolesignal/companion/report", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ executionId: execution.executionId, outcome: "FAILED", error: error.message }),
        }, settings);
      } catch {}
    }
    return { error: error.message };
  } finally {
    running = false;
  }
}

async function fetchResume(path) {
  const settings = await chrome.storage.local.get(["rolesignalSiteUrl", "rolesignalConnectionKey"]);
  const response = await fetch(new URL(path, settings.rolesignalSiteUrl || DEFAULT_SITE), {
    headers: { authorization: `Bearer ${settings.rolesignalConnectionKey || ""}` },
  });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || "Resume download failed.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return { base64: btoa(binary), type: response.headers.get("content-type") || "application/pdf" };
}

async function api(path, options, settings) {
  const response = await fetch(new URL(path, settings.rolesignalSiteUrl || DEFAULT_SITE), {
    ...options,
    headers: { ...(options.headers || {}), authorization: `Bearer ${settings.rolesignalConnectionKey || ""}` },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `RoleSignal returned ${response.status}.`);
  return payload;
}

function waitForTab(tabId) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); reject(new Error("The application page did not finish loading.")); }, 45000);
    function listener(changedId, info) {
      if (changedId !== tabId || info.status !== "complete") return;
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(listener);
      setTimeout(resolve, 1200);
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}
