#!/usr/bin/env bash
# Copy the app's served files to s3://www.phoe.be/tirzepatide-log/ (the phoe.be CloudFront serves /tirzepatide-log/*
# from there first and falls back to GitHub Pages). An explicit file list under one prefix: never --delete, and
# nothing outside tirzepatide-log/ is touched. AJC_DATA.csv is left out on purpose (the fallback serves it from GitHub).
# Used by deploy.sh; can be run alone.
set -euo pipefail
export AWS_PROFILE="${AWS_PROFILE:-kathyterraform}" AWS_PAGER=""
BUCKET="s3://www.phoe.be/tirzepatide-log"
cd "$(dirname "$0")"

put() {  # put <file> <content-type> <cache-control>
  aws s3 cp "$1" "$BUCKET/$1" --content-type "$2" --cache-control "$3" --only-show-errors
}
put index.html "text/html; charset=utf-8" "max-age=600"
put sw.js "application/javascript; charset=utf-8" "no-cache"
put manifest.webmanifest "application/manifest+json" "max-age=600"
put og-image.png "image/png" "max-age=600"
for f in icons/apple-touch-icon.png icons/icon-192.png icons/icon-512.png; do put "$f" "image/png" "max-age=600"; done
put icons/icon.svg "image/svg+xml" "max-age=600"
echo "Published $(git rev-parse --short HEAD) to $BUCKET/"
