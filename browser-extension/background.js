import { blockedHost, sessionRules } from "./policy.js";

let port;
let domains = [];
let error = "Open Arceo and prepare browser protection in Settings.";
let connected = false;
let lease;
let retry;
let queue = Promise.resolve();
let installed = "";
async function guardTab(tab) {
  if (!tab.id || !blockedHost(tab.url, domains)) return;
  const current = await chrome.tabs.get(tab.id).catch(() => null);
  if (!current || current.url !== tab.url) return;
  const host = blockedHost(current.url, domains);
  if (host)
    await chrome.tabs
      .update(tab.id, {
        url: chrome.runtime.getURL(
          `blocked.html?host=${encodeURIComponent(host)}`,
        ),
      })
      .catch(() => {});
}
async function apply(policy) {
  const active =
    policy.expires_at > Date.now() && !policy.error ? policy.domains : [];
  const rules = sessionRules(active);
  const signature = JSON.stringify(active);
  if (signature !== installed) {
    const previous = await chrome.declarativeNetRequest.getSessionRules();
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: previous.map((r) => r.id),
      addRules: rules,
    });
    installed = signature;
    domains = active;
    await Promise.all((await chrome.tabs.query({})).map(guardTab));
  }
  error = policy.error || null;
}
function update(policy) {
  queue = queue
    .then(() => apply(policy))
    .then(() => {
      if (port && connected)
        port.postMessage({ op: "applied", count: domains.length, error });
    })
    .catch((reason) => {
      error = String(reason.message || reason);
      if (port) port.postMessage({ op: "applied", count: 0, error });
    });
}
function connect() {
  if (port) return;
  clearTimeout(retry);
  const current = chrome.runtime.connectNative("app.arceo.browser");
  port = current;
  current.onMessage.addListener((policy) => {
    if (policy.type !== "policy" || !Array.isArray(policy.domains)) return;
    connected = true;
    clearTimeout(lease);
    lease = setTimeout(() => {
      connected = false;
      update({
        domains: [],
        expires_at: 0,
        error: "Arceo disconnected. Open the desktop app to reconnect.",
      });
    }, 5000);
    update(policy);
  });
  current.onDisconnect.addListener(() => {
    void chrome.runtime.lastError;
    if (port !== current) return;
    port = null;
    connected = false;
    clearTimeout(lease);
    update({
      domains: [],
      expires_at: 0,
      error:
        "Arceo is disconnected. Prepare browser protection in the desktop app's Settings.",
    });
    retry = setTimeout(connect, 5000);
  });
  current.postMessage({ op: "hello" });
}
chrome.tabs.onUpdated.addListener((_id, change, tab) => {
  if (change.url || change.status === "complete") void guardTab(tab);
});
chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  if (message.op === "status") reply({ connected, domains, error });
});
chrome.runtime.onStartup.addListener(connect);
chrome.runtime.onInstalled.addListener(connect);
// Session rules cannot outlive a browser restart; also clear any rules left by
// a prior worker before the local host supplies a fresh, short-lived policy.
update({ domains: [], expires_at: 0, error });
connect();
