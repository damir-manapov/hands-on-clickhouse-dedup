#!/bin/sh
set -e

echo "=== Running gitleaks ==="
gitleaks git . -v
gitleaks dir . -v

echo "=== Checking outdated dependencies (via Renovate) ==="
./renovate-check.sh

echo "=== Checking vulnerabilities ==="
pnpm audit --audit-level=moderate

echo "=== Health checks passed ==="
