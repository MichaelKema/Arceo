async function refresh() {
  const state = await chrome.runtime.sendMessage({ op: "status" });
  document.querySelector("#status").textContent =
    state.error ||
    (state.connected
      ? state.domains.length
        ? `${state.domains.length} website rules are active.`
        : "Connected. Ready for your next focus session."
      : "Open Arceo and prepare browser protection in Settings.");
}
void refresh();
setInterval(refresh, 1000);
