# Web / iOS parity

Single source of truth for what the two apps share. Web app: this repo (`index.html`). iOS app: `/Users/andrewchandler/ios_apps.d/tir.d` (TirzTrack, SwiftUI + SwiftData). Both are local-first and never upload data.

**Last synced** (update when you finish a sync pass, via `/sync-check`): web `b5387f3`, iOS `0c049c7`, 2026-10-05.

## Shared contract (change one side, change the other)

| Item | Rule |
|---|---|
| CSV | The 13-column format in CLAUDE.md "CSV format": ISO dates, CRLF between records, quoted fields where needed, blank cells valid. Web owns the definition. iOS `CSVExporter.header` and `TirzTrackTests/CSVContractTests.swift` must match it; the web test is `tests/smoke.spec.js` (header assertion). |
| Storage units | Weight in lbs, height in inches on the web. iOS stores height in cm (`heightCm`) and shows lb/kg only. Convert at the edge; never export anything but lbs. |
| Dose colours | 2.5 blue, 5 green, 7.5 yellow, 10 orange, 12.5 pink, 15 violet. |
| Glucose zones (ADA, fasting) | Below 100 green, 100-125 amber, 126+ red. Web has no separate low tier; iOS also flags below 70 red. Decide and align. |
| BMI stages | Underweight below 18.5, normal below 25, overweight below 30, obesity I below 35, II below 40, III 40+. Both decide on the value rounded to 0.1. Names differ ("Healthy" vs "Normal"). |
| Blood pressure | AHA categories, higher number decides, rounded values: Normal below 120 and 80 green #16a34a, Elevated 120-129 and below 80 amber #d4a106, Stage 1 130-139 or 80-89 orange #f97316, Stage 2 140+ or 90+ red #dc2626. A reading needs both numbers; typed as `119/79`. |
| Injection sites | Abdomen/Thigh/Arm, left/right. iOS rotation order: Abdomen L, Thigh R, Abdomen R, Thigh L, Arm L, Arm R. Web stores free text from the same six labels. |
| Goal forecast | Least-squares slope over recent weigh-ins to project the goal date. Web uses 28 days. |

## Feature matrix

Legend: yes, no, partial.

| Feature | Web | iOS | Notes |
|---|---|---|---|
| Entry: date, dose, weight, comments, calories, food notes, glucose, site | yes | yes | |
| Blood pressure (sys/dia) | yes | yes | AHA zones and parse rule mirrored (`BPCategory`, tested). iOS: one `119/79` field, history label, trends bar chart |
| Waist, body fat, muscle mass | yes | yes | iOS stores inches/%/lbs like the web; shows cm with the kg setting. No waist-to-height or half-height line yet |
| Weight chart with trend/average line | yes | yes | |
| Chart tabs (weight, BMI, glucose, pace, waist, BP, calories, combined) | yes | yes | iOS lists them as stacked cards on Trends, and also has body fat and muscle charts. Maths mirrored and tested (`ExtraChartsView`): trailing 7-day average, rolling 4-week pace, ADA zones, BMI stages |
| Chart range switch (All / 6 mo / 3 mo / 30 d), dose bands, keyboard chart reading | yes | no | iOS charts always show everything; only the combined chart has touch readout |
| Goal weight and projection | yes | yes | |
| 30/90-day forecast | no | yes | iOS only |
| BMI with stage and gauge | yes | partial | iOS: category, colour, scale bar and chart; height in cm. Stage uses the value rounded to 0.1 on both |
| Progress maths (percent lost, week on treatment, milestones, lost at week 12, 4-week pace, fast-loss and plateau notices, weekly averages, best week, highs/lows, streak, by-injection-day) | yes | yes | Mirrored in iOS `Progress.swift` with identical hand-built test figures. Both show it in a minimised "More insights" panel; the web also puts it in the doctor report. iOS dose day = reminder weekday if on, else last injection-site entry, else dose start (web: dose-day setting first). Optional start weight ("baseline") is in both Settings |
| Results by dose | yes | yes | iOS `Progress.doseResults`, same segments, weeks and lbs/week rule |
| Next dose / dose reminders | yes (next-dose card) | yes (weekly notification) | different mechanisms |
| Units: US / metric / UK stones | yes | partial | iOS lb/kg only |
| CSV export (13 columns) | yes | yes | aligned 2026-10-05; iOS now fills all 13 |
| CSV import | yes (wizard) | yes | iOS: Settings > Import from CSV. Same column words, date detection, kg conversion, merge/replace by date; `CSVImportTests`. Rows with no dose import as 0 mg (hidden, exported blank) because iOS dose is not optional |
| JSON backup/restore (with photos) | no | yes | |
| Doctor report (PDF, summary, charts) | yes | no | |
| Progress photos and gallery | no | yes | |
| App lock (Face ID) | no | yes | |
| Light/dark | yes | yes | |
| Install as app / PWA | yes | n/a | |

## Deliberate gaps

Photos and app lock stay iOS-only and PWA install stays web-only (device features). Everything else marked "no" or "partial" above is simply not built yet and gets ported when next touched; it is not a decision to leave it out. No need to ask.
