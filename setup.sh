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

ok()   { echo -e "${GREEN}✓${RESET} $*"; }
warn() { echo -e "${YELLOW}!${RESET} $*"; }
err()  { echo -e "${RED}✗${RESET} $*" >&2; }
header() { echo -e "\n${BOLD}=== $* ===${RESET}"; }

# ─── Helpers ──────────────────────────────────────────────────────────────────
ask_yn() {
  # ask_yn "Question" [y|n]  → returns 0 for yes, 1 for no
  local prompt="$1"
  local default="${2:-n}"
  local hint
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
  # ask_required "Prompt text" → echoes the value; re-prompts if blank
  local prompt="$1"
  local val=""
  while [ -z "$val" ]; do
    read -rp "$(echo -e "  ${prompt}: ")" val
    if [ -z "$val" ]; then
      warn "This value is required."
    fi
  done
  echo "$val"
}

# ─── Step 1: Prerequisites ────────────────────────────────────────────────────
header "Step 1: Checking prerequisites"

if ! command -v node &>/dev/null; then
  err "Node.js is not installed."
  echo "  Install Node.js 22.x from: https://nodejs.org/en/download"
  echo "  Or via nvm: https://github.com/nvm-sh/nvm"
  exit 1
fi

NODE_MAJOR=$(node -e "process.stdout.write(String(process.version.split('.')[0].replace('v','')))")
if [ "$NODE_MAJOR" -lt 22 ]; then
  err "Node.js 22.x is required (found $(node --version))."
  echo "  Install Node.js 22.x from: https://nodejs.org/en/download"
  echo "  Or switch versions with nvm: nvm install 22 && nvm use 22"
  exit 1
fi
ok "Node.js $(node --version)"

if ! command -v npm &>/dev/null; then
  err "npm is not installed (it should come with Node.js)."
  exit 1
fi
ok "npm $(npm --version)"

# ─── Step 2: Install dependencies ─────────────────────────────────────────────
header "Step 2: Installing dependencies"
npm install
ok "Dependencies installed."

# ─── Step 3: Check for existing .env.local ────────────────────────────────────
header "Step 3: Environment configuration"

ENV_FILE=".env.local"
if [ -f "$ENV_FILE" ]; then
  warn ".env.local already exists."
  if ! ask_yn "Overwrite it?" "n"; then
    echo "  Keeping existing .env.local."
    SKIP_ENV=true
  else
    SKIP_ENV=false
  fi
else
  SKIP_ENV=false
fi

if [ "$SKIP_ENV" = "false" ]; then

  # ─── Supabase credentials ────────────────────────────────────────────────────
  echo ""
  echo "  You need a Supabase project. Create one free at https://supabase.com"
  echo "  Then find your credentials at: Supabase dashboard → Project Settings → API"
  echo ""

  SUPABASE_URL=$(ask_required "Supabase project URL  (e.g. https://xxxx.supabase.co)")
  SUPABASE_ANON_KEY=$(ask_required "Supabase anon/public key")

  # ─── Optional: restrict signups ──────────────────────────────────────────────
  echo ""
  echo "  ${BOLD}Email allowlist:${RESET} When enabled, only emails you add to the"
  echo "  allowed_emails table in Supabase can sign in."
  RESTRICT_SIGNUPS="false"
  if ask_yn "Restrict sign-ups to an email allowlist?" "n"; then
    RESTRICT_SIGNUPS="true"
  fi

  # ─── Optional: landing page ───────────────────────────────────────────────────
  echo ""
  echo "  ${BOLD}Landing page:${RESET} Shows a marketing/intro page to visitors"
  echo "  before they sign in, instead of redirecting straight to the app."
  LANDING_AS_HOME="false"
  if ask_yn "Show landing page before sign-in?" "n"; then
    LANDING_AS_HOME="true"
  fi

  # ─── Optional: push notifications / VAPID ────────────────────────────────────
  echo ""
  echo "  ${BOLD}Push notifications:${RESET} Enables browser push alerts for price"
  echo "  movements, RSU vesting, and capital gains events."
  echo "  Requires generating a VAPID key pair and setting secrets in Supabase."
  ENABLE_PUSH=false
  VAPID_PUBLIC_KEY=""
  if ask_yn "Enable push notifications?" "n"; then
    ENABLE_PUSH=true
    echo ""
    echo "  Generate a VAPID key pair by running:"
    echo "    npx web-push generate-vapid-keys"
    echo ""
    VAPID_PUBLIC_KEY=$(ask_required "VAPID public key")
  fi

  # ─── Write .env.local ─────────────────────────────────────────────────────────
  {
    echo "VITE_SUPABASE_URL=${SUPABASE_URL}"
    echo "VITE_SUPABASE_ANON_KEY=${SUPABASE_ANON_KEY}"
    echo ""
    echo "# Optional: only allow emails present in public.allowed_emails"
    echo "VITE_RESTRICT_SIGNUPS=${RESTRICT_SIGNUPS}"
    echo ""
    echo "# Optional: show the landing page before sign-in"
    echo "VITE_LANDING_AS_HOME=${LANDING_AS_HOME}"
    if [ "$ENABLE_PUSH" = "true" ]; then
      echo ""
      echo "# Required for push notifications"
      echo "VITE_VAPID_PUBLIC_KEY=${VAPID_PUBLIC_KEY}"
    else
      echo ""
      echo "# Optional (only needed when enabling push notifications)"
      echo "# VITE_VAPID_PUBLIC_KEY=your-vapid-public-key"
    fi
  } > "$ENV_FILE"

  ok ".env.local written."

