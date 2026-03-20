#!/usr/bin/env bash
# setup.sh — first-time setup for a self-hosted mne instance
#
# WHAT IT DOES (in order):
#
#   Step 1  Check prerequisites
#             Verifies Node.js 22.x and npm are installed.
#
#   Step 2  Install npm dependencies
#             Runs `npm install` to populate node_modules/.
#
#   Step 3  Write .env.local
#             Prompts for the Supabase project URL and anon key.
#             Asks about three optional features:
#               • Email allowlist   — sets VITE_RESTRICT_SIGNUPS=true so only
#                                     emails in the allowed_emails table can sign in.
#               • Landing page      — sets VITE_LANDING_AS_HOME=true to show a
#                                     marketing page before sign-in.
#               • Push notifications — sets VITE_VAPID_PUBLIC_KEY and collects the
#                                     full VAPID key pair for use in steps 4b–4d.
#             Skipped (with prompt) if .env.local already exists.
#
#   Step 4  Apply the database schema
#             Runs supabase/sql/self_host_bootstrap.sql against the project via the
#             Supabase Management API (POST /v1/projects/{ref}/database/query).
#             The bootstrap SQL is fully idempotent (CREATE IF NOT EXISTS, ADD COLUMN
#             IF NOT EXISTS, etc.), so it is safe to re-run on an existing project.
#             Falls back to manual instructions if the user skips or curl is absent.
#
#   Step 4b  Schedule push notification edge functions with pg_cron   [push only]
#             Enables the pg_cron and pg_net Postgres extensions, then creates three
#             cron jobs that call the check-* edge functions via net.http_post():
#               • mne-check-prices        — hourly  (0 * * * *)
#               • mne-check-vests         — hourly  (30 * * * *)
#               • mne-check-capital-gains — daily 9am UTC (0 9 * * *)
#             Safe to re-run: existing jobs with these names are unscheduled first.
#             Falls back to ready-to-paste SQL if the auto-apply fails.
#
#   Step 4c  Set VAPID secrets on Supabase edge functions             [push only]
#             Uses the Management API (POST /v1/projects/{ref}/secrets) to set the
#             three secrets required by the send-push function:
#               VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
#             Falls back to manual dashboard instructions if the API call fails.
#
#   Step 4d  Deploy edge functions                                    [push only]
#             Zips each function's index.ts and uploads it to the Management API
#             (PATCH to update an existing function, POST to create a new one).
#             Requires the `zip` command; falls back to Supabase CLI instructions
#             if zip is not available.
#
#   Step 5  Print Google OAuth setup instructions
#             The app authenticates via Google OAuth through Supabase Auth.
#             This step cannot be automated — it prints the exact callback URL and
#             walks through the Google Cloud Console steps needed.
#
#   Step 6  Edge function deployment summary                          [push only]
#             Confirms what was automated in steps 4b–4d, or prints manual fallback
#             instructions for any parts that could not be completed automatically.
#
#   Step 7  Email allowlist reminder                         [VITE_RESTRICT_SIGNUPS]
#             Reminds the user to add their email to the allowed_emails table.
#
# WHAT IT DOES NOT DO:
#   - Configure Google OAuth (manual — see Step 5)
#   - Sign in or create a Supabase account
#   - Deploy the app to a public host (run `bash run.sh` for local dev)
#
# REQUIREMENTS:
#   - Node.js 22.x + npm
#   - curl (for Supabase Management API calls)
#   - zip (only for automatic edge function deployment)
#   - A Supabase project (free tier is sufficient)
#   - A Supabase Personal Access Token (only for automatic schema/function setup)
#
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
  echo "  Requires generating a VAPID key pair."
  ENABLE_PUSH=false
  VAPID_PUBLIC_KEY=""
  VAPID_PRIVATE_KEY=""
  VAPID_SUBJECT=""
  if ask_yn "Enable push notifications?" "n"; then
    ENABLE_PUSH=true
    echo ""
    echo "  Generate a VAPID key pair by running:"
    echo "    npx web-push generate-vapid-keys"
    echo ""
    VAPID_PUBLIC_KEY=$(ask_required "VAPID public key")
    VAPID_PRIVATE_KEY=$(ask_required "VAPID private key")
    VAPID_SUBJECT=$(ask_required "VAPID subject (e.g. mailto:you@example.com)")
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
if [ -z "${SUPABASE_ANON_KEY:-}" ]; then
  KEY_LINE=$(grep "^VITE_SUPABASE_ANON_KEY=" "$ENV_FILE" 2>/dev/null | head -1)
  SUPABASE_ANON_KEY="${KEY_LINE#VITE_SUPABASE_ANON_KEY=}"
