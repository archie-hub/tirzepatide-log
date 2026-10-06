#!/usr/bin/env bash
# Build the hosted copy (dist/) and publish it to the app's own bucket, https://tirzepatide.phoe.be/ (see tirzepatide-cloud/site.tf).
# Hashed script files are immutable; everything that must update at once (index.html, sw.js, 404.html) is no-cache.
# Used by deploy.sh; can be run alone. Nothing is deleted from the bucket (old hashed scripts stay for pages still open).
set -euo pipefail
export AWS_PROFILE="${AWS_PROFILE:-kathyterraform}" AWS_PAGER=""
BUCKET="s3://tirzlog-site-426832080397"
cd "$(dirname "$0")"
python3 build-hosted.py

put() {  # put <path under dist> <content-type> <cache-control>
  aws s3 cp "dist/$1" "$BUCKET/$1" --content-type "$2" --cache-control "$3" --only-show-errors
}
for f in dist/app.*.js dist/gate.*.js; do put "$(basename "$f")" "application/javascript; charset=utf-8" "public, max-age=31536000, immutable"; done
for f in dist/icons/*.png; do put "icons/$(basename "$f")" "image/png" "public, max-age=86400"; done
put icons/icon.svg "image/svg+xml" "public, max-age=86400"
for f in dist/landing/*.jpg; do put "landing/$(basename "$f")" "image/jpeg" "public, max-age=86400"; done
put og-image.png "image/png" "public, max-age=86400"
put manifest.webmanifest "application/manifest+json" "public, max-age=3600"
put 404.html "text/html; charset=utf-8" "no-cache"
put sw.js "application/javascript; charset=utf-8" "no-cache"
put index.html "text/html; charset=utf-8" "no-cache"     # last, so a visitor never gets a page that points at scripts not uploaded yet
echo "Published $(git rev-parse --short HEAD) to $BUCKET/"
