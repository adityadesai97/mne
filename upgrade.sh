#!/usr/bin/env bash
set -euo pipefail

# ─── Color helpers ────────────────────────────────────────────────────────────
if [ -t 1 ] && [ "${TERM:-}" != "dumb" ]; then
  GREEN='\033[0;32m'
  YELLOW='\033[1;33m'
  RED='\033[0;31m'
  BOLD='\033[1m'
  RESET='\033[0m'
else
  GREEN='' YELLOW='' RED='' BOLD='' RESET=''
fi

ok()     { echo -e "${GREEN}✓${RESET} $*"; }
warn()   { echo -e "${YELLOW}!${RESET} $*"; }
err()    { echo -e "${RED}✗${RESET} $*" >&2; }
header() { echo -e "\n${BOLD}=== $* ===${RESET}"; }

ask_yn() {
  local prompt="$1" default="${2:-n}" hint
  if [ "$default" = "y" ]; then hint="[Y/n]"; else hint="[y/N]"; fi
  while true; do
    read -rp "$(echo -e "${prompt} ${hint}: ")" ans
    ans="${ans:-$default}"
    case "${ans,,}" in
      y|yes) return 0 ;;
      n|no)  return 1 ;;
      *) warn "Please enter y or n." ;;
    esac
  done
}

ask_required() {
  local prompt="$1" val=""
  while [ -z "$val" ]; do
    read -rp "$(echo -e "  ${prompt}: ")" val
    if [ -z "$val" ]; then warn "This value is required."; fi
  done
  echo "$val"
}

# ─── Preflight ────────────────────────────────────────────────────────────────
if [ ! -f ".env.local" ]; then
  err ".env.local not found. Run setup.sh first."
  exit 1
fi
if [ ! -d "node_modules" ]; then
  err "node_modules not found. Run setup.sh first."
  exit 1
fi

# ─── Step 1: Pull latest code ─────────────────────────────────────────────────
header "Step 1: Pull latest code"

if command -v git &>/dev/null && [ -d ".git" ]; then
  if ! git diff --quiet || ! git diff --cached --quiet; then
    warn "Uncommitted changes detected. Stash or commit them before upgrading."
    if ! ask_yn "Continue anyway?" "n"; then
      echo "  Upgrade aborted."
      exit 1
    fi
  fi
  git fetch --tags
  git pull --ff-only
  ok "Code updated."
else
  warn "Not a git repo or git not found — skipping code pull."
fi

# ─── Step 2: Update dependencies ──────────────────────────────────────────────
header "Step 2: Update dependencies"
npm ci
ok "Dependencies updated."

# ─── Read .env.local ──────────────────────────────────────────────────────────
SUPABASE_URL=$(grep "^VITE_SUPABASE_URL=" .env.local 2>/dev/null | head -1 | cut -d= -f2-)
SUPABASE_ANON_KEY=$(grep "^VITE_SUPABASE_ANON_KEY=" .env.local 2>/dev/null | head -1 | cut -d= -f2-)

PROJECT_REF=""
if [ -n "${SUPABASE_URL:-}" ]; then
  PROJECT_REF=$(echo "$SUPABASE_URL" | sed 's|https://||' | sed 's|\.supabase\.co.*||')
fi

# Detect whether push notifications were set up
PUSH_ENABLED=false
if grep -q "^VITE_VAPID_PUBLIC_KEY=" .env.local 2>/dev/null; then
  PUSH_ENABLED=true
fi

# ─── Step 3: Apply database schema ────────────────────────────────────────────
header "Step 3: Apply database schema"

SCHEMA_APPLIED=false
PAT=""

