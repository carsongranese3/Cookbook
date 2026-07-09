# Design reference — "Pantry"

Source prototype: claude.ai/design project **"Recipe tracking with AI video"** (Carson).
Raw file: [`design/Pantry.dc.html`](../design/Pantry.dc.html) — a `.dc.html` canvas mockup
(uses `sc-for`/`sc-if`/`{{ }}` placeholder bindings; it is a **visual spec, not runnable code**).
Both a **Desktop** and a **Phone** frame are drawn for every screen.

## Visual system
- **Font:** Onest (Google Fonts), weights 400–700. `system-ui` fallback.
- **Palette:**
  - Page background `#e7e5df`; app surface `#fff`; sidebar `#fbfaf8`; subtle fill `#f4f3f0`.
  - Borders `#efede8` / `#f1efea`.
  - Text: headings `#111`; body `#3a3a3a`/`#333`; muted `#6b665e`; secondary/labels `#a8a29a`, `#b8b2a8`.
  - **Accent (terracotta)** `#c56a4a`, hover/darker `#a8542f`.
  - Primary buttons: near-black `#111` with white text. Cooking Mode: full `#111` dark theme.
- **Shape:** cards ~14px radius, inputs/buttons ~11–12px, pills 16px.
- **Eyebrow labels:** uppercase, 10px, letter-spacing 2px, color `#b8b2a8` (terracotta on AI Import).
- **Headings:** 28–30px, weight 600, letter-spacing −0.02em.

## Navigation
- **Desktop:** left sidebar — "Pantry" wordmark, nav items (Recipes/Library, Meal Plan, Shopping, Add from video), and a footer user chip ("My Kitchen · N recipes").
- **Phone:** scrolling content with a fixed bottom tab bar (~62px) and full-screen overlays for Cooking Mode and the plan picker.

## Screens
1. **Library (home)** — eyebrow "My Kitchen", title "Recipes", search box (recipes + ingredients), category/cuisine filter chips, recipe card grid (3-col desktop / 2-col phone). Card = image + favorite heart overlay, title, `X min · cuisine · ★ rating`. Empty state: "No recipes match ‘…’".
2. **Recipe Detail** — back link, hero image, eyebrow `cuisine · category`, title, description, stats (Total time / Servings / Rating). Actions: **Start cooking** (black), **Add to list**, **Add to plan**, **Favorite**. Two columns: **Ingredients** (name + qty rows) and **Method** (numbered steps).
3. **AI Import — "Add from a video"** — eyebrow "AI Import" (terracotta), URL input (link icon), **Extract** button, sample-link chips. States: **loading** ("Watching the video…" spinner + status line), **error** (terracotta banner), **AI draft** (hero with "AI draft" badge, editable title, description, meta, ingredients, method) → **Save to library** / **Discard**. Copy names **TikTok, Instagram, and YouTube**.
4. **Meal Plan** — eyebrow "This week", 7-day grid (desktop) / vertical day list (phone). Each day: name, date, meal thumbnails, "+ Add meal". A **plan-picker modal** chooses a recipe for a day.
5. **Shopping List** — eyebrow "N to buy", add-item input, "Clear checked". Item rows: checkbox, name (strikethrough when checked), qty. Empty state.
6. **Cooking Mode** — full-screen dark overlay. Header (title + close), progress bar, "Step N of total" (terracotta), large centered step text, footer Back / dots / **Next**→**Finish**. Note: this design's Cook Mode is **step text only — no video pane**.

## Data implied by the design (richer than plan.md's schema)
- **Recipe:** title, description, cuisine, category, minutes (total time), servings, rating, favorite (bool), hero image, `ingredients: {name, qty}[]`, `steps: {n, text}[]`, source_url.
  - Note: ingredients are **{name, qty} objects** here, vs. plan.md's array of plain strings.
- **Meal plan:** day → list of recipe references (this week).
- **Shopping list:** items `{name, qty, checked}`.

## Deltas vs. `plan.md` (to reconcile before building)
- **New feature areas** not in plan.md: **Meal Plan** and **Shopping List** (+ favorites, ratings, cuisine, categories, hero images).
- **Cooking Mode** is back, but as **text steps only** (plan.md had deferred a *video-beside-steps* cook mode).
- **Video sources** include **YouTube**; plan.md had settled on **Instagram/TikTok only**.
- **Ingredient shape** is `{name, qty}` objects, not plain strings — affects the DB schema and the AI extraction prompt.
