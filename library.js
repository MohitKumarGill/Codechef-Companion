const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

let items = [];
let currentId = null;
let currentTab = "statement";
let currentLang = "cpp";
let solutionMap = { cpp: "", python: "", java: "", javascript: "" };

const LANGS = ["cpp", "python", "java", "javascript"];

function normalizeLang(str) {
  if (!str) return null;
  const s = String(str).toLowerCase();
  if (s.includes("cpp") || s.includes("c++") || s === "cc" || s === "cxx") return "cpp";
  if (s.includes("python") || s === "py") return "python";
  if (s.includes("java") && !s.includes("javascript")) return "java";
  if (s.includes("javascript") || s === "js" || s === "ts" || s.includes("typescript")) return "javascript";
  return LANGS.includes(s) ? s : null;
}

async function init() {
  try { await DB.syncMirror(); } catch {}
  await refresh();
  const params = new URLSearchParams(location.search);
  const idParam = params.get("id");
  if (idParam) select(Number(idParam));

  const stored = await chrome.storage.local.get("cc-active-tab");
  if (stored["cc-active-tab"]) setTab(stored["cc-active-tab"]);

  wire();
}

async function refresh() {
  items = await DB.all();
  items.sort((a, b) => b.updatedAt - a.updatedAt);
  renderList();
}

function renderList() {
  const q = ($("#search").value || "").toLowerCase().trim();
  const status = $("#filter-status").value;
  const list = $("#problem-list");
  list.innerHTML = "";

  const filtered = items.filter((p) => {
    if (status && p.status !== status) return false;
    if (!q) return true;
    const hay = [p.title, p.code, p.notes, p.statement, ...(p.tags || [])].join(" ").toLowerCase();
    return hay.includes(q);
  });

  if (!filtered.length) {
    list.innerHTML = `<li style="cursor:default;color:#94a3b8;font-style:italic;border:none">No problems.</li>`;
    return;
  }

  filtered.forEach((p) => {
    const li = document.createElement("li");
    if (p.id === currentId) li.classList.add("active");
    const tags = (p.tags || []).slice(0, 4).map((t) => `<span>${escapeHtml(t)}</span>`).join("");
    li.innerHTML = `
      <div class="row1">
        <span class="p-title"></span>
        <span class="badge ${p.status}"></span>
      </div>
      <div class="p-code"></div>
      <div class="tags">${tags}</div>
    `;
    li.querySelector(".p-title").textContent = p.title || "(untitled)";
    li.querySelector(".p-code").textContent = p.code || "";
    li.querySelector(".badge").textContent = p.status || "unsolved";
    li.onclick = () => select(p.id);
    list.appendChild(li);
  });
}

function select(id) {
  currentId = id;
  const p = items.find((x) => x.id === id);
  if (!p) return;
  $("#empty").hidden = true;
  $("#editor").hidden = false;

  $("#f-title").value = p.title || "";
  $("#f-code").value = p.code || "";
  $("#f-url").value = p.url || "";
  $("#f-status").value = p.status || "unsolved";
  $("#f-tags").value = (p.tags || []).join(", ");
  $("#f-statement").value = p.statement || "";
  $("#f-constraints").value = p.constraints || "";
  $("#f-input").value = p.inputFormat || "";
  $("#f-output").value = p.outputFormat || "";
  $("#f-notes").value = p.notes || "";

  solutionMap = { cpp: "", python: "", java: "", javascript: "" };
  if (p.solutions && typeof p.solutions === "object") {
    for (const l of LANGS) solutionMap[l] = p.solutions[l] || "";
  } else if (p.solution && p.language && LANGS.includes(normalizeLang(p.language) || p.language)) {
    const lang = normalizeLang(p.language) || p.language;
    solutionMap[lang] = p.solution;
  } else if (p.solution) {
    solutionMap.cpp = p.solution;
  }

  if (!solutionMap[currentLang] || !solutionMap[currentLang].trim()) {
    const filled = LANGS.find((l) => solutionMap[l] && solutionMap[l].trim());
    if (filled) currentLang = filled;
  }
  setLanguageTab(currentLang, { skipSave: true });

  renderSamples(p.samples || []);
  updateSavedAt(p);
  renderList();
}

function updateSavedAt(p) {
  $("#saved-at").textContent = p.updatedAt ? "Saved " + new Date(p.updatedAt).toLocaleString() : "";
}

function setLanguageTab(lang, opts = {}) {
  const currentBox = $("#f-solution");
  if (!opts.skipSave && currentBox) solutionMap[currentLang] = currentBox.value;

  currentLang = lang;
  $$(".lang-tab").forEach((b) => b.classList.toggle("active", b.dataset.lang === lang));
  if (currentBox) currentBox.value = solutionMap[lang] || "";
}

function renderSamples(samples) {
  const wrap = $("#samples-container");
  wrap.innerHTML = "";
  samples.forEach((s, i) => wrap.appendChild(sampleRow(s, i)));
}