if command -v curl &>/dev/null && [ -n "$PROJECT_REF" ]; then
  echo "  Apply the schema automatically via the Supabase Management API."
  echo "  Personal Access Token: https://supabase.com/dashboard/account/tokens"
  echo ""
  if ask_yn "Apply schema automatically?" "y"; then
    PAT=$(ask_required "Supabase Personal Access Token")
    echo ""
    echo "  Applying schema..."

    JSON_BODY=$(node -e "
      const fs = require('fs');
      const sql = fs.readFileSync('supabase/sql/self_host_bootstrap.sql', 'utf8');
      process.stdout.write(JSON.stringify({ query: sql }));
    ")

    HTTP_STATUS=$(curl -s -o /tmp/mne_schema_response.json -w "%{http_code}" \
      -X POST \
      -H "Authorization: Bearer ${PAT}" \
      -H "Content-Type: application/json" \
      -d "$JSON_BODY" \
      "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query")

    if [ "$HTTP_STATUS" = "200" ] || [ "$HTTP_STATUS" = "201" ]; then
      ok "Schema applied."
      SCHEMA_APPLIED=true
    else
      RESPONSE_MSG=$(node -e "
        try {
          const r = require('fs').readFileSync('/tmp/mne_schema_response.json','utf8');
          const j = JSON.parse(r);
          process.stdout.write(j.message || j.error || r);
        } catch(e) { process.stdout.write('unknown error'); }
      " 2>/dev/null || echo "unknown error")
      err "Schema apply failed (HTTP ${HTTP_STATUS}): ${RESPONSE_MSG}"
      warn "Apply it manually — see below."
    fi
  fi
fi

if [ "$SCHEMA_APPLIED" = "false" ]; then
  echo "  Apply manually:"
  echo "  1. Open your Supabase project dashboard → SQL Editor"
  echo "  2. Paste and run: ${BOLD}supabase/sql/self_host_bootstrap.sql${RESET}"
  echo ""
  warn "The script is idempotent — safe to re-run on an existing project."
fi

# ─── Step 4: Redeploy edge functions (if push notifications are in use) ───────
if [ "$PUSH_ENABLED" = "true" ]; then
  header "Step 4: Redeploy edge functions"

  FUNCTIONS_DEPLOYED=false

  if [ -n "$PAT" ] && [ -n "$PROJECT_REF" ] && command -v zip &>/dev/null; then
    echo "  Deploying edge functions..."
    DEPLOY_FAILED_FUNCS=""
    for SLUG in send-push check-prices check-vests check-capital-gains; do
      FN_ZIP="/tmp/mne_fn_${SLUG}.zip"
      FN_META="{\"slug\":\"${SLUG}\",\"name\":\"${SLUG}\",\"verify_jwt\":false}"
      (cd "supabase/functions/${SLUG}" && zip -qr "$FN_ZIP" index.ts)

      FN_STATUS=$(curl -s -o /tmp/mne_fn_response.json -w "%{http_code}" \
        -X PATCH \
        -H "Authorization: Bearer ${PAT}" \
        -F "metadata=${FN_META}" \
        -F "file=@${FN_ZIP};type=application/zip" \
        "https://api.supabase.com/v1/projects/${PROJECT_REF}/functions/${SLUG}")

      if [ "$FN_STATUS" = "404" ]; then
        FN_STATUS=$(curl -s -o /tmp/mne_fn_response.json -w "%{http_code}" \
          -X POST \
          -H "Authorization: Bearer ${PAT}" \
          -F "metadata=${FN_META}" \
          -F "file=@${FN_ZIP};type=application/zip" \
          "https://api.supabase.com/v1/projects/${PROJECT_REF}/functions")
      fi

      rm -f "$FN_ZIP"

      if [ "$FN_STATUS" = "200" ] || [ "$FN_STATUS" = "201" ]; then
        ok "  Deployed ${SLUG}."
      else
        FN_MSG=$(node -e "
          try {
            const r = require('fs').readFileSync('/tmp/mne_fn_response.json','utf8');
            const j = JSON.parse(r);
            process.stdout.write(j.message || j.error || r);
          } catch(e) { process.stdout.write('unknown error'); }
        " 2>/dev/null || echo "unknown error")
        warn "Failed to deploy ${SLUG} (HTTP ${FN_STATUS}): ${FN_MSG}"
        DEPLOY_FAILED_FUNCS="${DEPLOY_FAILED_FUNCS} ${SLUG}"
      fi
    done
    [ -z "$DEPLOY_FAILED_FUNCS" ] && FUNCTIONS_DEPLOYED=true
  else
    if [ -z "$PAT" ]; then
      warn "No Personal Access Token provided — edge functions must be deployed manually."
    elif ! command -v zip &>/dev/null; then
      warn "zip not found — edge functions must be deployed manually."
    fi
  fi

  if [ "$FUNCTIONS_DEPLOYED" = "false" ]; then
    echo ""
    echo "  Deploy manually using the Supabase CLI (https://supabase.com/docs/guides/cli):"
    echo ""
    echo "    supabase login"
    if [ -n "$PROJECT_REF" ]; then
      echo "    supabase functions deploy send-push           --project-ref ${PROJECT_REF}"
      echo "    supabase functions deploy check-prices        --project-ref ${PROJECT_REF}"
      echo "    supabase functions deploy check-vests         --project-ref ${PROJECT_REF}"
      echo "    supabase functions deploy check-capital-gains --project-ref ${PROJECT_REF}"
    else
      echo "    supabase functions deploy send-push           --project-ref <project-ref>"
      echo "    supabase functions deploy check-prices        --project-ref <project-ref>"
      echo "    supabase functions deploy check-vests         --project-ref <project-ref>"
      echo "    supabase functions deploy check-capital-gains --project-ref <project-ref>"
    fi
    echo ""
  fi
fi

# ─── Done ─────────────────────────────────────────────────────────────────────
header "Upgrade complete"
echo ""
echo "  Run the app with:"
echo ""
echo -e "     ${BOLD}bash run.sh${RESET}"
echo ""
ok "Done."
