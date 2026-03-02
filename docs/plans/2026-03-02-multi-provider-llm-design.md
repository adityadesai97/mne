# Multi-Provider LLM Support — Design

**Date:** 2026-03-02

## Goal

Add Groq and Gemini as selectable AI providers alongside the existing Claude integration. Users pick a provider during onboarding and can switch in Settings.

## Architecture

A new `src/lib/llm.ts` module exposes a `createLLMClient(provider, apiKey)` factory that returns an `openai`-package client pointed at the correct base URL. All three providers are accessed through this unified interface:

| Provider | Base URL |
|---|---|
| Claude | `https://api.anthropic.com/v1` (with `x-api-key` header) |
| Groq | `https://api.groq.com/openai/v1` |
| Gemini | `https://generativelanguage.googleapis.com/v1beta/openai` |

`claude.ts` and `autoThemes.ts` replace `new Anthropic(...)` with `createLLMClient(...)` and update response parsing from Anthropic's content-block format to OpenAI's `choices[0].message.tool_calls` format.

Tool definitions move from `Anthropic.Tool[]` (`input_schema`) to `OpenAI.ChatCompletionTool[]` (`parameters`, `type: 'function'` wrapper) — same JSON Schema content, different wrapper shape.

### Model mapping

| Provider | Model |
|---|---|
| Claude | `claude-sonnet-4-6` |
| Groq | `llama-3.3-70b-versatile` |
| Gemini | `gemini-2.0-flash` |

## Data Model

### DB migration

Three new columns on `user_settings`:
- `llm_provider text default 'claude'` — active provider
- `groq_api_key text` — nullable
- `gemini_api_key text` — nullable

### `src/store/config.ts`

New localStorage keys:
- `mne_llm_provider` — `'claude' | 'groq' | 'gemini'`
- `mne_groq_api_key`
- `mne_gemini_api_key`

`isConfigured` logic: `finnhubApiKey` present AND at least one AI key present AND active provider's key present.

### `src/lib/db/settings.ts`

`loadApiKeys()` expanded to also load `llm_provider`, `groq_api_key`, `gemini_api_key` and populate `config`.

## Onboarding Flow

The `apikeys` step:
1. Provider picker (Claude / Groq / Gemini pills)
2. Single key field — label, placeholder, and "Get key" link update based on selected provider
3. Finnhub API Key field (unchanged)
4. Validation: selected provider's key + Finnhub required to continue

## Settings

### API Keys section (expand/collapse pattern preserved)

Expanded form shows four fields:
- Claude API Key
- Groq API Key
- Gemini API Key
- Finnhub API Key

Validation on save: Finnhub required + at least one AI provider key required.

### AI section

New **AI Provider** row at the top of the section. Clicking opens an inline pill picker (Claude / Groq / Gemini).

**Switch guard**: selecting a provider with no saved key does not switch — shows inline message: *"Add a [Provider] API key in API Keys first."*

## Files Changed

| File | Change |
|---|---|
| `supabase/migrations/…_multi_provider_llm.sql` | New migration |
| `src/store/config.ts` | New keys + getters + updated `isConfigured` |
| `src/lib/db/settings.ts` | Expand `loadApiKeys`, `saveSettings` |
| `src/lib/llm.ts` | New file — provider factory |
| `src/lib/claude.ts` | Swap Anthropic client → `createLLMClient`, update tool defs + response parsing |
| `src/lib/autoThemes.ts` | Same swap |
| `src/pages/Onboarding.tsx` | Provider picker + dynamic key field |
| `src/pages/Settings.tsx` | Provider row in AI section + expand-form key fields |
| `package.json` | Add `openai` package |