function sampleRow(s, i) {
  const div = document.createElement("div");
  div.className = "sample";
  div.innerHTML = `
    <div class="sample-head">
      <strong>Sample ${i + 1}</strong>
      <button type="button" data-remove>Remove</button>
    </div>
    <div class="io">
      <div><label>Input</label><textarea data-k="input"></textarea></div>
      <div><label>Output</label><textarea data-k="output"></textarea></div>
    </div>
  `;
  div.querySelector("[data-k='input']").value = s.input || "";
  div.querySelector("[data-k='output']").value = s.output || "";
  div.querySelector("[data-remove]").onclick = () => { div.remove(); renumberSamples(); };
  return div;
}

function renumberSamples() {
  $$("#samples-container .sample").forEach((el, i) => {
    el.querySelector("strong").textContent = `Sample ${i + 1}`;
  });
}

function readSamples() {
  return Array.from($$("#samples-container .sample")).map((el) => ({
    input: el.querySelector("[data-k='input']").value,
    output: el.querySelector("[data-k='output']").value
  }));
}

function currentSolutions() {
  const box = $("#f-solution");
  if (box) solutionMap[currentLang] = box.value;
  return { ...solutionMap };
}

async function save() {
  const p = items.find((x) => x.id === currentId);
  if (!p) return;
  const sols = currentSolutions();
  const legacySolution = sols[currentLang] || sols.cpp || "";
  const updated = {
    ...p,
    title: $("#f-title").value.trim(),
    code: $("#f-code").value.trim(),
    url: $("#f-url").value.trim(),
    status: $("#f-status").value,
    tags: $("#f-tags").value.split(",").map((s) => s.trim()).filter(Boolean),
    statement: $("#f-statement").value,
    constraints: $("#f-constraints").value,
    inputFormat: $("#f-input").value,
    outputFormat: $("#f-output").value,
    notes: $("#f-notes").value,
    samples: readSamples(),
    solutions: sols,
    solution: legacySolution,
    language: currentLang
  };
  await DB.put(updated);
  const idx = items.findIndex((x) => x.id === currentId);
  items[idx] = updated;
  items.sort((a, b) => b.updatedAt - a.updatedAt);
  renderList();
  updateSavedAt(updated);
  toast("Saved.");
}

function downloadBundle() {
  const p = items.find((x) => x.id === currentId);
  if (!p) return;
  const sols = currentSolutions();
  const live = {
    ...p,
    title: $("#f-title").value.trim(),
    code: $("#f-code").value.trim(),
    url: $("#f-url").value.trim(),
    statement: $("#f-statement").value,
    constraints: $("#f-constraints").value,
    inputFormat: $("#f-input").value,
    outputFormat: $("#f-output").value,
    notes: $("#f-notes").value,
    samples: readSamples(),
    solutions: sols,
    solution: sols[currentLang] || "",
    language: currentLang
  };
  chrome.runtime.sendMessage({ type: "CC_DOWNLOAD_BUNDLE", problem: live });
  toast("Downloading bundle…");
}

function deleteCurrent() {
  if (!currentId) return;
  if (!confirm("Delete this problem? This cannot be undone.")) return;
  DB.delete(currentId).then(async () => {
    await refresh();
    currentId = null;
    $("#editor").hidden = true;
    $("#empty").hidden = false;
  });
}

async function newProblem() {
  const p = await DB.add({
    title: "Untitled problem", code: "", url: "", statement: "",
    constraints: "", inputFormat: "", outputFormat: "", samples: [],
    tags: [], notes: "", solution: "", language: "",
    solutions: { cpp: "", python: "", java: "", javascript: "" },
    status: "unsolved"
  });
  await refresh();
  select(p.id);
}