fi

# Derive project ref from URL (https://<ref>.supabase.co)
PROJECT_REF=""
if [ -n "${SUPABASE_URL:-}" ]; then
  PROJECT_REF=$(echo "$SUPABASE_URL" | sed 's|https://||' | sed 's|\.supabase\.co.*||')
fi

SCHEMA_APPLIED=false
PAT=""

if command -v curl &>/dev/null && [ -n "$PROJECT_REF" ]; then
  echo "  The schema can be applied automatically using the Supabase Management API."
  echo "  You'll need a Personal Access Token:"
  echo "    https://supabase.com/dashboard/account/tokens"
  echo ""
  if ask_yn "Apply the database schema automatically?" "y"; then
    PAT=$(ask_required "Supabase Personal Access Token")
    echo ""
    echo "  Applying schema..."

    # Use Node to JSON-encode the SQL body. The bootstrap SQL contains single
    # quotes, dollar signs, and backslashes that would require complex escaping
    # in pure bash. Node's JSON.stringify handles all of that safely.
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

# ─── Step 4b: pg_cron schedules (push notifications only) ─────────────────────
# pg_cron is a Postgres extension (pre-installed on Supabase Cloud) that runs
# scheduled SQL commands inside the database. Combined with pg_net, it makes
# outbound HTTP POST requests to the edge function URLs on a cron schedule.
# This avoids any external scheduler — the DB itself fires the jobs.
CRON_APPLIED=false
if [ "$ENABLE_PUSH" = "true" ] && [ -n "$PAT" ] && [ -n "$PROJECT_REF" ] && [ -n "${SUPABASE_URL:-}" ] && [ -n "${SUPABASE_ANON_KEY:-}" ]; then
  echo ""
  echo "  Setting up pg_cron schedules for push notification edge functions..."

  # The anon key is embedded directly in the HTTP header stored in the cron job.
  # This is intentional: the check-* functions are deployed with verify_jwt:false
  # and called by pg_cron (not a user), so the anon key is the right credential.
  CRON_SQL=$(node -e "
    const url = process.argv[1];
    const key = process.argv[2];
    const authHeader = JSON.stringify({'Content-Type':'application/json','Authorization':'Bearer ' + key});
    const sql = \`
create extension if not exists pg_net schema extensions;
create extension if not exists pg_cron;

do \\\$\\\$ begin
  if exists (select 1 from cron.job where jobname = 'mne-check-prices') then
    perform cron.unschedule('mne-check-prices');
  end if;
  if exists (select 1 from cron.job where jobname = 'mne-check-vests') then
    perform cron.unschedule('mne-check-vests');
  end if;
  if exists (select 1 from cron.job where jobname = 'mne-check-capital-gains') then
    perform cron.unschedule('mne-check-capital-gains');
  end if;
end \\\$\\\$;

select cron.schedule('mne-check-prices','0 * * * *',
  format(\\\$q\\\$select net.http_post(url:=%L,headers:=%L::jsonb,body:='{}'::jsonb)\\\$q\\\$,
    '\${url}/functions/v1/check-prices', '\${authHeader}'));

select cron.schedule('mne-check-vests','30 * * * *',
  format(\\\$q\\\$select net.http_post(url:=%L,headers:=%L::jsonb,body:='{}'::jsonb)\\\$q\\\$,
    '\${url}/functions/v1/check-vests', '\${authHeader}'));

select cron.schedule('mne-check-capital-gains','0 9 * * *',
  format(\\\$q\\\$select net.http_post(url:=%L,headers:=%L::jsonb,body:='{}'::jsonb)\\\$q\\\$,
    '\${url}/functions/v1/check-capital-gains', '\${authHeader}'));
\`;
    process.stdout.write(JSON.stringify({ query: sql }));
  " "$SUPABASE_URL" "$SUPABASE_ANON_KEY")

  CRON_STATUS=$(curl -s -o /tmp/mne_cron_response.json -w "%{http_code}" \
    -X POST \
    -H "Authorization: Bearer ${PAT}" \
    -H "Content-Type: application/json" \
    -d "$CRON_SQL" \
    "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query")

  if [ "$CRON_STATUS" = "200" ] || [ "$CRON_STATUS" = "201" ]; then
    ok "pg_cron schedules applied (prices: hourly, vests: hourly, capital-gains: daily 9am UTC)."
    CRON_APPLIED=true
  else
    CRON_MSG=$(node -e "
      try {
        const r = require('fs').readFileSync('/tmp/mne_cron_response.json','utf8');
        const j = JSON.parse(r);
        process.stdout.write(j.message || j.error || r);
      } catch(e) { process.stdout.write('unknown error'); }
    " 2>/dev/null || echo "unknown error")
    warn "pg_cron setup failed (HTTP ${CRON_STATUS}): ${CRON_MSG}"
    warn "You will need to set up the schedules manually (see Step 6 below)."
  fi
fi

# ─── Step 4c: VAPID secrets (push notifications only) ─────────────────────────
SECRETS_APPLIED=false
if [ "$ENABLE_PUSH" = "true" ] && [ -n "$PAT" ] && [ -n "$PROJECT_REF" ]; then
  echo ""
  echo "  Setting VAPID secrets on Supabase edge functions..."

  SECRETS_BODY=$(node -e "
    process.stdout.write(JSON.stringify([
      {name:'VAPID_PUBLIC_KEY',  value: process.argv[1]},
      {name:'VAPID_PRIVATE_KEY', value: process.argv[2]},
      {name:'VAPID_SUBJECT',     value: process.argv[3]},
    ]));
  " "$VAPID_PUBLIC_KEY" "$VAPID_PRIVATE_KEY" "$VAPID_SUBJECT")

  SECRETS_STATUS=$(curl -s -o /tmp/mne_secrets_response.json -w "%{http_code}" \
    -X POST \
    -H "Authorization: Bearer ${PAT}" \
    -H "Content-Type: application/json" \
    -d "$SECRETS_BODY" \
    "https://api.supabase.com/v1/projects/${PROJECT_REF}/secrets")

  if [ "$SECRETS_STATUS" = "200" ] || [ "$SECRETS_STATUS" = "201" ]; then
    ok "VAPID secrets set successfully."
    SECRETS_APPLIED=true
  else
    SECRETS_MSG=$(node -e "
      try {
        const r = require('fs').readFileSync('/tmp/mne_secrets_response.json','utf8');
        const j = JSON.parse(r);
        process.stdout.write(j.message || j.error || r);
      } catch(e) { process.stdout.write('unknown error'); }
    " 2>/dev/null || echo "unknown error")
    warn "Secrets apply failed (HTTP ${SECRETS_STATUS}): ${SECRETS_MSG}"
    warn "You will need to set them manually (see Step 6 below)."
  fi
fi

# ─── Step 4d: Deploy edge functions (push notifications only) ─────────────────
FUNCTIONS_DEPLOYED=false
if [ "$ENABLE_PUSH" = "true" ] && [ -n "$PAT" ] && [ -n "$PROJECT_REF" ]; then
  if ! command -v zip &>/dev/null; then
    warn "zip not found — edge functions must be deployed manually (see Step 6)."
  else
    echo ""
    echo "  Deploying edge functions..."
    DEPLOY_FAILED_FUNCS=""
    for SLUG in send-push check-prices check-vests check-capital-gains; do
      FN_ZIP="/tmp/mne_fn_${SLUG}.zip"
      FN_META="{\"slug\":\"${SLUG}\",\"name\":\"${SLUG}\",\"verify_jwt\":false}"
      (cd "supabase/functions/${SLUG}" && zip -qr "$FN_ZIP" index.ts)

      # PATCH updates an existing function; if it doesn't exist the API returns
      # 404, in which case we fall through to POST to create it. This avoids
      # having to check existence first with a separate GET request.
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
    if [ -z "$DEPLOY_FAILED_FUNCS" ]; then
      FUNCTIONS_DEPLOYED=true
    fi
  fi
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

# ─── Step 6: Push notifications — deploy edge functions ───────────────────────
if [ "$SKIP_ENV" = "false" ] && [ "$ENABLE_PUSH" = "true" ]; then
  header "Step 6: Deploy edge functions for push notifications"

  if [ "$FUNCTIONS_DEPLOYED" = "true" ]; then
    ok "Edge functions were deployed automatically."
  else
    echo "  Four Supabase edge functions must be deployed to your project:"
    echo "    send-push, check-prices, check-vests, check-capital-gains"
    echo ""
    echo "  Deploy using the Supabase CLI (install at https://supabase.com/docs/guides/cli):"
    echo ""
    echo "    supabase login"
    if [ -n "$PROJECT_REF" ]; then
      echo "    supabase functions deploy send-push           --project-ref ${PROJECT_REF}"
      echo "    supabase functions deploy check-prices        --project-ref ${PROJECT_REF}"
      echo "    supabase functions deploy check-vests         --project-ref ${PROJECT_REF}"
      echo "    supabase functions deploy check-capital-gains --project-ref ${PROJECT_REF}"
    else
      echo "    supabase functions deploy send-push           --project-ref <your-project-ref>"
      echo "    supabase functions deploy check-prices        --project-ref <your-project-ref>"
      echo "    supabase functions deploy check-vests         --project-ref <your-project-ref>"
      echo "    supabase functions deploy check-capital-gains --project-ref <your-project-ref>"
    fi
    echo ""
  fi

  if [ "$SECRETS_APPLIED" = "true" ]; then
    ok "VAPID secrets were set automatically in Step 4c."
  else
    echo "  ${BOLD}VAPID secrets${RESET} — set these in Supabase dashboard →"
    echo "  Settings → Edge Functions → Secrets:"
    echo ""
    echo "    VAPID_PUBLIC_KEY   = ${VAPID_PUBLIC_KEY}"
    echo "    VAPID_PRIVATE_KEY  = (the private key from npx web-push generate-vapid-keys)"
    echo "    VAPID_SUBJECT      = ${VAPID_SUBJECT:-mailto:you@example.com}"
    echo ""
  fi

  if [ "$CRON_APPLIED" = "true" ]; then
    ok "pg_cron schedules were applied automatically in Step 4b."
  else
    echo "  ${BOLD}pg_cron schedules${RESET} — run this SQL in Supabase SQL Editor"
    echo "  after deploying the functions:"
    echo ""
    if [ -n "${SUPABASE_URL:-}" ] && [ -n "${SUPABASE_ANON_KEY:-}" ]; then
      AUTH_HDR="{\"Content-Type\":\"application/json\",\"Authorization\":\"Bearer ${SUPABASE_ANON_KEY}\"}"
      echo "    create extension if not exists pg_net schema extensions;"
      echo "    create extension if not exists pg_cron;"
      echo ""
      echo "    select cron.schedule('mne-check-prices','0 * * * *',"
      echo "      format(\$q\$select net.http_post(url:=%L,headers:=%L::jsonb,body:='{}'::jsonb)\$q\$,"
      echo "        '${SUPABASE_URL}/functions/v1/check-prices', '${AUTH_HDR}'));"
      echo ""
      echo "    select cron.schedule('mne-check-vests','30 * * * *',"
      echo "      format(\$q\$select net.http_post(url:=%L,headers:=%L::jsonb,body:='{}'::jsonb)\$q\$,"
      echo "        '${SUPABASE_URL}/functions/v1/check-vests', '${AUTH_HDR}'));"
      echo ""
      echo "    select cron.schedule('mne-check-capital-gains','0 9 * * *',"
      echo "      format(\$q\$select net.http_post(url:=%L,headers:=%L::jsonb,body:='{}'::jsonb)\$q\$,"
      echo "        '${SUPABASE_URL}/functions/v1/check-capital-gains', '${AUTH_HDR}'));"
    else
      echo "    create extension if not exists pg_net schema extensions;"
      echo "    create extension if not exists pg_cron;"
      echo ""
      echo "    select cron.schedule('mne-check-prices','0 * * * *',"
      echo "      format(\$q\$select net.http_post(url:=%L,headers:=%L::jsonb,body:='{}'::jsonb)\$q\$,"
      echo "        '<SUPABASE_URL>/functions/v1/check-prices',"
      echo "        '{\"Content-Type\":\"application/json\",\"Authorization\":\"Bearer <ANON_KEY>\"}'::jsonb));"
      echo "    -- (repeat for check-vests at '30 * * * *' and check-capital-gains at '0 9 * * *')"
    fi
    echo ""
  fi
fi

# ─── Step 7: Email allowlist reminder ─────────────────────────────────────────
if [ "$SKIP_ENV" = "false" ] && [ "$RESTRICT_SIGNUPS" = "true" ]; then
  header "Step 7: Add emails to the allowlist"
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
