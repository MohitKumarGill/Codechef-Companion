importScripts("db.js");

// ---- Persistence bootstrap ----
async function bootstrapPersistence() {
  try { await DB.syncMirror(); } catch (e) { console.warn("[CC] bootstrap persistence failed", e); }
}
chrome.runtime.onInstalled.addListener(bootstrapPersistence);
chrome.runtime.onStartup.addListener(bootstrapPersistence);
bootstrapPersistence();

async function resolveTab(sender) {
  if (sender && sender.tab && sender.tab.id) return sender.tab;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

function normalizeLang(str) {
  if (!str) return null;
  const s = String(str).toLowerCase();
  if (s.includes("cpp") || s.includes("c++") || s === "cc" || s === "cxx") return "cpp";
  if (s.includes("python") || s === "py") return "python";
  if (s.includes("java") && !s.includes("javascript")) return "java";
  if (s.includes("javascript") || s === "js" || s === "ts" || s.includes("typescript")) return "javascript";
  return null;
}

// ---------- Context menus ----------
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "cc-copy-all",
    title: "Copy problem (all sections)",
    contexts: ["page"],
    documentUrlPatterns: ["https://www.codechef.com/problems/*"]
  });
  chrome.contextMenus.create({
    id: "cc-auto-paste",
    title: "Auto-paste best matching solution",
    contexts: ["page"],
    documentUrlPatterns: ["https://www.codechef.com/problems/*"]
  });
  chrome.contextMenus.create({
    id: "cc-open-library",
    title: "Open CodeChef Companion Library",
    contexts: ["action", "page"]
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "cc-copy-all" && tab?.id) {
    chrome.tabs.sendMessage(tab.id, { type: "CC_COPY_ALL" });
  } else if (info.menuItemId === "cc-auto-paste" && tab?.id) {
    chrome.tabs.sendMessage(tab.id, { type: "CC_AUTO_PASTE" });
  } else if (info.menuItemId === "cc-open-library") {
    chrome.tabs.create({ url: chrome.runtime.getURL("library.html") });
  }
});

// ---------- Message hub ----------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      switch (msg.type) {
        case "CC_SAVE_PROBLEM": {
          const existing = await DB.findByUrl(msg.problem.url);
          let record;
          if (existing) {
            record = await DB.put({
              ...existing,
              ...msg.problem,
              id: existing.id,
              solution: (msg.problem.solution && msg.problem.solution.trim()) ? msg.problem.solution : existing.solution,
              solutions: existing.solutions || msg.problem.solutions,
              language: msg.problem.language || existing.language,
              notes: existing.notes || msg.problem.notes || "",
              status: existing.status || msg.problem.status
            });
          } else {
            record = await DB.add(msg.problem);
          }
          sendResponse({ ok: true, record });
          break;
        }
        case "CC_LIST_PROBLEMS": {
          const items = await DB.all();
          items.sort((a, b) => b.updatedAt - a.updatedAt);
          sendResponse({ ok: true, items });
          break;
        }
        case "CC_GET_PROBLEM": {
          const item = await DB.get(msg.id);
          sendResponse({ ok: true, item });
          break;
        }
        case "CC_UPDATE_PROBLEM": { await DB.put(msg.problem); sendResponse({ ok: true }); break; }
        case "CC_DELETE_PROBLEM": { await DB.delete(msg.id); sendResponse({ ok: true }); break; }
        case "CC_GET_BY_URL": {
          const item = await DB.findByUrl(msg.url);
          sendResponse({ ok: true, item });
          break;
        }
        case "CC_OPEN_LIBRARY": {
          const url = chrome.runtime.getURL(
            msg.problemId ? `library.html?id=${msg.problemId}` : "library.html"
          );
          chrome.tabs.create({ url });
          sendResponse({ ok: true });
          break;
        }
        case "CC_DOWNLOAD_BUNDLE": { downloadBundle(msg.problem); sendResponse({ ok: true }); break; }
        case "CC_OPEN_URL": {
          if (!msg.url) { sendResponse({ ok: false, error: "no-url" }); break; }
          try {
            const u = new URL(msg.url);
            if (u.protocol !== "https:" && u.protocol !== "http:") {
              sendResponse({ ok: false, error: "bad-url" });
              break;
            }
            chrome.tabs.create({ url: msg.url, active: true });
            sendResponse({ ok: true });
          } catch {
            sendResponse({ ok: false, error: "bad-url" });
          }
          break;
        }
        case "CC_OPEN_SETTINGS": {
          chrome.runtime.openOptionsPage();
          sendResponse({ ok: true });
          break;
        }
        case "CC_BROADCAST_INJECT": {
          const tab = await resolveTab(sender);
          if (!tab || !tab.id) { sendResponse({ ok: false, error: "no-tab" }); break; }
          const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id, allFrames: true },
            world: "MAIN",
            func: injectIntoEditor,
            args: [msg.code]
          }).catch((e) => [{ result: { ok: false, error: String(e) } }]);
          const winner = (results || []).find((r) => r && r.result && r.result.ok);
          if (winner) {
            const r = winner.result;
            sendResponse({ ...r, language: normalizeLang(r.language) || r.language || null });
          } else {
            sendResponse({ ok: false, error: "No CodeChef editor found in any frame. Open the Submit page." });
          }
          break;
        }
        case "CC_PROBE_EDITOR_BROADCAST": {
          const tab = await resolveTab(sender);
          if (!tab || !tab.id) { sendResponse({ ok: false }); break; }
          const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id, allFrames: true },
            world: "MAIN",
            func: probeEditorInFrame
          }).catch(() => []);
          const winner = (results || []).find((r) => r && r.result && r.result.ok);
          if (winner) {
            const r = winner.result;
            sendResponse({ ...r, language: normalizeLang(r.language) || r.language || null });
          } else {
            sendResponse({ ok: false });
          }
          break;
        }
        default:
          sendResponse({ ok: false, error: "Unknown message: " + msg.type });
      }
    } catch (err) {
      console.error("[CC background]", err);
      sendResponse({ ok: false, error: String((err && err.message) || err) });
    }
  })();
  return true;
});

