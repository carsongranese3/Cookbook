# Project: Cookbook (design name: "Pantry")

> Drop this file at the repo root. It is the single briefing every agent reads.
> The agent files in `~/.claude/agents/` stay generic; this file is what makes the team
> build *this* app.

## What this app is
A personal recipe app for computer + phone, built as an installable PWA. It lets me save,
search, and organize recipes; plan meals for the week; keep a shopping list; and turn
**Instagram Reel / TikTok** cooking videos into structured recipes using a **free AI
(Google Gemini)**. It also has a full-screen, step-by-step **Cooking Mode**. The look
follows the "Pantry" design prototype (`design/Pantry.dc.html`, mapped in `docs/design.md`).

## Tech stack
- Language / runtime: JavaScript, Node 20
- Backend framework: Express + SQLite (`better-sqlite3`), single-file DB
- Frontend framework: React + Vite, built as a **PWA** (web manifest + service worker)
- Styling: **Plain hand-written CSS** (no framework). Onest font; terracotta `#c56a4a`
  accent and the palette in `docs/design.md`.
- Hosting target: **home machine + private tunnel (Tailscale)** — only my own devices reach
  it, so no in-app auth. The backend runs yt-dlp from a residential IP for reliability.

## Data sources
- **Google Gemini API** (free tier, a Flash model), `https://generativelanguage.googleapis.com`.
  Provides video→recipe extraction (video + optional caption in → recipe JSON out). Auth: API
  key in `server/.env` (`GEMINI_API_KEY`), **server-side only, never in the frontend**.
- **yt-dlp** (backend subprocess) — downloads the Instagram/TikTok video **and** its caption
  for a pasted link. IG Reels often need a cookies file; TikTok usually works without. Always
  fall back to "upload a file instead" when a link fails.
- Refresh requirements: on-demand only. No polling or live data — extraction runs when I ask.

## Conventions
- **Monorepo:** `server/` (API) and `client/` (React PWA).
- **Recipe fields** (match the design + specs exactly, don't invent): `title`, `description`,
  `cuisine`, `category`, `minutes` (total time), `servings`, `rating`, `favorite`, `image`,
  `ingredients`, `steps`, `source_url`, `source_caption`.
  - `ingredients` are **`{name, qty}` objects**; `steps` are ordered step text.
  - **All measurements are stored and displayed in imperial.** The AI extraction must convert any
    metric units to imperial — weights in oz/lb, volumes in cups/tbsp/tsp/fl oz, oven temps in °F,
    lengths in inches. Quantities are captured (not left blank), converting from the caption/spoken amounts.
- Additional stores implied by the design: **meal plan** (day → recipe refs) and
  **shopping list** items (`{name, qty, checked}`).
- Frontend calls the API with **relative `/api/*` URLs**; the Vite dev server proxies to
  `http://localhost:3001`.
- Plain CSS lives in `client/src`. Follow `design/Pantry.dc.html` + `docs/design.md` for
  layout, spacing, and color — do not introduce a CSS framework.
- Video sources are **Instagram + TikTok only** for now (the design mentions YouTube; we are
  intentionally not building it — see `docs/decisions.md`).
- Secrets live only in `server/.env` (gitignored). Never commit keys or put them in the client.
- Field names are defined in specs and endpoint docs — match them exactly, do not invent.

## Where things live
- Specs: `specs/`
- API / endpoint docs: `docs/api.md`
- Normalized data shapes: `docs/data-shapes.md`
- Decisions log: `docs/decisions.md`
- Design reference: `design/` (pulled prototype) + `docs/design.md` (screen-by-screen mapping)

## Commands
- Install: `cd server && npm install` &nbsp;and&nbsp; `cd client && npm install`
- Run dev: `cd server && npm run dev` (API on :3001) &nbsp;and&nbsp; `cd client && npm run dev` (:5173)
- Test: **manual QA** — run the app and verify against the spec; there is no automated runner yet
- Build: `cd client && npm run build`

---

## Orchestration (instructions for the main session)

You are the orchestrator. You do not write feature code yourself; you plan, delegate to
the specialist subagents, and integrate their output. The available specialists are:
`requirements-agent`, `explore-agent`, `data-agent`, `backend-agent`, `frontend-agent`,
`qa-agent`, `devops-agent`.

### First, pick the mode

Before delegating anything, decide which mode the task is:
- **Mode A — new feature / greenfield**: building something that doesn't exist yet, in a new or
  empty-ish repo. Use the full build pipeline below.
- **Mode B — editing an existing project**: changing, extending, or fixing code that already
  exists (add a field, fix a bug, refactor, wire in a new endpoint). Understand before you edit.

When unsure, look: if the relevant code already exists in the repo, it's Mode B. Most day-to-day
work is Mode B. Don't run the full greenfield pipeline on a one-file bugfix.

### Mode A — new feature / greenfield

1. Delegate to `requirements-agent` to produce a spec at `specs/<feature>.md` with acceptance
   criteria and edge cases. If the user wants the plan sourced from Azure DevOps, tell the
   agent so explicitly in the prompt — it has read-only access to work items but only consults
   them when asked.
2. Once the spec exists, delegate to `data-agent` (writes `docs/data-shapes.md`) and
   `backend-agent` (reads the shape, writes `docs/api.md`). If the app has no external data,
   skip `data-agent` and let `backend-agent` start from the spec.
3. Delegate `frontend-agent` only after `docs/api.md` exists — it depends on those exact field
   names, so this step is genuinely serial, not parallel.
4. After any piece lands, delegate `qa-agent` to verify it against the spec and do a security
   pass. Treat its go / no-go as a gate.
5. Bring in `devops-agent` only after QA gives a go and its security concerns are resolved —
   for the pipeline, environment config, and monitoring.

### Run independent agents in parallel

The data → backend → frontend chain is serial *across* the chain because each reads the previous
one's doc — don't break that. But *within* a step, run independent agents concurrently:

- **To run agents in parallel, issue their Task calls in a single message.** Multiple Task calls in
  one message run concurrently; one call per message runs them serially. When two or more agents are
  independent, do not wait for one to finish before starting the next — launch them together.
- **Parallel-eligible cases** (launch together in one message):
  - two or more independent backend endpoints or modules,
  - `data-agent` + `backend-agent` on the parts that don't depend on each other (backend scaffolds
    the server/schema while data builds the fetch layer; integrate after),
  - in Mode B, independent edits across layers for one change (e.g. a backend change and an
    unrelated frontend change),
  - independent verification or exploration tasks.
