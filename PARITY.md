# Web / iOS parity

Single source of truth for what the two apps share. Web app: this repo (`index.html`). iOS app: `/Users/andrewchandler/ios_apps.d/tir.d` (TirzTrack, SwiftUI + SwiftData). Both are local-first and never upload data.

**Last synced** (update when you finish a sync pass, via `/sync-check`): web `a626017`, iOS `c4f309e`, 2026-10-05.

## Shared contract (change one side, change the other)

| Item | Rule |
|---|---|
| CSV | The 13-column format in CLAUDE.md "CSV format": ISO dates, CRLF between records, quoted fields where needed, blank cells valid. Web owns the definition. iOS `CSVExporter.header` and `TirzTrackTests/CSVContractTests.swift` must match it; the web test is `tests/smoke.spec.js` (header assertion). |
| Storage units | Weight in lbs, height in inches on the web. iOS stores height in cm (`heightCm`) and shows lb/kg only. Convert at the edge; never export anything but lbs. |
| Dose colours | 2.5 blue, 5 green, 7.5 yellow, 10 orange, 12.5 pink, 15 violet. |
| Glucose zones (ADA, fasting) | Below 100 green, 100-125 amber, 126+ red. Web has no separate low tier; iOS also flags below 70 red. Decide and align. |
| BMI stages | Underweight below 18.5, normal below 25, overweight below 30, obesity I below 35, II below 40, III 40+. Web decides on the rounded value; iOS uses the raw value. Names differ ("Healthy" vs "Normal"). |
| Injection sites | Abdomen/Thigh/Arm, left/right. iOS rotation order: Abdomen L, Thigh R, Abdomen R, Thigh L, Arm L, Arm R. Web stores free text from the same six labels. |
| Goal forecast | Least-squares slope over recent weigh-ins to project the goal date. Web uses 28 days. |

## Feature matrix

Legend: yes, no, partial.

| Feature | Web | iOS | Notes |
|---|---|---|---|
| Entry: date, dose, weight, comments, calories, food notes, glucose, site | yes | yes | |
| Blood pressure (sys/dia) | yes | no | |
| Waist, body fat, muscle mass | yes | no | |
| Weight chart with trend/average line | yes | yes | |
| Other chart tabs (glucose, pace, waist, BP, calories, combined, BMI) | yes | no | iOS has weight trend only |
| Goal weight and projection | yes | yes | |
| 30/90-day forecast | no | yes | iOS only |
| BMI with stage and gauge | yes | partial | iOS: category and colour, height in cm |
| Progress maths (milestones, week 12, pace, plateau, insights) | yes | no | |
| Results by dose | yes | no | |
| Next dose / dose reminders | yes (next-dose card) | yes (weekly notification) | different mechanisms |
| Units: US / metric / UK stones | yes | partial | iOS lb/kg only |
| CSV export (13 columns) | yes | yes | aligned 2026-10-05 |
| CSV import | yes (wizard) | no | iOS restores from JSON backup only |
| JSON backup/restore (with photos) | no | yes | |
| Doctor report (PDF, summary, charts) | yes | no | |
| Progress photos and gallery | no | yes | |
| App lock (Face ID) | no | yes | |
| Light/dark | yes | yes | |
| Install as app / PWA | yes | n/a | |

## Deliberate gaps

Photos and app lock stay iOS-only (device features). The doctor report and PWA stay web-only. Everything else marked "no" above is a candidate to port, not a decision to leave it out.
