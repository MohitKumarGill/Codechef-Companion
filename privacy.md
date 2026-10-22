# Privacy Policy — CodeChef Companion

**Last updated:** 2025-10-22

## Summary

CodeChef Companion does **not** collect, transmit, or share any personal data. There is no
backend, no analytics, and no tracking. Everything runs entirely in your browser.

## What data the extension stores

All data is stored locally in your browser:

- **Problem data** (title, statement, samples, tags, notes, status): stored in
  `IndexedDB` under the database `codechef-companion`, plus a mirror in
  `chrome.storage.local` for persistence across extension reloads.
- **Per-language solutions**: same stores as above.
- **Settings** (optional OpenAI API key, chosen model, toolbar position):
  stored in `chrome.storage.local`.

None of this data is transmitted anywhere by the extension itself.

## Third-party services

The extension contacts **one** third-party service, and only under these exact conditions:

1. You have entered an OpenAI API key in Settings **and** enabled "Use OpenAI API directly" **and**
   clicked the 🤖 Ask ChatGPT button on a CodeChef problem page.

   In that case, the problem statement, constraints, samples, and a prompt asking for a solution are
   sent to `https://api.openai.com/v1/chat/completions`. OpenAI's own privacy policy applies:
   https://openai.com/policies/privacy-policy.

2. **Nothing else** leaves your machine.

The "Ask ChatGPT" button in **web mode** (the default) simply opens
`https://chatgpt.com/?q=<prompt>` in a new tab. No data is sent by the extension itself —
your browser's normal navigation applies.

## What the extension does NOT do

- ❌ Does not collect usage statistics or telemetry.
- ❌ Does not track you across sites.
- ❌ Does not read pages other than `codechef.com/problems/*`.
- ❌ Does not access your passwords, cookies, or personal files.
- ❌ Does not include any remote code (all JavaScript is bundled).

## Permissions justification

Each permission requested in `manifest.json` is required for a specific feature.
See the [README](README.md#permissions-explained) for details.

## Deleting your data

Open **Settings** (⚙️ in the popup) → **Delete all saved data**. This removes
`IndexedDB` and `chrome.storage.local` completely. Alternatively, uninstalling the extension
removes all local data automatically.

## Contact

For questions, open an issue at
`https://github.com/<your-username>/codechef-companion/issues`.
