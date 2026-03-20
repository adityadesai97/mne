#!/usr/bin/env bash
set -euo pipefail

# ─── Color helpers ────────────────────────────────────────────────────────────
if [ -t 1 ] && [ "${TERM:-}" != "dumb" ]; then
  GREEN='\033[0;32m'
  RED='\033[0;31m'
  BOLD='\033[1m'
  RESET='\033[0m'
else
  GREEN='' RED='' BOLD='' RESET=''
fi

ok()  { echo -e "${GREEN}✓${RESET} $*"; }
err() { echo -e "${RED}✗${RESET} $*" >&2; }

# ─── Checks ───────────────────────────────────────────────────────────────────
if [ ! -f ".env.local" ]; then
  err ".env.local not found. Run setup first:"
  echo "  bash setup.sh"
  exit 1
fi

if [ ! -d "node_modules" ]; then
  err "node_modules not found. Run setup first:"
  echo "  bash setup.sh"
  exit 1
fi

# ─── Launch ───────────────────────────────────────────────────────────────────
ok "Starting dev server..."
echo ""
echo -e "  Open: ${BOLD}http://localhost:5173${RESET}"
echo ""
echo "  On first sign-in you'll be prompted for:"
echo "    • An AI provider key — Claude (console.anthropic.com) or Groq (console.groq.com)"
echo "    • A Finnhub API key  — finnhub.io/dashboard (free tier is sufficient)"
echo ""

npm run dev
