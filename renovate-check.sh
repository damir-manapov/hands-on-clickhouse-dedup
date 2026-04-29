#!/bin/sh
set -e

# Node.js 24+ "happy eyeballs" IPv6 bug workaround
PRELOAD_SCRIPT=$(mktemp)
echo "require('net').setDefaultAutoSelectFamily(false);" > "$PRELOAD_SCRIPT"
trap "rm -f $PRELOAD_SCRIPT" EXIT
export NODE_OPTIONS="${NODE_OPTIONS:-} --require=$PRELOAD_SCRIPT --dns-result-order=ipv4first"

echo "=== Running Renovate dependency check ==="

OUTPUT=$(LOG_FORMAT=json LOG_LEVEL=debug npx -y renovate --platform=local --dry-run 2>&1 || true)

# Check for network errors
if echo "$OUTPUT" | grep -q '"result":"external-host-error"'; then
  echo "⚠ Renovate couldn't reach external hosts (network issue)"
  exit 2
fi

# Extract the branchesInformation line which contains all updates
BRANCHES_INFO=$(echo "$OUTPUT" | grep '"branchesInformation"' || true)

if [ -z "$BRANCHES_INFO" ]; then
  echo "✓ All dependencies are up to date"
  exit 0
fi

# Count updates
MINOR_COUNT=$(echo "$BRANCHES_INFO" | grep -o '"updateType":"minor"' | wc -l)
MAJOR_COUNT=$(echo "$BRANCHES_INFO" | grep -o '"updateType":"major"' | wc -l)
PATCH_COUNT=$(echo "$BRANCHES_INFO" | grep -o '"updateType":"patch"' | wc -l)

if [ "$MINOR_COUNT" -eq 0 ] && [ "$MAJOR_COUNT" -eq 0 ] && [ "$PATCH_COUNT" -eq 0 ]; then
  echo "✓ All dependencies are up to date"
  exit 0
fi

echo ""
echo "Outdated dependencies:"
echo "$BRANCHES_INFO" | grep -oE '\{"branchName":"[^}]+\}' | while read -r branch; do
  DEP_NAME=$(echo "$branch" | grep -oE '"depName":"[^"]+' | cut -d'"' -f4)
  CURRENT=$(echo "$branch" | grep -oE '"currentVersion":"[^"]+' | cut -d'"' -f4)
  NEW=$(echo "$branch" | grep -oE '"newVersion":"[^"]+' | cut -d'"' -f4)
  UPDATE_TYPE=$(echo "$branch" | grep -oE '"updateType":"[^"]+' | cut -d'"' -f4)
  if [ -n "$DEP_NAME" ] && [ -n "$CURRENT" ] && [ -n "$NEW" ]; then
    printf "  [%s] %s  %s -> %s\n" "$UPDATE_TYPE" "$DEP_NAME" "$CURRENT" "$NEW"
  fi
done

printf "\nSummary: major=%d minor=%d patch=%d\n" "$MAJOR_COUNT" "$MINOR_COUNT" "$PATCH_COUNT"
echo "Run 'npx renovate --platform=local' to see full details"

exit 1
