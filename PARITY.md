# Web / iOS parity

Single source of truth for what the two apps share. Web app: this repo (`index.html`). iOS app: `/Users/andrewchandler/ios_apps.d/tir.d` (TirzTrack, SwiftUI + SwiftData). Both are local-first; both apps can optionally sync to an invited cloud account (see CLAUDE.md).

**Last synced** (update when you finish a sync pass, via `/sync-check`): web `dcf836e`, iOS `da117d3`, 2026-10-05.

## Shared contract (change one side, change the other)

| Item | Rule |
|---|---|
| CSV | The 13-column format in CLAUDE.md "CSV format": ISO dates, CRLF between records, quoted fields where needed, blank cells valid. Web owns the definition. iOS `CSVExporter.header` and `TirzTrackTests/CSVContractTests.swift` must match it; the web test is `tests/smoke.spec.js` (header assertion). |
| Storage units | Weight in lbs, waist in inches, height in inches on the web. iOS stores height in cm (`heightCm`). Both show US, metric and UK (stones and pounds: absolute weights as "13 st 5.2 lb", differences in lb; `WeightUnit.stLb`/`parseStLb` mirror the web, tested in `UnitsTests`). Convert at the edge; never export anything but lbs. |
| Dose colours | 2.5 blue, 5 green, 7.5 yellow, 10 orange, 12.5 pink, 15 violet. |
| Glucose zones (ADA, fasting) | Below 100 green #16a34a, 100-125 amber #d97706, 126+ red #dc2626; the rounded value decides. No separate low tier on either side. |
| BMI stages | Underweight below 18.5, normal below 25, overweight below 30, obesity I below 35, II below 40, III 40+. Both decide on the value rounded to 0.1. Names (Normal, Overweight, Obesity I/II/III) and colours (#3b82f6, #16a34a, #d4a106, #f97316, #ea580c, #dc2626) are the same. |
| Blood pressure | AHA categories, higher number decides, rounded values: Normal below 120 and 80 green #16a34a, Elevated 120-129 and below 80 amber #d4a106, Stage 1 130-139 or 80-89 orange #f97316, Stage 2 140+ or 90+ red #dc2626. A reading needs both numbers; typed as `119/79`. |
| Injection sites | Abdomen/Thigh/Arm, left/right. iOS rotation order: Abdomen L, Thigh R, Abdomen R, Thigh L, Arm L, Arm R. Web stores free text from the same six labels. |
| Goal forecast | Least-squares slope over the weigh-ins of the last 28 days (needs 4+ readings over 10+ days) anchored at the latest weigh-in: goal date, BMI next stage and the 30/90-day forecast all use it (`Progress.goalProjection`/`forecastWeight`, web `goalInfo`, `recentSlope`). |

## Feature matrix

Legend: yes, no, partial.

| Feature | Web | iOS | Notes |
|---|---|---|---|
| Entry: date, dose, weight, comments, calories, food notes, glucose, site | yes | yes | |
| Blood pressure (sys/dia) | yes | yes | AHA zones and parse rule mirrored (`BPCategory`, tested). iOS: one `119/79` field, history label, trends bar chart |
| Waist, body fat, muscle mass | yes | yes | iOS stores inches/%/lbs like the web; shows cm with the kg setting. Waist chart has the dashed half-height line and waist-to-height ratio on both |
| Weight chart with 7-day average line | yes | yes | iOS replaced its regression trend line with the web 7-day average |
| Chart tabs (weight, BMI, glucose, pace, waist, BP, calories, combined) | yes | yes | iOS lists them as stacked cards on Trends, and also has body fat and muscle charts. Maths mirrored and tested (`ExtraChartsView`): trailing 7-day average, rolling 4-week pace, ADA zones, BMI stages |
| Chart range switch (All / 6 mo / 3 mo / 30 d) and shaded dose bands | yes | yes | iOS: one range picker above the charts (`ChartRange`, `ChartWindow`); window is measured back from the latest entry, averages use the full history. Keyboard chart reading on the web = native VoiceOver/Audio Graphs on iOS |
| Goal weight and projection | yes | yes | |
| 30/90-day forecast | yes | yes | Web: two boxes in More insights; iOS: Weight Forecast card. Both use the 28-day pace |
| BMI with stage, scale, next stage and projection | yes | yes | Web: gauge ring with hover details; iOS: scale bar with the same next-stage sentence (`BMICategory.next`, web `bmiNextInfo`) |
| Progress maths (percent lost, week on treatment, milestones, lost at week 12, 4-week pace, fast-loss and plateau notices, weekly averages, best week, highs/lows, streak, by-injection-day) | yes | yes | Mirrored in iOS `Progress.swift` with identical hand-built test figures. Both show it in a minimised "More insights" panel; the web also puts it in the doctor report. iOS dose day = reminder weekday if on, else last injection-site entry, else dose start (web: dose-day setting first). Optional start weight ("baseline") is in both Settings |
| Results by dose | yes | yes | iOS `Progress.doseResults`, same segments, weeks and lbs/week rule |
| Current dose, next dose (7-segment strip), days covered, latest glucose and BP cards | yes | yes | iOS `PlanCards`, `Progress.doseInfo`. Injection day setting in both (iOS also falls back to the reminder weekday) |
| Dose reminder | yes (Settings: weekly .ics calendar file) | yes (weekly local notification) | Same idea, platform-native mechanism |
| Units: US / metric / UK stones | yes | yes | See Storage units |
| CSV export (13 columns) | yes | no (removed on purpose) | The iOS app exports nothing (no CSV, no JSON backup file, no report PDF/text/images); the account and doctor links are the only way data leaves the phone. iOS still imports the web CSV (`CSVImport`) and old backups. Intentional gap, not drift |
| Cloud sync (invite-only account, per-day last-write-wins) | yes (hidden behind `#cloud`) | yes (Settings > Cloud Sync) | Same API (`tirzepatide-cloud`), same rules: one entry per day (iOS: the latest of the day, a remote delete removes the whole day), photos never sync, settings that travel are goal, start weight, height (inches on the wire), units, injection day, combined-chart choice. Engine mirrored in iOS `Support/Cloud/CloudSyncEngine.swift` with the same hand-built figures (`CloudSyncTests`, web `tests/cloud.spec.js`). Phase 2 and 3 of `docs/aws-sync-plan.md` |
| Doctor link (read-only, never expires, revocable) | yes: create, copy, revoke, and the doctor view itself (`#share=<token>`) | partly: create, share, revoke; the doctor view is the web app | Same server routes (`POST/GET /shares`, `DELETE /shares/{token}`, public `GET /share/{token}`). Notes (comments, food notes) travel only if ticked when creating the link. iOS has no doctor view of its own on purpose: a link opens in any browser. Phase 4 of `docs/aws-sync-plan.md` |
| CSV import | yes (wizard) | no (removed on purpose) | The iPhone app has no import or export of any kind (CSV, backup file); sign in and the account supplies the log. Intentional gap |
| Chart lines break across gaps over 30 days | yes (`runs()`, `LINE_GAP_DAYS`) | yes (`ChartGaps`) | A line is not drawn between two readings more than 30 days apart; dots stay. Tests: web smoke `chart lines stop at a gap`, iOS `ChartGapTests` |
| Pull down to sync | yes (touch screens, from the top of the page) | yes (every tab, `.refreshable`) | Both also sync by themselves on open/return, after each change and when leaving |
| Clear all data | yes (button; signs out of cloud sync first) | yes (Settings > Clear All Data; signs out first) | The cloud copy is never touched; signing in again brings it back |
| JSON backup/restore (with photos) | n/a | yes | Exists for photos; CSV is the shared backup format on both |
| Doctor report (PDF, summary, charts) | yes | no (removed on purpose) | The iPhone app has no report screen; its only way to share is a doctor link (account required), which opens the web app read-only. Intentional gap |
| Progress photos and gallery | no | yes | |
| App lock (Face ID) | no | yes | |
| Light/dark | yes | yes | |
| Install as app / PWA | yes | n/a | |

## Deliberate gaps

Photos, app lock and JSON backup stay iOS-only and PWA install stays web-only (device features). There is nothing else outstanding: every other feature is in both apps. Anything new goes in both in the same session, without asking.