// ---------- Bundle builder ----------
function downloadBundle(problem) {
  const base = slugify(problem.code || problem.title || "problem");
  const md = renderMarkdown(problem);
  chrome.downloads.download({
    url: "data:text/markdown;charset=utf-8," + encodeURIComponent(md),
    filename: `${base}/problem.md`,
    conflictAction: "overwrite"
  });

  const samples = problem.samples || [];
  samples.forEach((s, i) => {
    chrome.downloads.download({
      url: "data:text/plain;charset=utf-8," + encodeURIComponent(s.input || ""),
      filename: `${base}/sample${i + 1}.in`,
      conflictAction: "overwrite"
    });
    chrome.downloads.download({
      url: "data:text/plain;charset=utf-8," + encodeURIComponent(s.output || ""),
      filename: `${base}/sample${i + 1}.out`,
      conflictAction: "overwrite"
    });
  });

  const solutions = problem.solutions || {};
  if (Object.keys(solutions).length) {
    for (const [lang, code] of Object.entries(solutions)) {
      if (!code || !code.trim()) continue;
      chrome.downloads.download({
        url: "data:text/plain;charset=utf-8," + encodeURIComponent(code),
        filename: `${base}/solution.${guessExt(lang)}`,
        conflictAction: "overwrite"
      });
    }
  } else {
    const ext = guessExt(problem.language);
    chrome.downloads.download({
      url: "data:text/plain;charset=utf-8," + encodeURIComponent(problem.solution || defaultTemplate(problem.language)),
      filename: `${base}/solution.${ext}`,
      conflictAction: "overwrite"
    });
  }
}

