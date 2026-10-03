# Tirzepatide Log: project context

Single-file web app (`index.html`): HTML, CSS and vanilla JS in one file. Live at https://archie-hub.github.io/tirzepatide-log/. Optional PWA files beside it: `manifest.webmanifest`, `sw.js` (network-first cache), `icons/`, `og-image.png` (link preview); `index.html` only loads the manifest/service worker over http(s). No build step, no dependencies. The only network call is a same-origin fetch of `AJC_DATA.csv` when hosted and the browser log is empty (`loadHostedData()`). Must keep working when opened straight from disk (`file://`) and when hosted statically (GitHub Pages, S3 + CloudFront).

## What it does
- Logs date, dose (mg), weight (lbs), comments, calories, food notes, blood sugar (mg/dL), injection site.
- Plan cards: next dose (weekday from settings, else last logged site date, else current dose start); goal ring with projection (28-day least-squares slope); backup status.
- "Results by dose" panel: lbs/week per dose segment (also in the doctor report).
- Stats cards, tabbed charts (weight / blood sugar / calories) with dose bands, 7-day average line, hover tooltip, range switch (All, 6 mo, 3 mo, 30 d).
- Entry table with edit/delete and dose-colored rows. Shows the latest 30 entries until "Show all".
- Import wizard: file, drag and drop, or pasted CSV; auto-matches columns, handles `MM/DD/YYYY` vs `DD/MM/YYYY`, converts kg to lbs, merge or replace by date.
- Export CSV in the exact 8-column format below.
- "Doctor report": date-range report with summary boxes, charts, dose schedule, comments table, optional full log. Output via print/PDF, PNG chart images, copied text summary, mailto, Web Share, CSV for the range.

## Data and privacy rules
- All data lives in the visitor's browser (`localStorage` key `tirzepatide-log-v1`; report name under `tirzepatide-report-name`; goal, dose day and backup timestamps under `tirzepatide-settings`). Never add code that uploads data.
- Never commit real health data. `.gitignore` excludes `*.csv` except `sample-data/`. The sample file is fake.
- Every localStorage call is wrapped in try/catch; the app must render with empty storage.

## CSV format
`Date,Dosage (mg),Weight (lbs),Comments,Calories,Food Notes,Blood Sugar (mg/dL),Injection Site` (8th column added later; 7-column files still import) with ISO dates, CRLF line endings, quoted fields where needed. Comments can contain newlines and commas. Blank cells are valid.

## Code layout (inside one IIFE in `index.html`)
storage and helpers, CSV parse/serialize, `buildChart()` (used for both the live chart and print/PNG charts, `print:true` builds a standalone light SVG), stats and hero, table, form, tabs/range, import wizard, doctor report.

## Design decisions
- Dose colors: 2.5 blue, 5 green, 7.5 yellow, 10 orange, 12.5 pink, 15 violet (`doseColor()`).
- Metric colors: weight teal `#0ea5a4`, blood sugar orange `#f97316`, calories violet `#8b5cf6`.
- Light and dark mode via CSS variables; `prefers-reduced-motion` respected. Report content is always light (print-safe).
- No external fonts or scripts, so it works offline.

## How it was tested
Headless Chromium (Playwright): import `sample-data/TirzepatideLog-sample-year.csv`, check stats and charts render, hover tooltip, report preview, PNG downloads, print-to-PDF with `.report-mode`. Re-run similar checks after changes, including a 390px-wide dark-mode screenshot.

## Next steps
1. Done: repo is public at github.com/archie-hub/tirzepatide-log, Pages serves `main` / root.
2. Optional: add a license, a small test script, and an ARIA/keyboard review.

This is a personal tracking tool, not medical advice.