fi  # end SKIP_ENV

# ─── Step 4: Apply database schema ────────────────────────────────────────────
header "Step 4: Apply the database schema"

# Extract the Supabase URL (may have been set earlier, or read from existing file)
if [ -z "${SUPABASE_URL:-}" ]; then
  URL_LINE=$(grep "^VITE_SUPABASE_URL=" "$ENV_FILE" 2>/dev/null | head -1)
  SUPABASE_URL="${URL_LINE#VITE_SUPABASE_URL=}"
fi

# Derive project ref from URL (https://<ref>.supabase.co)
PROJECT_REF=""
if [ -n "${SUPABASE_URL:-}" ]; then
  PROJECT_REF=$(echo "$SUPABASE_URL" | sed 's|https://||' | sed 's|\.supabase\.co.*||')
fi

SCHEMA_APPLIED=false

if command -v curl &>/dev/null && [ -n "$PROJECT_REF" ]; then
  echo "  The schema can be applied automatically using the Supabase Management API."
  echo "  You'll need a Personal Access Token:"
  echo "    https://supabase.com/dashboard/account/tokens"
  echo ""
  if ask_yn "Apply the database schema automatically?" "y"; then
    PAT=$(ask_required "Supabase Personal Access Token")
    echo ""
    echo "  Applying schema..."

    # Build JSON body using Node (guaranteed available) to safely encode the SQL
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
      ok "Schema applied successfully."
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
      warn "You can apply it manually — see instructions below."
    fi
  fi
fi

if [ "$SCHEMA_APPLIED" = "false" ]; then
  echo "  Apply the schema manually:"
  echo "  1. Open your Supabase project dashboard → SQL Editor"
  echo "  2. Paste the contents of the file below and click Run:"
  echo ""
  echo "     ${BOLD}supabase/sql/self_host_bootstrap.sql${RESET}"
  echo ""
  warn "The script is idempotent — safe to re-run on an existing project."
fi

# ─── Step 5: Google OAuth setup ───────────────────────────────────────────────
header "Step 5: Enable Google sign-in"

echo "  The app uses Google OAuth via Supabase Auth. Two things to configure:"
echo ""
echo "  ${BOLD}A) In your Supabase dashboard:${RESET}"
echo "     Authentication → Providers → Google → toggle on"
echo ""
echo "  ${BOLD}B) In Google Cloud Console (https://console.cloud.google.com):${RESET}"
echo "     1. APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID"
echo "     2. Application type: Web application"
echo "     3. Authorized JavaScript origins:"
echo "           http://localhost:5173"
echo "     4. Authorized redirect URIs:"

# Try to extract the project ref from the Supabase URL in .env.local
if [ -f "$ENV_FILE" ]; then
  URL_LINE=$(grep "^VITE_SUPABASE_URL=" "$ENV_FILE" | head -1)
  SUPABASE_URL_VAL="${URL_LINE#VITE_SUPABASE_URL=}"
  if [ -n "$SUPABASE_URL_VAL" ]; then
    echo "           ${SUPABASE_URL_VAL}/auth/v1/callback"
  else
    echo "           https://<your-project-ref>.supabase.co/auth/v1/callback"
  fi
else
  echo "           https://<your-project-ref>.supabase.co/auth/v1/callback"
fi

echo "     5. Copy the generated Client ID and Client Secret"
echo "     6. Paste them into Supabase: Authentication → Providers → Google"
echo ""

# ─── Step 6: Push notification secrets (if enabled) ───────────────────────────
if [ "$SKIP_ENV" = "false" ] && [ "$ENABLE_PUSH" = "true" ]; then
  header "Step 6: Push notification secrets"
  echo "  Set these three secrets in Supabase dashboard →"
  echo "  Settings → Edge Functions → Secrets:"
  echo ""
  echo "    VAPID_PUBLIC_KEY   = (same as VITE_VAPID_PUBLIC_KEY you entered)"
  echo "    VAPID_PRIVATE_KEY  = (from the same npx web-push generate-vapid-keys output)"
  echo "    VAPID_SUBJECT      = mailto:you@example.com"
  echo ""
fi

# ─── Step 7: Email allowlist reminder ─────────────────────────────────────────
if [ "$SKIP_ENV" = "false" ] && [ "$RESTRICT_SIGNUPS" = "true" ]; then
  header "Step 6b: Add emails to the allowlist"
  echo "  Since you enabled VITE_RESTRICT_SIGNUPS, run this in Supabase SQL Editor"
  echo "  for each email address you want to grant access:"
  echo ""
  echo "    INSERT INTO allowed_emails (email) VALUES ('you@example.com');"
  echo ""
fi

# ─── Done ─────────────────────────────────────────────────────────────────────
header "Setup complete"
echo ""
echo "  Once you've configured Google OAuth, run the app with:"
echo ""
echo -e "     ${BOLD}bash run.sh${RESET}"
echo ""
ok "Done."
