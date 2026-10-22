// content.js — floating toolbar + scraper + auto-paste + web search + ChatGPT
(function () {
  const IS_PROBLEM_PAGE = /\/problems\/[A-Za-z0-9_]+/.test(location.pathname);
  if (!IS_PROBLEM_PAGE) return;
  if (document.querySelector(".cc-toolbar")) return;

  const POS_KEY = "cc-toolbar-pos";
  const LANGS = ["cpp", "python", "java", "javascript"];

  // ---------- Scraper ----------
  function pick(selectors, root = document) {
    for (const sel of selectors) {
      const el = root.querySelector(sel);
      if (el && el.innerText && el.innerText.trim().length) return el.innerText.trim();
    }
    return "";
  }

  function sliceByHeadings(text) {
    const lines = text.split("\n");
    let mode = "statement";
    const buckets = { statement: [], input: [], output: [], constraints: [], notes: [], skipped: [] };
    const notesRe = /^(sample|example|explanation|author|difficulty|tags?|source|time limit|memory limit)\b/i;
    for (const line of lines) {
      const t = line.trim().toLowerCase();
      if (/^(input|input format)\b/.test(t)) { mode = "input"; continue; }
      if (/^(output|output format)\b/.test(t)) { mode = "output"; continue; }
      if (/^constraints\b/.test(t)) { mode = "constraints"; continue; }
      if (/^notes?\b/.test(t)) { mode = "notes"; continue; }
      if (notesRe.test(t)) { mode = "skipped"; continue; }
      buckets[mode].push(line);
    }
    return {
      statement: buckets.statement.join("\n").trim(),
      input: buckets.input.join("\n").trim(),
      output: buckets.output.join("\n").trim(),
      constraints: buckets.constraints.join("\n").trim(),
      notes: buckets.notes.join("\n").trim()
    };
  }

  function extractSamples(container) {
    const samples = [];
    const pres = Array.from(container.querySelectorAll("pre"));
    for (let i = 0; i < pres.length; i++) {
      const prev = pres[i].previousElementSibling;
      const label = ((prev && prev.innerText) || "").toLowerCase();
      if (label.includes("input")) {
        const next = pres[i + 1];
        samples.push({ input: pres[i].innerText.trim(), output: next ? next.innerText.trim() : "" });
        i++;
      }
    }
    if (samples.length) return samples;
    for (let i = 0; i < pres.length - 1; i += 2) {
      samples.push({ input: pres[i].innerText.trim(), output: pres[i + 1].innerText.trim() });
    }
    return samples;
  }

  function scrapeProblem() {
    const codeMatch = location.pathname.match(/\/problems\/([A-Za-z0-9_]+)/);
    const code = codeMatch ? codeMatch[1] : "";
    const title =
      pick(["h1", ".problem-statement h1", "[class*='ProblemTitle']", "[class*='_title']"]) ||
      code || document.title;
    const container =
      document.querySelector(".problem-statement") ||
      document.querySelector("[class*='problem-statement']") ||
      document.querySelector("[class*='ProblemStatement']") ||
      document.body;
    const sliced = sliceByHeadings(container.innerText || "");
    const difficulty = pick(["[class*='difficulty']", "[class*='Difficulty']"]);
    const tagEls = document.querySelectorAll("[class*='tag'] a, a[href*='/tags/'], [class*='Tag']");
    const tags = Array.from(tagEls)
      .map((e) => e.innerText.trim()).filter(Boolean)
      .filter((v, i, a) => a.indexOf(v) === i).slice(0, 20);
    return {
      title, code,
      url: location.href.split("#")[0].split("?")[0],
      difficulty, tags,
      statement: sliced.statement,
      inputFormat: sliced.input,
      outputFormat: sliced.output,
      constraints: sliced.constraints,
      samples: extractSamples(container),
      notes: "", solution: "", language: "", status: "unsolved"
    };
  }

  function renderAll(p) {
    const out = [];
    out.push(`# ${p.title} (${p.code})`);
    out.push(p.url);
    if (p.difficulty) out.push(`Difficulty: ${p.difficulty}`);
    if (p.tags && p.tags.length) out.push(`Tags: ${p.tags.join(", ")}`);
    out.push("", "## Statement", p.statement);
    if (p.inputFormat) out.push("\n## Input", p.inputFormat);
    if (p.outputFormat) out.push("\n## Output", p.outputFormat);
    if (p.constraints) out.push("\n## Constraints", p.constraints);
    if (p.samples && p.samples.length) {
      out.push("\n## Samples");
      p.samples.forEach((s, i) => {
        out.push(`\nSample ${i + 1} Input:\n${s.input}`);
        out.push(`Sample ${i + 1} Output:\n${s.output}`);
      });
    }
    return out.join("\n");
  }

  async function pasteCodeIntoEditor(code) {
    try {
      const res = await chrome.runtime.sendMessage({ type: "CC_BROADCAST_INJECT", code });
      if (res && res.ok) return res;
      return res || { ok: false, error: "Inject failed." };
    } catch (e) {
      return { ok: false, error: String(e.message || e) };
    }
  }

  function normalizeLang(str) {
    if (!str) return null;
    const s = String(str).toLowerCase();
    if (s.includes("cpp") || s.includes("c++") || s === "cc" || s === "cxx") return "cpp";
    if (s.includes("python") || s === "py") return "python";
    if (s.includes("java") && !s.includes("javascript")) return "java";
    if (s.includes("javascript") || s === "js" || s === "ts" || s.includes("typescript")) return "javascript";
    return LANGS.includes(s) ? s : null;
  }

  async function probeEditorLanguage() {
    try {
      const res = await chrome.runtime.sendMessage({ type: "CC_PROBE_EDITOR_BROADCAST" });
      if (res && res.ok) return normalizeLang(res.language) || res.language || null;
    } catch {}
    return null;
  }

  async function readClipboard() {
    try { return await navigator.clipboard.readText(); }
    catch (e) { throw new Error("Clipboard read blocked. Click the page once, then retry."); }
  }

  async function autoPasteBest() {
    const p = scrapeProblem();
    const editorLang = await probeEditorLanguage();
    let lookup = null;
    try { lookup = await chrome.runtime.sendMessage({ type: "CC_GET_BY_URL", url: p.url }); } catch {}

    const saved = lookup && lookup.item;
    let chosenCode = null;
    let reason = "";

    if (saved) {
      const map = saved.solutions && typeof saved.solutions === "object" ? saved.solutions : {};
      if (editorLang && map[editorLang] && map[editorLang].trim()) {
        chosenCode = map[editorLang]; reason = `saved ${editorLang} solution`;
      }
      if (!chosenCode && editorLang && saved.language === editorLang && saved.solution && saved.solution.trim()) {
        chosenCode = saved.solution; reason = `saved ${editorLang} solution (legacy)`;
      }
      if (!chosenCode && saved.status === "solved" && saved.solution && saved.solution.trim()) {
        chosenCode = saved.solution; reason = `saved solution (${saved.language || "any"})`;
      }
      if (!chosenCode) {
        const filled = LANGS.find((l) => map[l] && String(map[l]).trim());
        if (filled) {
          chosenCode = map[filled];
          reason = `saved ${filled} solution (any language)`;
        }
      }
      if (!chosenCode && saved.solution && saved.solution.trim()) {
        chosenCode = saved.solution; reason = "saved solution (fallback)";
      }
    }

    if (!chosenCode) {
      try {
        const clip = await readClipboard();
        if (clip && clip.trim()) { chosenCode = clip; reason = "clipboard"; }
      } catch {}
    }

    if (!chosenCode) {
      throw new Error(
        "Nothing local to paste. Try 🤖 Ask ChatGPT, or 🔍 Search GitHub."
      );
    }

    const inj = await pasteCodeIntoEditor(chosenCode);
    if (!inj.ok) throw new Error(inj.error || "Inject failed.");
    return { ok: true, kind: inj.kind, language: normalizeLang(inj.language) || inj.language || editorLang, reason };
  }

  // ---------- Web search helpers ----------
  function normalizeLangForGitHub(lang) {
    if (!lang) return "";
    const l = String(lang).toLowerCase();
    if (l.includes("cpp") || l.includes("c++")) return "cpp";
    if (l.includes("python")) return "python";
    if (l.includes("java")) return "java";
    if (l.includes("javascript") || l === "js") return "javascript";
    return "";
  }

  async function getSearchContext() {
    const p = scrapeProblem();
    const editorLang = await probeEditorLanguage();
    return { problem: p, language: editorLang };
  }

  function openTab(url) {
    try { chrome.runtime.sendMessage({ type: "CC_OPEN_URL", url }); }
    catch { window.open(url, "_blank"); }
  }

  async function searchGitHub() {
    const { problem, language } = await getSearchContext();
    if (!problem.code) throw new Error("No problem code found in URL.");
    const ghLang = normalizeLangForGitHub(language);
    const q = ["codechef", problem.code, ghLang ? `language:${ghLang}` : ""].filter(Boolean).join(" ");
    const url = "https://github.com/search?type=code&q=" + encodeURIComponent(q);
    openTab(url);
    return { ok: true, url };
  }

  async function searchAll() {
    const { problem } = await getSearchContext();
    if (!problem.code) throw new Error("No problem code found in URL.");
    const q = `${problem.code} codechef solution (site:github.com OR site:discuss.codechef.com OR site:codereview.stackexchange.com OR site:gist.github.com)`;
    const url = "https://www.google.com/search?q=" + encodeURIComponent(q);
    openTab(url);
    return { ok: true, url };
  }

  async function searchDiscuss() {
    const { problem } = await getSearchContext();
    if (!problem.code) throw new Error("No problem code found in URL.");
    const url = "https://discuss.codechef.com/search?q=" + encodeURIComponent(problem.code);
    openTab(url);
    return { ok: true, url };
  }

  // ---------- ChatGPT integration ----------
  function languageForPrompt(lang) {
    if (!lang) return "C++";
    const l = String(lang).toLowerCase();
    if (l.includes("python")) return "Python";
    if (l.includes("java")) return "Java";
    if (l.includes("javascript")) return "JavaScript";
    return "C++";
  }

  function buildChatGPTPrompt(problem, language, maxStatement) {
    const lang = languageForPrompt(language);
    let statement = problem.statement || "(not captured)";
    if (maxStatement && statement.length > maxStatement) {
      statement = statement.slice(0, maxStatement) + "\n…(truncated)";
    }
    const samples = (problem.samples || [])
      .map((s, i) =>
        `Sample ${i + 1}:\nInput:\n${s.input}\nOutput:\n${s.output}`
      )
      .join("\n\n");

    return [
      `Solve this CodeChef problem in ${lang}. Give me the complete, compilable source code that reads from stdin and writes to stdout — nothing else, no explanation.`,
      ``,
      `Problem: ${problem.title} (${problem.code})`,
      `URL: ${problem.url}`,
      ``,
      `Statement:`,
      statement,
      problem.constraints ? `\nConstraints:\n${problem.constraints}` : "",
      problem.inputFormat ? `\nInput format:\n${problem.inputFormat}` : "",
      problem.outputFormat ? `\nOutput format:\n${problem.outputFormat}` : "",
      samples ? `\nSamples:\n${samples}` : "",
      ``,
      `Return ONLY the final ${lang} code in a single fenced code block. No prose before or after.`
    ].filter(Boolean).join("\n");
  }

  function extractCode(text) {
    if (!text) return "";
    const m = text.match(/```(?:[a-zA-Z0-9+#]+)?\s*\n([\s\S]*?)```/);
    if (m) return m[1].trim();
    return text.trim();
  }

  async function askChatGPT() {
    const p = scrapeProblem();
    if (!p.statement || p.statement.length < 40) {
      throw new Error("Could not scrape a statement from this page. Scroll to load it, then retry.");
    }
    const lang = await probeEditorLanguage();

    let settings = {};
    try { settings = await chrome.storage.local.get("cc-settings"); } catch {}
    const s = settings["cc-settings"] || {};

    if (s.useAPI && s.apiKey) {
      const prompt = buildChatGPTPrompt(p, lang);
      const model = s.model || "gpt-4o-mini";
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + s.apiKey
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: "You are an expert competitive programmer. Reply only with code inside a single fenced block." },
            { role: "user", content: prompt }
          ],
          temperature: 0.2
        })
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`OpenAI ${res.status}: ${txt.slice(0, 200)}`);
      }
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content || "";
      const code = extractCode(content);
      if (!code) throw new Error("No code block found in ChatGPT's reply.");
      const inj = await pasteCodeIntoEditor(code);
      if (!inj.ok) throw new Error(inj.error || "Inject failed.");
      return { ok: true, mode: "api", kind: inj.kind, model };
    }

    const prompt = buildChatGPTPrompt(p, lang, 2500);
    const url = "https://chatgpt.com/?q=" + encodeURIComponent(prompt);
    openTab(url);
    return { ok: true, mode: "web", url };
  }

  // ---------- Draggable toolbar ----------
  function applyPosition(bar, pos) {
    if (!pos || typeof pos.left !== "number" || typeof pos.top !== "number") return;
    const w = bar.offsetWidth || 240;
    const h = bar.offsetHeight || 320;
    const maxLeft = Math.max(0, window.innerWidth - w);
    const maxTop = Math.max(0, window.innerHeight - h);
    bar.style.left = Math.min(Math.max(0, pos.left), maxLeft) + "px";
    bar.style.top = Math.min(Math.max(0, pos.top), maxTop) + "px";
    bar.style.right = "auto";
    bar.style.bottom = "auto";
  }

  function getSavedPosition() {
    return new Promise((resolve) => {
      try { chrome.storage.local.get(POS_KEY, (got) => resolve(got && got[POS_KEY] ? got[POS_KEY] : null)); }
      catch { resolve(null); }
    });
  }
  function savePosition(pos) {
    try { chrome.storage.local.set({ [POS_KEY]: pos }); } catch {}
  }

  function makeDraggable(bar, handle) {
    let startX = 0, startY = 0, startLeft = 0, startTop = 0;
    let dragging = false, moved = false;

    handle.addEventListener("pointerdown", (e) => {
      if (e.target.closest(".cc-close")) return;
      if (e.button !== 0 && e.pointerType === "mouse") return;
      const rect = bar.getBoundingClientRect();
      startX = e.clientX; startY = e.clientY;
      startLeft = rect.left; startTop = rect.top;
      dragging = true; moved = false;
      handle.setPointerCapture(e.pointerId);
      handle.classList.add("dragging");
      bar.style.transition = "none";
      e.preventDefault();
    });

    handle.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
      const w = bar.offsetWidth || 240;
      const h = bar.offsetHeight || 320;
      const maxLeft = Math.max(0, window.innerWidth - w);
      const maxTop = Math.max(0, window.innerHeight - h);
      const left = Math.min(Math.max(0, startLeft + dx), maxLeft);
      const top = Math.min(Math.max(0, startTop + dy), maxTop);
      bar.style.left = left + "px";
      bar.style.top = top + "px";
      bar.style.right = "auto";
      bar.style.bottom = "auto";
    });

    function endDrag(e) {
      if (!dragging) return;
      dragging = false;
      handle.classList.remove("dragging");
      if (handle.hasPointerCapture && handle.hasPointerCapture(e.pointerId)) {
        try { handle.releasePointerCapture(e.pointerId); } catch {}
      }
      bar.style.transition = "";
      if (moved) {
        const rect = bar.getBoundingClientRect();
        savePosition({ left: rect.left, top: rect.top });
      }
    }
    handle.addEventListener("pointerup", endDrag);
    handle.addEventListener("pointercancel", endDrag);

    window.addEventListener("resize", () => {
      const rect = bar.getBoundingClientRect();
      const w = bar.offsetWidth || 240;
      const h = bar.offsetHeight || 320;
      const left = Math.min(Math.max(0, rect.left), Math.max(0, window.innerWidth - w));
      const top = Math.min(Math.max(0, rect.top), Math.max(0, window.innerHeight - h));
      bar.style.left = left + "px";
      bar.style.top = top + "px";
      bar.style.right = "auto";
      bar.style.bottom = "auto";
      savePosition({ left, top });
    });
  }

  // ---------- UI ----------
  function buildToolbar() {
    const bar = document.createElement("div");
    bar.className = "cc-toolbar";
    bar.innerHTML = `
      <div class="cc-bar-head">
        <span class="cc-drag-hint" aria-hidden="true">⋮⋮</span>
        <span class="cc-logo">CC</span>
        <span class="cc-title">Companion</span>
        <button class="cc-close" title="Hide">×</button>
      </div>
      <div class="cc-body">
        <button data-cc="ask-chatgpt" class="cc-gpt">🤖 Ask ChatGPT</button>
        <button data-cc="auto-paste" class="cc-auto">⚡ Auto-paste (my solutions)</button>
        <button data-cc="paste-clipboard" class="cc-paste">📋 Paste clipboard → editor</button>

        <div class="cc-section-title">Find a solution online</div>
        <button data-cc="search-github">🔍 Search GitHub</button>
        <button data-cc="search-all">🔎 Search all sites</button>
        <button data-cc="search-discuss">📚 CodeChef Discuss</button>

        <div class="cc-section-title">Copy problem</div>
        <button data-cc="copy-all">📋 Copy everything</button>
        <button data-cc="copy-statement">Statement</button>
        <button data-cc="copy-input">Input</button>
        <button data-cc="copy-output">Output</button>
        <button data-cc="copy-constraints">Constraints</button>
        <button data-cc="copy-samples">Samples</button>

        <div class="cc-section-title">Library</div>
        <button data-cc="save" class="cc-primary">💾 Save to Library</button>
        <button data-cc="download">⬇️ Download bundle</button>
        <button data-cc="open-library">🗂️ Open Library</button>
        <button data-cc="open-settings">⚙️ Settings</button>

        <div class="cc-status" aria-live="polite"></div>
      </div>
    `;
    document.documentElement.appendChild(bar);

    bar.querySelector(".cc-close").onclick = () => bar.remove();

    getSavedPosition().then((pos) => {
      if (pos) applyPosition(bar, pos);
      makeDraggable(bar, bar.querySelector(".cc-bar-head"));
    });

    bar.addEventListener("click", async (e) => {
      const btn = e.target.closest("button[data-cc]");
      if (!btn) return;
      const action = btn.dataset.cc;
      const status = bar.querySelector(".cc-status");
      const flash = (msg, isErr) => {
        status.textContent = msg;
        status.style.color = isErr ? "#dc2626" : "#059669";
        status.classList.add("show");
        clearTimeout(flash._t);
        flash._t = setTimeout(() => status.classList.remove("show"), 2600);
      };

      try {
        if (action === "ask-chatgpt") {
          flash("Preparing prompt…");
          const r = await askChatGPT();
          if (r.mode === "web") flash("Opened ChatGPT with prompt — press Enter there, then copy code back");
          else flash(`AI pasted directly (${r.model})`);
          return;
        }
        if (action === "auto-paste") {
          flash("Finding best match…");
          const r = await autoPasteBest();
          flash(`Pasted ${r.language || r.kind} — ${r.reason}`);
          return;
        }
        if (action === "search-github") {
          flash("Opening GitHub search…");
          await searchGitHub();
          flash("Opened GitHub in a new tab");
          return;
        }
        if (action === "search-all") {
          flash("Opening web search…");
          await searchAll();
          flash("Opened Google in a new tab");
          return;
        }
        if (action === "search-discuss") {
          flash("Opening Discuss search…");
          await searchDiscuss();
          flash("Opened Discuss in a new tab");
          return;
        }
        if (action === "open-settings") {
          chrome.runtime.sendMessage({ type: "CC_OPEN_SETTINGS" });
          return;
        }

        const p = scrapeProblem();

        if (action === "paste-clipboard") {
          flash("Reading clipboard…");
          const text = await readClipboard();
          if (!text || !text.trim()) throw new Error("Clipboard is empty.");
          const inj = await pasteCodeIntoEditor(text);
          if (!inj.ok) throw new Error(inj.error || "Inject failed.");
          flash(`Pasted clipboard (${inj.kind})`);
        } else if (action === "copy-all") {
          await navigator.clipboard.writeText(renderAll(p));
          flash("Copied everything");
        } else if (action === "copy-statement") {
          await navigator.clipboard.writeText(p.statement);
          flash("Statement copied");
        } else if (action === "copy-input") {
          await navigator.clipboard.writeText(p.inputFormat || "(none found)");
          flash("Input spec copied");
        } else if (action === "copy-output") {
          await navigator.clipboard.writeText(p.outputFormat || "(none found)");
          flash("Output spec copied");
        } else if (action === "copy-constraints") {
          await navigator.clipboard.writeText(p.constraints || "(none found)");
          flash("Constraints copied");
        } else if (action === "copy-samples") {
          const s = (p.samples || []).map((x, i) =>
            `Sample ${i + 1} Input:\n${x.input}\n\nSample ${i + 1} Output:\n${x.output}`
          ).join("\n\n");
          await navigator.clipboard.writeText(s || "(no samples found)");
          flash("Samples copied");
        } else if (action === "save") {
          const res = await chrome.runtime.sendMessage({ type: "CC_SAVE_PROBLEM", problem: p });
          if (res.ok) flash(`Saved as #${res.record.id}`);
          else flash("Save failed: " + res.error, true);
        } else if (action === "download") {
          chrome.runtime.sendMessage({ type: "CC_DOWNLOAD_BUNDLE", problem: p });
          flash("Downloading bundle…");
        } else if (action === "open-library") {
          chrome.runtime.sendMessage({ type: "CC_OPEN_LIBRARY" });
        }
      } catch (err) {
        console.error(err);
        flash("Error: " + (err.message || err), true);
      }
    });
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === "CC_COPY_ALL") {
      const p = scrapeProblem();
      navigator.clipboard.writeText(renderAll(p))
        .then(() => sendResponse({ ok: true }))
        .catch((e) => sendResponse({ ok: false, error: String(e) }));
      return true;
    }
    if (msg.type === "CC_SCRAPE_NOW") {
      sendResponse({ ok: true, problem: scrapeProblem() });
      return true;
    }
    if (msg.type === "CC_TRIGGER_DOWNLOAD") {
      const p = scrapeProblem();
      chrome.runtime.sendMessage({ type: "CC_DOWNLOAD_BUNDLE", problem: p });
      sendResponse({ ok: true });
      return true;
    }
    if (msg.type === "CC_PASTE_SOLUTION") {
      pasteCodeIntoEditor(msg.code).then(sendResponse);
      return true;
    }
    if (msg.type === "CC_PASTE_CLIPBOARD") {
      (async () => {
        try {
          const text = await readClipboard();
          if (!text || !text.trim()) throw new Error("Clipboard is empty.");
          const inj = await pasteCodeIntoEditor(text);
          sendResponse({ ok: !!inj.ok, kind: inj.kind, error: inj.error });
        } catch (e) {
          sendResponse({ ok: false, error: String(e.message || e) });
        }
      })();
      return true;
    }
    if (msg.type === "CC_AUTO_PASTE") {
      (async () => {
        try {
          const r = await autoPasteBest();
          sendResponse({ ok: true, kind: r.kind, language: r.language, reason: r.reason });
        } catch (e) {
          sendResponse({ ok: false, error: String(e.message || e) });
        }
      })();
      return true;
    }
    if (msg.type === "CC_ASK_CHATGPT") {
      (async () => {
        try {
          const r = await askChatGPT();
          sendResponse({ ok: true, mode: r.mode, kind: r.kind, model: r.model });
        } catch (e) {
          sendResponse({ ok: false, error: String(e.message || e) });
        }
      })();
      return true;
    }
    if (msg.type === "CC_SEARCH_GITHUB") {
      searchGitHub().then(sendResponse).catch((e) => sendResponse({ ok: false, error: String(e.message || e) }));
      return true;
    }
    if (msg.type === "CC_SEARCH_ALL") {
      searchAll().then(sendResponse).catch((e) => sendResponse({ ok: false, error: String(e.message || e) }));
      return true;
    }
    if (msg.type === "CC_SEARCH_DISCUSS") {
      searchDiscuss().then(sendResponse).catch((e) => sendResponse({ ok: false, error: String(e.message || e) }));
      return true;
    }
    if (msg.type === "CC_PROBE_EDITOR_VIA_CONTENT") {
      (async () => {
        const lang = await probeEditorLanguage();
        sendResponse({ ok: true, language: lang });
      })();
      return true;
    }
    if (msg.type === "CC_RESET_POSITION") {
      chrome.storage.local.remove(POS_KEY, () => {
        const bar = document.querySelector(".cc-toolbar");
        if (bar) {
          bar.style.left = "";
          bar.style.top = "";
          bar.style.right = "16px";
          bar.style.bottom = "16px";
        }
        sendResponse({ ok: true });
      });
      return true;
    }
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", buildToolbar);
  } else {
    buildToolbar();
  }
})();
