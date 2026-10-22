const $ = (s) => document.querySelector(s);
const status = $("#status");

function flash(msg) {
  status.textContent = msg;
  status.classList.add("show");
  clearTimeout(flash._t);
  flash._t = setTimeout(() => status.classList.remove("show"), 2200);
}

async function loadSettings() {
  const stored = await chrome.storage.local.get("cc-settings");
  const s = stored["cc-settings"] || {};
  $("#useAPI").checked = !!s.useAPI;
  $("#apiKey").value = s.apiKey || "";
  $("#model").value = s.model || "gpt-4o-mini";
  toggleApiPanel();
}

function toggleApiPanel() {
  $("#api-settings").hidden = !$("#useAPI").checked;
}

async function saveSettings() {
  const s = {
    useAPI: $("#useAPI").checked,
    apiKey: $("#apiKey").value.trim(),
    model: $("#model").value
  };
  await chrome.storage.local.set({ "cc-settings": s });
}

$("#useAPI").addEventListener("change", async () => {
  toggleApiPanel();
  await saveSettings();
  flash("Saved");
});
$("#apiKey").addEventListener("blur", async () => { await saveSettings(); flash("Saved"); });
$("#model").addEventListener("change", async () => { await saveSettings(); flash("Saved"); });

$("#reset-pos").onclick = async () => {
  const tabs = await chrome.tabs.query({ url: "https://www.codechef.com/*" });
  for (const t of tabs) {
    chrome.tabs.sendMessage(t.id, { type: "CC_RESET_POSITION" }).catch(() => {});
  }
  await chrome.storage.local.remove("cc-toolbar-pos");
  flash("Toolbar position reset");
};

$("#wipe-mirror").onclick = async () => {
  if (!confirm("Clear the chrome.storage.local mirror? IndexedDB is kept, so your data is safe.")) return;
  await chrome.storage.local.remove("cc-problems-mirror");
  flash("Mirror cleared");
};

$("#wipe-all").onclick = async () => {
  if (!confirm("Delete ALL saved problems and settings? This cannot be undone.")) return;
  await chrome.storage.local.clear();
  const req = indexedDB.deleteDatabase("codechef-companion");
  req.onsuccess = () => flash("All data deleted");
  req.onerror = () => flash("Could not delete database");
};

loadSettings();