async function pasteToCodeChef() {
  const p = items.find((x) => x.id === currentId);
  if (!p) return;
  const sols = currentSolutions();

  let editorLang = null;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && /codechef\.com\/problems\//.test(tab.url || "")) {
      const probe = await chrome.tabs.sendMessage(tab.id, { type: "CC_PROBE_EDITOR_VIA_CONTENT" }).catch(() => null);
      if (probe && probe.language) editorLang = normalizeLang(probe.language) || probe.language;
    }
  } catch {}

  let code = editorLang && sols[editorLang] && sols[editorLang].trim() ? sols[editorLang] : "";
  if (!code) {
    for (const l of LANGS) { if (sols[l] && sols[l].trim()) { code = sols[l]; break; } }
  }
  if (!code.trim()) { toast("Write a solution first."); return; }

  const problemCode = $("#f-code").value.trim() || p.code;
  const url = $("#f-url").value.trim() || p.url;
  if (!url && !problemCode) { toast("Set the CodeChef URL or problem code first."); return; }

  const tabs = await chrome.tabs.query({ url: "https://www.codechef.com/problems/*" });
  let target = tabs.find((t) => problemCode && t.url && t.url.includes(`/problems/${problemCode}`)) || tabs[0];

  if (!target) {
    if (!url) { toast("Set the CodeChef URL first."); return; }
    target = await chrome.tabs.create({ url, active: true });
    await new Promise((r) => setTimeout(r, 3500));
  } else {
    await chrome.tabs.update(target.id, { active: true });
  }

  const results = await chrome.scripting.executeScript({
    target: { tabId: target.id, allFrames: true },
    world: "MAIN",
    func: (code) => {
      function findEditor() {
        if (window.monaco && window.monaco.editor) {
          const models = window.monaco.editor.getModels();
          if (models && models.length) return { kind: "monaco", model: models[0], api: window.monaco };
        }
        if (window.CodeMirror) {
          for (const n of document.querySelectorAll(".CodeMirror")) {
            if (n.CodeMirror) return { kind: "cm5", cm: n.CodeMirror };
          }
        }
        const cm6 = document.querySelector(".cm-editor");
        if (cm6) return { kind: "cm6", el: cm6 };
        const ta = document.querySelector("textarea.inputarea, textarea");
        if (ta) return { kind: "textarea", ta };
        return null;
      }
      const e = findEditor();
      if (!e) return { ok: false };
      try {
        if (e.kind === "monaco") {
          e.model.setValue(code);
          const eds = e.api.editor.getEditors();
          if (eds && eds[0]) {
            const lc = e.model.getLineCount();
            eds[0].setPosition({ lineNumber: lc, column: e.model.getLineMaxColumn(lc) });
            eds[0].focus();
          }
        } else if (e.kind === "cm5") { e.cm.setValue(code); e.cm.focus(); }
        else if (e.kind === "cm6") {
          e.el.focus(); document.execCommand("selectAll"); document.execCommand("insertText", false, code);
        } else if (e.kind === "textarea") {
          e.ta.focus(); e.ta.value = code;
          e.ta.dispatchEvent(new Event("input", { bubbles: true }));
          e.ta.dispatchEvent(new Event("change", { bubbles: true }));
        }
        return { ok: true, kind: e.kind };
      } catch (err) { return { ok: false, error: String(err.message || err) }; }
    },
    args: [code]
  }).catch((e) => [{ result: { ok: false, error: String(e.message || e) } }]);

  const winner = (results || []).find((r) => r && r.result && r.result.ok);
  if (winner) toast("Pasted into CodeChef (" + winner.result.kind + ")");
  else toast("Could not find the editor. Open the Submit page and retry.");
}

function setTab(name) {
  currentTab = name;
  chrome.storage.local.set({ "cc-active-tab": name });
  $$(".tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  $$(".tab-panel").forEach((p) => (p.hidden = p.dataset.panel !== name));
}

function wire() {
  $("#search").addEventListener("input", renderList);
  $("#filter-status").addEventListener("change", renderList);

  $("#save-btn").onclick = save;
  $("#download-btn").onclick = downloadBundle;
  $("#paste-btn").onclick = pasteToCodeChef;
  $("#paste-solution-btn").onclick = pasteToCodeChef;
  $("#delete-btn").onclick = deleteCurrent;
  $("#new-problem").onclick = newProblem;

  $("#open-url-btn").onclick = () => {
    const u = $("#f-url").value.trim();
    if (u) window.open(u, "_blank");
  };

  $("#add-sample").onclick = () => {
    const wrap = $("#samples-container");
    wrap.appendChild(sampleRow({ input: "", output: "" }, wrap.children.length));
  };

  $("#copy-solution").onclick = async () => {
    await navigator.clipboard.writeText($("#f-solution").value || "");
    toast("Solution copied.");
  };

  $$(".lang-tab").forEach((b) => {
    b.onclick = () => setLanguageTab(b.dataset.lang);
  });

  $("#f-solution").addEventListener("input", () => {
    solutionMap[currentLang] = $("#f-solution").value;
  });

  $$(".tabs button").forEach((b) => {
    b.onclick = () => setTab(b.dataset.tab);
  });

  [
    "#f-title", "#f-code", "#f-url", "#f-status", "#f-tags", "#f-statement",
    "#f-constraints", "#f-input", "#f-output", "#f-notes", "#f-solution"
  ].forEach((sel) => {
    const el = $(sel);
    if (el) el.addEventListener("blur", () => { if (currentId) save(); });
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function toast(msg) {
  const t = document.createElement("div");
  t.textContent = msg;
  Object.assign(t.style, {
    position: "fixed", bottom: "20px", right: "20px",
    background: "#111827", color: "#fff",
    padding: "10px 14px", borderRadius: "10px",
    fontSize: "13px", boxShadow: "0 6px 20px rgba(0,0,0,.25)",
    zIndex: 9999, opacity: 0, transition: "opacity .2s"
  });
  document.body.appendChild(t);
  requestAnimationFrame(() => (t.style.opacity = "1"));
  setTimeout(() => {
    t.style.opacity = "0";
    setTimeout(() => t.remove(), 200);
  }, 1800);
}

init();
