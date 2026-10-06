#!/usr/bin/env bash
# Push main, wait for the GitHub Pages build, then invalidate the phoe.be CloudFront cache
# so https://www.phoe.be/tirzepatide-log.html picks up the new version straight away.
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

# Invalidating before the build finishes would just re-cache the old files.
start=$(date +%s)
while :; do
  read -r status commit < <(gh api "repos/$REPO/pages/builds/latest" --jq '"\(.status) \(.commit)"')
  if [ "$commit" = "$sha" ] && [ "$status" = "built" ]; then break; fi
  if [ "$commit" = "$sha" ] && [ "$status" = "errored" ]; then echo "Pages build errored" >&2; exit 1; fi
  if [ $(( $(date +%s) - start )) -gt "$TIMEOUT" ]; then echo "Timed out waiting for Pages build (last: $status ${commit:0:7})" >&2; exit 1; fi
  sleep 5
done
echo "Pages build complete."

aws cloudfront create-invalidation --distribution-id "$DIST_ID" \
  --paths "/tirzepatide-log/*" "/tirzepatide-log.html" \
  --profile "$AWS_PROFILE_NAME" \
  --query 'Invalidation.{Id:Id,Status:Status}' --output text
echo "Done. phoe.be should show ${sha:0:7} within a minute or two."