function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "problem";
}
function guessExt(lang = "") {
  const l = String(lang).toLowerCase();
  if (l.includes("python")) return "py";
  if (l.includes("javascript") || l === "js") return "js";
  if (l.includes("java")) return "java";
  if (l.includes("cpp") || l.includes("c++")) return "cpp";
  return "txt";
}
function defaultTemplate(lang = "") {
  const l = String(lang).toLowerCase();
  if (l.includes("python")) return "# Write your solution here\n";
  if (l.includes("javascript") || l === "js") return "// Write your solution here\n";
  if (l.includes("java")) return "public class Main {\n  public static void main(String[] args) {\n  }\n}\n";
  if (l.includes("cpp") || l.includes("c++"))
    return "#include <bits/stdc++.h>\nusing namespace std;\nint main(){ios::sync_with_stdio(false);cin.tie(nullptr);return 0;}\n";
  return "";
}
function renderMarkdown(p) {
  const parts = [];
  parts.push(`# ${p.title || p.code || "Problem"}`);
  if (p.code) parts.push(`**Code:** \`${p.code}\``);
  if (p.url) parts.push(`**URL:** ${p.url}`);
  if (p.difficulty) parts.push(`**Difficulty:** ${p.difficulty}`);
  if (p.tags && p.tags.length) parts.push(`**Tags:** ${p.tags.join(", ")}`);
  parts.push(`**Status:** ${p.status || "unsolved"}`);
  parts.push("\n## Statement\n");
  parts.push(p.statement || "_(not captured)_");
  if (p.constraints) parts.push("\n## Constraints\n\n```\n" + p.constraints + "\n```");
  if (p.inputFormat) parts.push("\n## Input\n\n" + p.inputFormat);
  if (p.outputFormat) parts.push("\n## Output\n\n" + p.outputFormat);
  if (p.samples && p.samples.length) {
    parts.push("\n## Samples\n");
    p.samples.forEach((s, i) => {
      parts.push(`### Sample ${i + 1}\n`);
      parts.push("**Input**\n```\n" + (s.input || "") + "\n```");
      parts.push("**Output**\n```\n" + (s.output || "") + "\n```");
    });
  }
  if (p.notes) parts.push("\n## Notes\n\n" + p.notes);
  const sols = p.solutions && typeof p.solutions === "object" ? p.solutions : {};
  if (Object.keys(sols).length) {
    for (const [lang, code] of Object.entries(sols)) {
      if (code && code.trim()) parts.push(`\n## Solution (${lang})\n\n\`\`\`${lang}\n${code}\n\`\`\``);
    }
  } else if (p.solution) {
    parts.push("\n## Solution\n\n```" + (p.language || "") + "\n" + p.solution + "\n```");
  }
  return parts.join("\n");
}

// ---------- Editor injection (also runs inside frames) ----------
function injectIntoEditor(code) {
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
  function detectLang(e) {
    try {
      if (e.kind === "monaco" && e.model && e.model.getLanguageId) {
        const id = e.model.getLanguageId();
        if (id) return id;
      }
      if (e.kind === "cm5" && e.cm && e.cm.getOption) {
        const mode = e.cm.getOption("mode");
        if (mode) return String(mode);
      }
      const sel = document.querySelector("select[name*='language' i], select[id*='language' i]");
      if (sel && sel.value) return sel.value;
    } catch {}
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
    return { ok: true, kind: e.kind, language: detectLang(e) };
  } catch (err) { return { ok: false, error: String(err.message || err) }; }
}

function probeEditorInFrame() {
  function findEditor() {
    if (window.monaco && window.monaco.editor) {
      const models = window.monaco.editor.getModels();
      if (models && models.length) return { kind: "monaco", model: models[0] };
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
  let lang = null;
  try {
    if (e.kind === "monaco" && e.model && e.model.getLanguageId) lang = e.model.getLanguageId();
    if (e.kind === "cm5" && e.cm && e.cm.getOption) lang = e.cm.getOption("mode");
    if (!lang) {
      const sel = document.querySelector("select[name*='language' i], select[id*='language' i]");
      if (sel && sel.value) lang = sel.value;
    }
    if (!lang) {
      const fileTabs = document.querySelectorAll("[class*='tab'], [class*='file']");
      for (const t of fileTabs) {
        const m = (t.innerText || "").match(/\.(cpp|cc|cxx|py|java|js|ts)\b/i);
        if (m) { lang = m[1]; break; }
      }
    }
  } catch {}
  return { ok: true, kind: e.kind, language: lang };
}

// ---------- Keyboard shortcuts ----------
chrome.commands.onCommand.addListener(async (command) => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id || !/codechef\.com\/problems\//.test(tab.url || "")) return;

    if (command === "paste-clipboard-to-editor") {
      chrome.tabs.sendMessage(tab.id, { type: "CC_PASTE_CLIPBOARD" }).catch(() => {});
    } else if (command === "auto-paste-best") {
      chrome.tabs.sendMessage(tab.id, { type: "CC_AUTO_PASTE" }).catch(() => {});
    } else if (command === "ask-chatgpt") {
      chrome.tabs.sendMessage(tab.id, { type: "CC_ASK_CHATGPT" }).catch(() => {});
    }
  } catch (e) {
    console.warn("[CC] shortcut failed:", e);
  }
});
