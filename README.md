# CodeChef Companion — Browser Extension for CodeChef (Copy, Save, Paste, AI)

A Chrome / Brave extension that makes CodeChef practice smoother:

- **Copy** the current problem (statement, constraints, samples) into your IDE with one click.
- **Save** problems and solutions locally, per-language, in a personal library.
- **Paste** code back into CodeChef's editor — from your clipboard or from a saved solution.
- **Ask ChatGPT** to solve the current problem (via the ChatGPT web UI, or optionally via an OpenAI API key you provide).

Everything is stored locally in your browser. No backend, no accounts, no tracking.

## Features

| Feature | Description |
|--------|-------------|
| 📋 Copy problem | Copy full problem (Markdown), statement, input/output specs, constraints, and samples to the clipboard. |
| 💾 Local library | Save problems with URL, tags, notes, status (`unsolved` / `attempted` / `solved`), and per-language solutions. Search, filter, edit, delete. |
| ⬇️ Problem bundle | Download `problem.md`, `sampleN.in` / `sampleN.out`, and a source stub into a folder named after the problem code. |
| 📋 Paste clipboard → editor | Reads your clipboard and injects it directly into the CodeChef editor (Monaco / CodeMirror / textarea, auto-detected). |
| 📥 Paste saved solution | Same but from the library; picks the solution matching the editor's current language. |
| 🤖 Ask ChatGPT | Opens ChatGPT with a pre-filled prompt containing the scraped problem. Optional API mode auto-pastes the answer. |
| 🖱️ Draggable toolbar | Move the floating toolbar anywhere; position persists across reloads and browser restarts. |
| ⌨️ Keyboard shortcuts | `Ctrl+Shift+V` paste clipboard · `Ctrl+Shift+G` ask ChatGPT. |

## Install (from source)

1. Download or clone this repo:
   ```bash
   git clone https://github.com/<your-username>/codechef-companion.git
   cd codechef-companion
   ```
2. Open `chrome://extensions` (Chrome) or `brave://extensions` (Brave).
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the repo folder.
5. Add icons — see [Icons](#icons) below, or remove the `"icons"` / `"default_icon"` blocks from `manifest.json`.

Then visit any `https://www.codechef.com/problems/<CODE>` page. A floating panel appears in the bottom-right corner.

## Usage

### Copy a problem into your IDE

On a problem page, click **📋 Copy everything** in the floating toolbar. The problem pastes as Markdown — drop it into `problem.md`, VS Code, Notion, wherever.

### Save & reuse solutions

1. Click **💾 Save to Library**.
2. The Library tab opens. Pick the **Solution** tab.
3. Choose a language tab (C++ / Python / Java / JavaScript) and paste your code.
4. Click **Save changes** (or click outside the box — autosave fires on blur).
5. Later, on the same CodeChef problem, click **📥 Paste to CodeChef** or use the toolbar's **📋 Paste clipboard → editor** after copying from the Library.

### Ask ChatGPT

- **Default (no key):** click **🤖 Ask ChatGPT** (or `Ctrl+Shift+G`). A new tab opens at `chatgpt.com` with the problem pre-loaded. Press Enter there, copy the code, paste it back with 📋.
- **API mode (optional):** open **Settings** (⚙️ in the popup, or Extension → Options), enable "Use OpenAI API directly", paste your `sk-...` key, and pick a model. Clicking 🤖 will then fetch the solution and inject it automatically. **Costs money** (~$0.001–$0.01 per problem on `gpt-4o-mini`).

### Download a bundle

Click **⬇️ Download bundle** in the toolbar or **Download bundle** in the Library. Files download into `Downloads/<PROBLEM_CODE>/`:

```
FLOW001/
├── problem.md
├── sample1.in
├── sample1.out
├── sample2.in
├── sample2.out
└── solution.cpp
```

Open the folder in VS Code with **File → Open Folder**.

## Icons

Add three PNGs to `icons/`:

- `icon16.png` (16×16)
- `icon48.png` (48×48)
- `icon128.png` (128×128)

Any solid-color icon works for personal use. For something nicer, use <https://favicon.io/favicon-generator/> with "CC" on a purple background.

**To skip icons entirely:** open `manifest.json` and delete the `"default_icon"` block inside `"action"`, and the top-level `"icons"` block. The extension will load with Chrome's default puzzle-piece icon.

## Settings

Open via popup → ⚙️, or **Extension → Options**, or `chrome-extension://<id>/settings.html`.

- **OpenAI API key** — optional, stored in `chrome.storage.local`.
- **Model** — `gpt-4o-mini` (default), `gpt-4o`, `gpt-4.1-mini`, `gpt-4.1`, `o4-mini`.
- **Reset toolbar position** — if it ended up off-screen.
- **Clear mirror** — wipes `chrome.storage.local` copy of the library. IndexedDB is untouched.
- **Delete all saved data** — wipes everything, including IndexedDB.

## Privacy

- **No analytics.** No telemetry, no tracking, no third-party servers contacted by default.
- **No account.** Nothing to sign up for.
- **All storage is local:** `IndexedDB` (primary) + `chrome.storage.local` (mirror for persistence across extension reloads).
- **Only one outbound network call ever:** if you explicitly enter an OpenAI API key and click **🤖 Ask ChatGPT**, the problem text is sent to `api.openai.com`. Nothing else leaves your machine.

## File structure

```
codechef-companion/
├── manifest.json            # MV3 config
├── background.js            # Service worker: message hub, downloads, shortcuts
├── content.js               # Floating toolbar + scraper + ChatGPT
├── content.css              # Toolbar styles
├── editor-bridge.js         # Iframe adapter for Monaco / CodeMirror / textarea
├── popup.html / .css / .js  # Toolbar-icon popup
├── library.html / .css / .js # Full-page library & editor
├── settings.html / .css / .js # Options page
├── db.js                    # IndexedDB + chrome.storage.local mirror
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

## Permissions explained

| Permission | Why |
|-----------|-----|
| `activeTab` | Interact with the current CodeChef tab when you click a button. |
| `scripting` | Inject the editor bridge into the CodeChef iframe. |
| `storage` | Save problems, settings, and toolbar position. |
| `unlimitedStorage` | Avoid the 10 MB quota as the library grows. |
| `downloads` | Save problem bundles and solution files. |
| `contextMenus` | Right-click → copy problem / ask ChatGPT. |
| `tabs` | Find and focus the correct CodeChef tab. |
| `clipboardRead` | Read clipboard for the paste button and shortcut. |
| `host_permissions: codechef.com` | Scrape the problem page. |
| `host_permissions: api.openai.com` | Only used if you provide your own API key. |

## Compatibility

- Chrome 120+ (Manifest V3)
- Brave 1.60+ (Chromium-based)
- Edge (Chromium-based) — untested but should work

Not compatible with Firefox (manifest differences).

## Known limitations

- **Scraping is heuristic.** CodeChef occasionally changes class names. If the statement doesn't extract, open an issue with the problem URL.
- **No bulk export.** Use **Download bundle** per problem, or back up `chrome.storage.local` via the Settings page.
- **ChatGPT accuracy** is what it is. Expect failures on 2000+ rated problems. Always test locally.
- **No AI in contests.** Using AI in rated contests where tools aren't allowed will get your CodeChef account banned. Use this for practice only.

## Contributing

Pull requests welcome. For substantial changes, open an issue first to discuss.

1. Fork the repo
2. Create a branch: `git checkout -b feature/my-feature`
3. Commit: `git commit -m "Add my feature"`
4. Push: `git push origin feature/my-feature`
5. Open a pull request

## License

MIT — see [LICENSE](LICENSE).
