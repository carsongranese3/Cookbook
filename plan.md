# Cookbook — Recipe App (Build Plan)

A personal recipe app for **computer + phone**: save/edit recipes, and turn a cooking
video into a structured recipe using a **free AI (Google Gemini)**. Videos come from
**Instagram Reels + TikTok links** and **direct file uploads**.

## Final decisions
- **App type:** React (Vite) **PWA** — one codebase, installs to phone + desktop.
- **Backend:** Node + Express. Holds the Gemini key, runs yt-dlp, talks to the AI. Browser never sees the key.
- **Storage:** SQLite (single file). Both devices sync by hitting the same server.
- **AI:** Google Gemini (free Flash model) via Google AI Studio key. Free tier accepts video input.
- **Video download:** yt-dlp (backend) for Instagram/TikTok.
- **Hosting:** **home machine + tunnel** (Tailscale/cloudflared) — best link-download reliability; computer stays on.
- **Cook Mode:** deferred (not in this build). Videos are sent to Gemini, not persisted.
- **YouTube:** not supported (IG/TikTok + upload only).

## Data model — `recipes`
`id (uuid)`, `title`, `servings`, `ingredients (JSON string[])`, `steps (JSON string[])`,
`notes (text)`, `source_url (nullable)`, `source_caption (nullable)`, `created_at`, `updated_at`.

## Two ways to create a recipe from a video
- **Path A — Upload a file (build first, always works):** upload → backend sends to Gemini Files API + extraction prompt → JSON → editable form.
- **Path B — Paste IG/TikTok link (add second):** backend runs yt-dlp to fetch video **and caption** → Gemini → same JSON → editable form.

### Gemini extraction prompt
> You are given a cooking video and, optionally, its caption text. Extract the recipe.
> Respond with ONLY valid JSON, no markdown fences, in this exact shape:
> `{"title": string, "servings": string, "ingredients": string[], "steps": string[], "notes": string}`
> Use the caption for exact quantities when the video doesn't state them. If something is
> unknown, use an empty string or empty array. Do not invent ingredients.

Parse defensively: strip ```` ```json ```` fences before `JSON.parse`; on failure, retry once asking for valid JSON only.

## Build order
1. **PWA shell + manual CRUD** (SQLite). Usable manual recipe keeper on day one. ← *this build*
2. **Installable:** manifest + service worker + offline caching of the recipe list.
3. **Path A:** upload video → Gemini → prefilled editable form.
4. **Path B:** paste IG/TikTok link → yt-dlp (video + caption) → Gemini → same form.
5. **Nice-to-have:** Web Share Target (share a Reel into the app; iOS support limited).

## Known hard parts (revisit at each phase)
- **yt-dlp reliability:** IG Reels often need a cookies file; TikTok usually works without. Keep yt-dlp updated. Always fall back to "upload the file instead" on failure.
- **API key safety:** Gemini key lives only in backend `.env`, never in frontend.
- **Free-tier note:** Gemini free tier may use inputs to improve Google's models — fine for recipes; don't send anything sensitive.

## Verification (Phase 1)
- `server`: `npm run dev` → CRUD endpoints respond (create/list/get/update/delete).
- `client`: `npm run dev` → add a recipe, see it in the list, edit it, delete it.
- Cross-device: open the client from phone via the same server → same recipes appear.