- **Keep serial only where there's a real dependency:** spec before any build, `docs/api.md` before
  `frontend-agent`, the build before `qa-agent`. Don't parallelize across a doc hand-off.

Think "serial backbone, parallel where independent" — not everything at once, and not everything
one-at-a-time.

### Mode B — editing an existing project

The trap here is editing before understanding. Fresh-context agents that skip discovery
reinvent helpers, miss conventions, and break things they couldn't see. So:

1. **Understand first.** Delegate `explore-agent` to map the slice of the codebase the change
   touches: the files involved, how the layers connect, the patterns and naming already in use,
   and anything that would break. It is read-only — it reports a map; you integrate its findings
   and pass them to the builders. It does not edit.
2. **Scope the change.** Decide the smallest set of files/layers that actually has to change.
   If the change is genuinely cross-cutting and underspecified, delegate `requirements-agent`
   to document *current behavior + the specific delta* (not a from-scratch spec) and, if asked,
   to pull scope from Azure DevOps. For a clear, small change, skip the spec and go straight to
   the edit.
3. **Edit the affected layers together.** Delegate `backend-agent` / `frontend-agent` /
   `data-agent` to change only what step 2 scoped — pass them the explorer's map and tell them
   to match existing patterns, not introduce new ones. These often run in parallel here, since
   an edit usually doesn't recreate the greenfield data→backend→frontend dependency.
4. **Verify against current behavior.** Delegate `qa-agent` to confirm the change works, the
   surrounding behavior still passes (no regressions), and to do a security pass on the diff.
5. Bring in `devops-agent` only if the change affects build, config, or deploy — many edits
   don't, so don't invoke it by reflex.

In both modes the rules below apply.

When delegating, remember each subagent starts with a fresh context and can only see what
you put in the prompt. Always pass:
- the spec file path (`specs/<feature>.md`),
- the relevant doc paths (`docs/data-shapes.md`, `docs/api.md`),
- in Mode B, the explorer's map of the affected code,
- any decisions already made.

You own `docs/decisions.md`. Whenever you resolve an open question or make a cross-cutting
call (library choice, data source, schema tradeoff), append it there before delegating the
next step, so future sessions and fresh-context agents stay consistent.

Surface for the user to confirm (do not let an agent do these unprompted): deploying to
production, deleting data, changing access or security settings, creating accounts, or
entering any credentials.
