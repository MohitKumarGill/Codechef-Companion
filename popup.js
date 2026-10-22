const $ = (s) => document.querySelector(s);
const status = $("#status");

function flash(msg, isError = false) {
  status.textContent = msg;
  status.style.color = isError ? "#dc2626" : "#059669";
  clearTimeout(flash._t);
  flash._t = setTimeout(() => (status.textContent = ""), 2400);
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function requireProblemPage() {
  const tab = await activeTab();
  if (!tab || !/codechef\.com\/problems\//.test(tab.url || "")) {
    throw new Error("Open a CodeChef problem page first.");
  }
  return tab;
}

async function sendToTab(msg) {
  const tab = await requireProblemPage();
  try { return await chrome.tabs.sendMessage(tab.id, msg); }
  catch (e) { throw new Error("Reload the CodeChef page so the content script loads."); }
}

$("#ask-chatgpt").onclick = async () => {
  try {
    const r = await sendToTab({ type: "CC_ASK_CHATGPT" });
    if (r && r.ok === false) throw new Error(r.error || "Failed");
    if (r.mode === "web") flash("Opened ChatGPT — press Enter there.");
    else flash(`AI solution pasted (${r.model}).`);
  } catch (e) { flash(e.message, true); }
};

$("#paste-clipboard").onclick = async () => {
  try {
    const r = await sendToTab({ type: "CC_PASTE_CLIPBOARD" });
    if (r && r.ok === false) throw new Error(r.error || "Paste failed");
    flash(`Pasted clipboard (${r.kind || "editor"}).`);
  } catch (e) { flash(e.message, true); }
};

$("#search-github").onclick = async () => {
  try {
    const r = await sendToTab({ type: "CC_SEARCH_GITHUB" });
    if (r && r.ok === false) throw new Error(r.error || "Failed");
    flash("Opened GitHub search.");
  } catch (e) { flash(e.message, true); }
};

$("#copy-all").onclick = async () => {
  try {
    const r = await sendToTab({ type: "CC_COPY_ALL" });
    if (r && r.ok === false) throw new Error(r.error || "Copy failed");
    flash("Copied to clipboard.");
  } catch (e) { flash(e.message, true); }
};

$("#save").onclick = async () => {
  try {
    const r = await sendToTab({ type: "CC_SCRAPE_NOW" });
    if (!r || !r.problem) throw new Error("Could not scrape page.");
    const res = await chrome.runtime.sendMessage({ type: "CC_SAVE_PROBLEM", problem: r.problem });
    if (res.ok) { flash(`Saved (#${res.record.id}).`); renderRecent(); }
    else flash("Save failed: " + res.error, true);
  } catch (e) { flash(e.message, true); }
};

$("#download").onclick = async () => {
  try { await sendToTab({ type: "CC_TRIGGER_DOWNLOAD" }); flash("Downloading bundle…"); }
  catch (e) { flash(e.message, true); }
};

$("#paste").onclick = async () => {
  try {
    const tab = await requireProblemPage();
    const res = await chrome.runtime.sendMessage({ type: "CC_GET_BY_URL", url: tab.url.split("#")[0].split("?")[0] });
    if (!res.item || !res.item.solution || !res.item.solution.trim()) {
      throw new Error("No saved solution for this problem.");
    }
    const inj = await chrome.runtime.sendMessage({ type: "CC_BROADCAST_INJECT", code: res.item.solution });
    if (inj.ok) flash(`Pasted (${inj.kind}).`);
    else flash(inj.error || "Paste failed", true);
  } catch (e) { flash(e.message, true); }
};

$("#open-library").onclick = () => {
  chrome.runtime.sendMessage({ type: "CC_OPEN_LIBRARY" });
  window.close();
};

$("#open-settings").onclick = (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
  window.close();
};

async function renderRecent() {
  const list = $("#recent-list");
  const res = await chrome.runtime.sendMessage({ type: "CC_LIST_PROBLEMS" });
  if (!res.ok || !res.items.length) return;
  list.innerHTML = "";
  res.items.slice(0, 6).forEach((p) => {
    const li = document.createElement("li");
    li.innerHTML = `<span class="title"></span><span class="badge"></span>`;
    li.querySelector(".title").textContent = p.title || p.code || "(untitled)";
    li.querySelector(".badge").textContent = p.status || "unsolved";
    li.onclick = () => {
      chrome.runtime.sendMessage({ type: "CC_OPEN_LIBRARY", problemId: p.id });
      window.close();
    };
    list.appendChild(li);
  });
}

renderRecent();
