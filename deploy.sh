#!/usr/bin/env bash
# Push main, publish the served files to S3 (phoe.be's primary origin for /tirzepatide-log/*), invalidate the
# phoe.be CloudFront cache, then wait for the GitHub Pages build (the fallback origin and the github.io address).
# Needs: gh (authenticated) and the AWS profile `kathyterraform`.
set -euo pipefail

REPO="archie-hub/tirzepatide-log"
DIST_ID="EWVXJSS4UKRDN"
AWS_PROFILE_NAME="kathyterraform"
TIMEOUT=300

cd "$(dirname "$0")"

[ "$(git branch --show-current)" = "main" ] || { echo "Not on main" >&2; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "Uncommitted changes; commit first" >&2; exit 1; }

# The remote can be ahead (e.g. automated AJC_DATA.csv updates).
git pull --rebase origin main
git push origin main
sha=$(git rev-parse HEAD)
echo "Pushed ${sha:0:7}; waiting for Pages build..."

# phoe.be serves /tirzepatide-log/* from S3 first (GitHub Pages is the automatic fallback), so publish there at once
# and invalidate; GitHub being slow or down no longer holds up what visitors see.
./publish-s3.sh
aws cloudfront create-invalidation --distribution-id "$DIST_ID" \
  --paths "/tirzepatide-log/*" "/tirzepatide-log.html" \
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
