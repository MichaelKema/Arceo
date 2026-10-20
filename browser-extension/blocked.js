import { blockedHost } from "./policy.js";
const host = new URLSearchParams(location.search).get("host") || "";
const link = document.querySelector("#retry");
if (/^[a-z0-9.-]+\.[a-z0-9-]+$/.test(host)) link.href = `https://${host}/`;
async function refresh() {
  const state = await chrome.runtime.sendMessage({ op: "status" });
  document.querySelector("#message").textContent = blockedHost(
    `https://${host}`,
    state.domains,
  )
    ? `${host} is in an active block list. Come back when your focus timer or schedule ends.`
    : "Your block has ended. You can return to the website.";
}
void refresh();
setInterval(refresh, 1000);
