# Tirzepatide Log: project context

Single-file web app (`index.html`): HTML, CSS and vanilla JS in one file. Live at https://archie-hub.github.io/tirzepatide-log/. Also proxied (unlisted, noindex) by the phoe.be CloudFront distribution at https://www.phoe.be/tirzepatide-log.html; a tiny head script adds `<base href="/tirzepatide-log/">` only on that URL so relative assets resolve. Optional PWA files beside it: `manifest.webmanifest`, `sw.js` (network-first cache), `icons/`, `og-image.png` (link preview); `index.html` only loads the manifest/service worker over http(s). No build step, no dependencies. The only network call is a same-origin fetch of `AJC_DATA.csv` when hosted and the browser log is empty (`loadHostedData()`). Must keep working when opened straight from disk (`file://`) and when hosted statically (GitHub Pages, S3 + CloudFront). `package.json`/`tests/` are dev-only tooling (Playwright smoke tests via `npm test`) and don't affect the app's zero-dependency runtime.

## What it does
- Logs date, dose (mg), weight (lbs), comments, calories, food notes, glucose (mg/dL), injection site.
- Top row (stats): latest weight, goal (ring + projection from a 28-day least-squares slope; Set a goal / Edit open the settings dialog), change since start, latest fasting glucose. Below it, the plan cards row: next dose (weekday from settings, else last logged site date, else current dose start; also shows current dose and days covered) and BMI. There is no Backup card; the only export button is the header's Export CSV (`lastExport` is still recorded by `markBackedUp()`).
- "Results by dose" panel: lbs/week per dose segment (also in the doctor report).
- BMI card (plan cards, next to Next dose): until a height is saved it shows one text field (accepts `5'9"`, `5 9`, `69 in`, `175 cm`; saves on Enter/blur, no button); afterwards BMI is calculated automatically from the latest weigh-in. Height is stored in inches as `settings.heightIn` and edited from the card's Edit link (settings dialog). Shows a color-coded scale and stage list with the weight range per stage. Stages (`BMI_STAGES`): underweight blue, normal green, overweight amber, obesity I orange, II deep orange, III red; the rounded value decides.
- Stats cards, tabbed charts (weight / BMI / glucose / calories; the BMI tab only shows once a height is saved, dots coloured by BMI stage with dashed stage threshold lines) with dose bands, 7-day average line, hover tooltip, range switch (All, 6 mo, 3 mo, 30 d).
- Header backup line (`renderBackup()`): last export age, amber when never exported or older than 14 days with changes since; links to Export CSV. Delete has no confirm; a toast offers Undo for 8 s (`showUndo()`).
- Entry table with edit/delete and dose-colored rows. Paged, 5 per page, newest first (Previous / numbered pages / Next).
- Import wizard: file, drag and drop, or pasted CSV; auto-matches columns, handles `MM/DD/YYYY` vs `DD/MM/YYYY`, converts kg to lbs, merge or replace by date.
- Export CSV in the exact 8-column format below.
- "Doctor report": date-range report with summary boxes, charts, fasting glucose ranges (counts and share per ADA range), dose schedule, comments table, optional full log. Mirrors the dashboard (keep it that way: anything added to the dashboard also goes in the report): boxes for dose, weight, change, goal progress and projection, BMI (first to last, with stage), BMI next stage, latest and average fasting glucose, entries and days covered, next dose; optional BMI chart plus a BMI stage table (the checkbox is always listed but disabled with a hint until a height is saved); all of it also in the text summary. Output via print/PDF, PNG chart images, copied text summary, mailto, Web Share, CSV for the range.

## Data and privacy rules
- All data lives in the visitor's browser (`localStorage` key `tirzepatide-log-v1`; report name under `tirzepatide-report-name`; goal, dose day, height and backup timestamps under `tirzepatide-settings`). Never add code that uploads data.
- Never commit real health data. `.gitignore` excludes `*.csv` except `sample-data/`. The sample file is fake.
- Every localStorage call is wrapped in try/catch; the app must render with empty storage.

## CSV format
`Date,Dosage (mg),Weight (lbs),Comments,Calories,Food Notes,Blood Sugar (mg/dL),Injection Site` (8th column added later; 7-column files still import) with ISO dates, CRLF line endings, quoted fields where needed. Comments can contain newlines and commas. Blank cells are valid.

## Code layout (inside one IIFE in `index.html`)
storage and helpers, CSV parse/serialize, `buildChart()` (used for both the live chart and print/PNG charts, `print:true` builds a standalone light SVG), stats and hero, table, form, tabs/range, import wizard, doctor report.

## Design decisions
- Dose colors: 2.5 blue, 5 green, 7.5 yellow, 10 orange, 12.5 pink, 15 violet (`doseColor()`).
- Metric colors: weight teal `#0ea5a4`, glucose orange `#f97316`, calories violet `#8b5cf6`.
- Glucose readings are always fasting. Values are coloured by ADA fasting range (`sugarZone()`): below 100 green `#16a34a`, 100-125 prediabetes amber `#d97706`, 126+ diabetes red `#dc2626` (rounded value decides). Applied to the stat card, entries table, chart dots (with dashed 100/126 threshold lines; the sugar 7-day line is neutral slate so it isn't confused with amber), tooltip, and doctor report.
- Light and dark mode via CSS variables; `prefers-reduced-motion` respected. Report content is always light (print-safe).
- No external fonts or scripts, so it works offline.

## How it was tested
Automated: `npm test` runs `tests/smoke.spec.js` (Playwright, Chromium) — imports `sample-data/TirzepatideLog-sample-year.csv`, checks stats and charts render, hover tooltip, report preview, CSV/PNG downloads, print-to-PDF with `.report-mode`, and a 390px-wide dark-mode render with no horizontal overflow. Run it after changes to these areas; extend the spec file rather than only checking by hand.
Manual: headless Chromium screenshots for anything the spec doesn't cover yet (visual/layout changes, new UI).

## Next steps
1. Done: repo is public at github.com/archie-hub/tirzepatide-log, Pages serves `main` / root.
2. Done: MIT license (`LICENSE`), automated smoke test (`tests/smoke.spec.js`, run via `npm test`).
3. Partial: ARIA/keyboard review. Dialogs, tabs and range controls already use native `<dialog>`/roving tabindex/`aria-selected`/`aria-pressed`; per-row Edit/Delete buttons now have date-specific `aria-label`s. Chart is keyboard readable: focus the chart, Left/Right step through points, Home/End jump, Esc hides; the tooltip is an aria-live region.

This is a personal tracking tool, not medical advice.
