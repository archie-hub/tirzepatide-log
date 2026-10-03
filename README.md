# Tirzepatide Log

A single-file web page for tracking tirzepatide dose, weight, calories, food notes and blood sugar, with charts and a printable report for your doctor.

**Live:** https://archie-hub.github.io/tirzepatide-log/

- No build step, no dependencies, no server. Open `index.html` in a browser.
- Data stays in the browser (localStorage). Nothing is uploaded.
- Import any CSV with a column-matching step, export your log as CSV, and generate a PDF/PNG/text report.
- Next-dose countdown with injection-site rotation, goal weight with a progress ring and projected date, results by dose (lbs per week at each dose), and a backup reminder.
- Installable as an app (home screen, works offline) when hosted.

## Use it

Open `index.html`, or host the folder anywhere static (GitHub Pages, S3 + CloudFront, Netlify).
To try it with fake data, choose **Import data** and pick `sample-data/TirzepatideLog-sample-year.csv`.

## CSV format

```
Date,Dosage (mg),Weight (lbs),Comments,Calories,Food Notes,Blood Sugar (mg/dL),Injection Site
2026-01-05,2.50,210.0,"First dose, felt fine",2100,Chicken salad,105,Stomach (left)
```

`Injection Site` is optional; older 7-column files import fine.

Only `Date` is required. Dates may be `YYYY-MM-DD`, `MM/DD/YYYY` or `DD/MM/YYYY`; kg weights can be converted on import.

## Privacy

Each visitor's data lives only in their own browser. Do not commit real health data to this repository; `.gitignore` excludes `*.csv` except the fake sample.

## Install on your phone

On the live site: in Chrome or Edge use **Install app** in the header; on iPhone tap Share, then **Add to Home Screen**. The app keeps working offline.

## Auto-load a data file

If `AJC_DATA.csv` sits next to `index.html` on the hosted site, a browser with an empty log loads it automatically. Anything committed to this public repo is publicly downloadable.

## Publish with GitHub Pages

Repository Settings > Pages > Deploy from branch > `main` / root.

This is a personal tracking tool, not medical advice or a medical record.
