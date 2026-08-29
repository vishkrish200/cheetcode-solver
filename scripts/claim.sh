#!/usr/bin/env bash
# Claim a full CheetCode v3 run for ANY account: L1 (flag_finder +150 & speed_demon +100,
# auto-leaked + cached per account), L2, L3. Only per-account inputs are the login and its PAT.
#
# Usage:
#   export CHEETCODE_GITHUB_PAT=ghp_...        # a PAT owned by <github-login>
#   scripts/claim.sh <github-login>
#
# Optional overrides (all have sane defaults):
#   CHEETCODE_FINGERPRINT_HINTS_PATH=...       # per-account real-browser fingerprint (else bundled default)
set -euo pipefail

GH="${1:-${CHEETCODE_GITHUB:-}}"
if [ -z "$GH" ]; then
  echo "usage: scripts/claim.sh <github-login>   (with CHEETCODE_GITHUB_PAT exported for that account)" >&2
  exit 1
fi
if [ -z "${CHEETCODE_GITHUB_PAT:-}" ]; then
  echo "error: export CHEETCODE_GITHUB_PAT with a PAT owned by '$GH' first" >&2
  exit 1
fi

cd "$(dirname "$0")/.."
echo "Claiming CheetCode v3 for account: $GH"
exec env LEVEL1_SEND_EXPLOITS=1 CHEETCODE_GITHUB="$GH" npm run zero-retry
