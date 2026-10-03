# Tirzepatide Log

A single-file web page for tracking tirzepatide dose, weight, calories, food notes and blood sugar, with charts and a printable report for your doctor.

- No build step, no dependencies, no server. Open `index.html` in a browser.
- Data stays in the browser (localStorage). Nothing is uploaded.
- Import any CSV with a column-matching step, export your log as CSV, and generate a PDF/PNG/text report.

## Use it

Open `index.html`, or host the folder anywhere static (GitHub Pages, S3 + CloudFront, Netlify).
To try it with fake data, choose **Import data** and pick `sample-data/TirzepatideLog-sample-year.csv`.

## CSV format

```
Date,Dosage (mg),Weight (lbs),Comments,Calories,Food Notes,Blood Sugar (mg/dL)
2026-01-05,2.50,210.0,"First dose, felt fine",2100,Chicken salad,105
```

Only `Date` is required. Dates may be `YYYY-MM-DD`, `MM/DD/YYYY` or `DD/MM/YYYY`; kg weights can be converted on import.

## Privacy

Each visitor's data lives only in their own browser. Do not commit real health data to this repository; `.gitignore` excludes `*.csv` except the fake sample.

## Publish with GitHub Pages

Repository Settings > Pages > Deploy from branch > `main` / root.

This is a personal tracking tool, not medical advice or a medical record.
