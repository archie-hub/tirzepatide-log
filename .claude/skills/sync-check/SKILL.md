---
name: sync-check
description: Compare the web app and the iOS companion app for drift since the last sync and list what to port. Use after finishing a feature in either app, or when asked to check parity/sync.
---

Web repo: ~/apps.d/tirzepatide-log. iOS repo: ~/ios_apps.d/tir.d. Read PARITY.md in the web repo first.

1. Read the "Last synced" commits in PARITY.md. For each repo run `git log --oneline <hash>..HEAD` and `git diff --stat <hash>..HEAD`, plus `git status` for uncommitted work.
2. For each change, decide if it touches the shared contract (CSV columns, units, colours/zones, BMI stages, injection sites, forecast) or adds a user-facing feature the other app lacks.
3. Check the contract directly: web CSV header in index.html and tests/smoke.spec.js vs `CSVExporter.header` and TirzTrackTests/CSVContractTests.swift in iOS.
4. Report a short list: contract breaks (must fix), features to port, deliberate gaps. Update the PARITY.md matrix to match reality.
5. Port or fix what the user approves, run `npm test` (web) and `xcodebuild test -project TirzTrack.xcodeproj -scheme TirzTrack -destination 'platform=iOS Simulator,name=iPhone 17'` (iOS), then update "Last synced" with both new short hashes.
