#!/usr/bin/env bash
# Push main, publish the app to its own site (https://tirzepatide.phoe.be/), refresh the old www.phoe.be copy (which now only
# forwards to the new host), invalidate both CloudFront caches, then wait for the GitHub Pages build (also only a forwarder now).
# Needs: gh (authenticated) and the AWS profile `kathyterraform`.
set -euo pipefail

REPO="archie-hub/tirzepatide-log"
DIST_ID="EWVXJSS4UKRDN"          # www.phoe.be (old addresses: they forward to the new host)
SITE_DIST_ID="EIEBIAJ1TVNS4"      # https://tirzepatide.phoe.be/ (the app)
AWS_PROFILE_NAME="kathyterraform"
TIMEOUT=300

cd "$(dirname "$0")"

[ "$(git branch --show-current)" = "main" ] || { echo "Not on main" >&2; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "Uncommitted changes; commit first" >&2; exit 1; }

# The remote can be ahead (e.g. an edit made on github.com).
git pull --rebase origin main
git push origin main
sha=$(git rev-parse HEAD)
echo "Pushed ${sha:0:7}; waiting for Pages build..."

# phoe.be serves /tirzepatide-log/* from S3 first (GitHub Pages is the automatic fallback), so publish there at once
# and invalidate; GitHub being slow or down no longer holds up what visitors see.
./publish-site.sh
aws cloudfront create-invalidation --distribution-id "$SITE_DIST_ID" --paths "/index.html" "/sw.js" "/404.html" "/manifest.webmanifest" \
  --profile "$AWS_PROFILE_NAME" --query 'Invalidation.{Id:Id,Status:Status}' --output text
./publish-s3.sh
aws cloudfront create-invalidation --distribution-id "$DIST_ID" \
  --paths "/tirzepatide-log/*" \
  --profile "$AWS_PROFILE_NAME" \
  --query 'Invalidation.{Id:Id,Status:Status}' --output text
echo "phoe.be should show ${sha:0:7} within a minute or two."

# Keep the fallback copy fresh too: wait for the GitHub Pages build (only informational for phoe.be now).
start=$(date +%s)
while :; do
  read -r status commit < <(gh api "repos/$REPO/pages/builds/latest" --jq '"\(.status) \(.commit)"')
  if [ "$commit" = "$sha" ] && [ "$status" = "built" ]; then break; fi
  if [ "$commit" = "$sha" ] && [ "$status" = "errored" ]; then echo "Pages build errored (phoe.be is unaffected; the fallback copy is stale)" >&2; exit 1; fi
  if [ $(( $(date +%s) - start )) -gt "$TIMEOUT" ]; then echo "Timed out waiting for Pages build (last: $status ${commit:0:7}); phoe.be is unaffected" >&2; exit 1; fi
  sleep 5
done
echo "Pages build complete (fallback copy is current)."
