# Multi-Provider LLM Support Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Groq and Gemini as selectable AI providers alongside Claude, with provider selection in onboarding and settings.

**Architecture:** A `ClaudeAdapter` in `src/lib/llm.ts` wraps `@anthropic-ai/sdk` with an OpenAI-compatible interface; Groq and Gemini use the `openai` package directly pointed at their OpenAI-compatible endpoints. `claude.ts` and `autoThemes.ts` use the unified `createLLMClient()` factory and speak OpenAI format throughout.

**Tech Stack:** `openai` npm package (new), `@anthropic-ai/sdk` (kept), Supabase migration, React state, localStorage.

---

### Task 1: Install `openai` package + DB migration

**Files:**
- Modify: `package.json` (via npm install)
- Create: `supabase/migrations/20260302000001_multi_provider_llm.sql`

**Step 1: Install the package**

```bash
npm install openai
```

Expected: `openai` appears in `package.json` dependencies.

**Step 2: Write the migration file**

Create `supabase/migrations/20260302000001_multi_provider_llm.sql`:

```sql
alter table public.user_settings
  add column if not exists llm_provider text not null default 'claude',
  add column if not exists groq_api_key text,
  add column if not exists gemini_api_key text;
```

**Step 3: Apply the migration**

Apply via Supabase MCP `apply_migration` tool or the Supabase dashboard SQL editor.

**Step 4: Verify in Supabase dashboard**

Confirm `user_settings` has the three new columns.

**Step 5: Commit**

```bash
git add package.json package-lock.json supabase/migrations/20260302000001_multi_provider_llm.sql
git commit -m "feat: install openai package and add multi-provider LLM migration"
```

---

### Task 2: Update `src/store/config.ts`

**Files:**
- Modify: `src/store/config.ts`

**Step 1: Write the test first**

Create `src/__tests__/config.test.ts`:

```ts
import { describe, test, expect, beforeEach } from 'vitest'

// Inline a minimal config replica to test logic without side effects
function makeIsConfigured(claudeKey: string, groqKey: string, geminiKey: string, provider: string, finnhubKey: string, needsSignIn: boolean) {
  const activeKey = provider === 'groq' ? groqKey : provider === 'gemini' ? geminiKey : claudeKey
  return !!(activeKey && finnhubKey && !needsSignIn)
}

test('isConfigured true when active provider has key + finnhub', () => {
  expect(makeIsConfigured('', 'gsk_xxx', '', 'groq', 'finn_xxx', false)).toBe(true)
})

test('isConfigured false when active provider has no key', () => {
  expect(makeIsConfigured('sk-ant-xxx', '', '', 'groq', 'finn_xxx', false)).toBe(false)
})

test('isConfigured false when finnhub missing', () => {
  expect(makeIsConfigured('sk-ant-xxx', '', '', 'claude', '', false)).toBe(false)
})

test('isConfigured false when needsSignIn', () => {
  expect(makeIsConfigured('sk-ant-xxx', '', '', 'claude', 'finn_xxx', true)).toBe(false)
})
```

**Step 2: Run test to verify it passes (pure logic, no mocks needed)**

```bash
npx vitest --run config.test
```

Expected: PASS (these test pure functions, not the actual config module).

**Step 3: Rewrite `src/store/config.ts`**

```ts
export type LLMProvider = 'claude' | 'groq' | 'gemini'

const KEYS = {
  claudeApiKey: 'mne_claude_api_key',
  groqApiKey: 'mne_groq_api_key',
  geminiApiKey: 'mne_gemini_api_key',
  llmProvider: 'mne_llm_provider',
  finnhubApiKey: 'mne_finnhub_api_key',
  needsSignIn: 'mne_needs_signin',
  theme: 'mne_theme',
}
const LEGACY_CONNECTION_KEYS = ['mne_supabase_url', 'mne_supabase_anon_key', 'mne_last_user_id']

export const config = {
  get claudeApiKey() { return localStorage.getItem(KEYS.claudeApiKey) ?? '' },
  get groqApiKey() { return localStorage.getItem(KEYS.groqApiKey) ?? '' },
  get geminiApiKey() { return localStorage.getItem(KEYS.geminiApiKey) ?? '' },
  get llmProvider(): LLMProvider {
    const val = localStorage.getItem(KEYS.llmProvider)
    if (val === 'groq' || val === 'gemini') return val
    return 'claude'
  },
  get activeApiKey() {
    const p = this.llmProvider
    if (p === 'groq') return this.groqApiKey
    if (p === 'gemini') return this.geminiApiKey
    return this.claudeApiKey
  },
  get finnhubApiKey() { return localStorage.getItem(KEYS.finnhubApiKey) ?? '' },
  get needsSignIn() { return localStorage.getItem(KEYS.needsSignIn) === 'true' },
  get isConfigured() {
    return !!(this.activeApiKey && this.finnhubApiKey && !this.needsSignIn)
  },
  save(data: {
    claudeApiKey?: string
    groqApiKey?: string
    geminiApiKey?: string
    llmProvider?: LLMProvider
    finnhubApiKey?: string
  }) {
    if (data.claudeApiKey !== undefined) localStorage.setItem(KEYS.claudeApiKey, data.claudeApiKey)
    if (data.groqApiKey !== undefined) localStorage.setItem(KEYS.groqApiKey, data.groqApiKey)
    if (data.geminiApiKey !== undefined) localStorage.setItem(KEYS.geminiApiKey, data.geminiApiKey)
    if (data.llmProvider !== undefined) localStorage.setItem(KEYS.llmProvider, data.llmProvider)
    if (data.finnhubApiKey !== undefined) localStorage.setItem(KEYS.finnhubApiKey, data.finnhubApiKey)
  },
  setLLMProvider(provider: LLMProvider) { localStorage.setItem(KEYS.llmProvider, provider) },
  markSignedOut() {
    localStorage.setItem(KEYS.needsSignIn, 'true')
    ;[KEYS.claudeApiKey, KEYS.groqApiKey, KEYS.geminiApiKey, KEYS.llmProvider, KEYS.finnhubApiKey]
      .forEach(k => localStorage.removeItem(k))
    LEGACY_CONNECTION_KEYS.forEach(k => localStorage.removeItem(k))
  },
  clearSignedOut() { localStorage.removeItem(KEYS.needsSignIn) },
  clear() {
    Object.values(KEYS).forEach(k => localStorage.removeItem(k))
    LEGACY_CONNECTION_KEYS.forEach(k => localStorage.removeItem(k))
  },
  get theme(): 'light' | 'dark' | 'system' {
    return (localStorage.getItem(KEYS.theme) ?? 'dark') as 'light' | 'dark' | 'system'
  },
  setTheme(v: 'light' | 'dark' | 'system') { localStorage.setItem(KEYS.theme, v) },
}
```

**Step 4: Commit**

```bash
git add src/store/config.ts src/__tests__/config.test.ts
git commit -m "feat: add multi-provider keys and llmProvider to config store"
```

---

### Task 3: Update `src/lib/db/settings.ts`

`loadApiKeys()` is called on login to restore all keys to localStorage. It needs to load the three new fields and return them so `config.save()` can hydrate them all.

**Files:**
- Modify: `src/lib/db/settings.ts`

**Step 1: Update `loadApiKeys()`**

Replace the existing function:

```ts
export async function loadApiKeys(): Promise<{
  claudeApiKey: string
  groqApiKey: string
  geminiApiKey: string
  llmProvider: string
  finnhubApiKey: string
} | null> {
  const { data: { user } } = await getSupabaseClient().auth.getUser()
  if (!user) return null
  const { data } = await getSupabaseClient()
    .from('user_settings')
    .select('claude_api_key, groq_api_key, gemini_api_key, llm_provider, finnhub_api_key')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!data?.finnhub_api_key) return null
  const hasAnyAIKey = data.claude_api_key || data.groq_api_key || data.gemini_api_key
  if (!hasAnyAIKey) return null
  return {
    claudeApiKey: data.claude_api_key ?? '',
    groqApiKey: data.groq_api_key ?? '',
    geminiApiKey: data.gemini_api_key ?? '',
    llmProvider: data.llm_provider ?? 'claude',
    finnhubApiKey: data.finnhub_api_key,
  }
}
```

The return type now matches `config.save()`'s parameter type (all optional fields), so the Onboarding call `config.save(keys)` continues to work without changes.

**Step 2: Verify TypeScript compiles**

```bash
npm run build 2>&1 | head -30
```

Expected: No type errors in `settings.ts`.

**Step 3: Commit**

```bash
git add src/lib/db/settings.ts
git commit -m "feat: load groq/gemini keys and llm_provider from user_settings on login"
```

---

### Task 4: Create `src/lib/llm.ts`

This is the provider abstraction layer. It exposes `createLLMClient()` which returns an OpenAI-compatible client for all three providers. For Claude, it wraps `@anthropic-ai/sdk` with a shim that converts the OpenAI message format to Anthropic's and back.

**Files:**
- Create: `src/lib/llm.ts`

**Step 1: Write the test**

Create `src/__tests__/llm.test.ts`:

```ts
import { test, expect } from 'vitest'
import { MODEL_FOR_PROVIDER } from '@/lib/llm'
import type { LLMProvider } from '@/store/config'

test('MODEL_FOR_PROVIDER has an entry for each provider', () => {
  const providers: LLMProvider[] = ['claude', 'groq', 'gemini']
  for (const p of providers) {
    expect(MODEL_FOR_PROVIDER[p]).toBeTruthy()
  }
})
```

**Step 2: Run test — expect fail**

```bash
npx vitest --run llm.test
```

Expected: FAIL — `@/lib/llm` not found.

**Step 3: Create `src/lib/llm.ts`**

```ts
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import type { LLMProvider } from '@/store/config'

export const MODEL_FOR_PROVIDER: Record<LLMProvider, string> = {
  claude: 'claude-sonnet-4-6',
  groq: 'llama-3.3-70b-versatile',
  gemini: 'gemini-2.0-flash',
}

// ── Normalized response type (OpenAI shape) ──────────────────────────────────
interface NormalizedToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}
export interface NormalizedResponse {
  choices: [{ message: { content: string | null; tool_calls?: NormalizedToolCall[] } }]
}

// ── Convert OpenAI-format messages → Anthropic format ────────────────────────
function toAnthropicMessages(messages: any[]): Anthropic.MessageParam[] {
  const result: Anthropic.MessageParam[] = []
  let i = 0
  while (i < messages.length) {
    const msg = messages[i]
    if (msg.role === 'assistant' && msg.tool_calls?.length) {
      const content: Anthropic.ContentBlock[] = []
      if (msg.content) content.push({ type: 'text', text: msg.content })
      for (const tc of msg.tool_calls) {
        content.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.function.name,
          input: (() => { try { return JSON.parse(tc.function.arguments || '{}') } catch { return {} } })(),
        } as any)
      }
      result.push({ role: 'assistant', content })
      // Collect following tool result messages and batch them into one user message
      const toolResults: any[] = []
      while (i + 1 < messages.length && messages[i + 1].role === 'tool') {
        i++
        toolResults.push({ type: 'tool_result', tool_use_id: messages[i].tool_call_id, content: messages[i].content })
      }
      if (toolResults.length > 0) result.push({ role: 'user', content: toolResults as any })
    } else if (msg.role === 'tool') {
      result.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: msg.tool_call_id, content: msg.content }] as any })
    } else {
      result.push({ role: msg.role, content: msg.content })
    }
    i++
  }
  return result
}

// ── Convert Anthropic response → OpenAI shape ────────────────────────────────
function toNormalizedResponse(response: Anthropic.Message): NormalizedResponse {
  const toolCalls = (response.content as any[])
    .filter(b => b.type === 'tool_use')
    .map(b => ({ id: b.id, type: 'function' as const, function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) } }))
  const text = (response.content as any[])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n') || null
  return { choices: [{ message: { content: text, tool_calls: toolCalls.length ? toolCalls : undefined } }] }
}

// ── Claude adapter ─────────────────────────────────────────────────────────
class ClaudeAdapter {
  private anthropic: Anthropic

  constructor(apiKey: string) {
    this.anthropic = new Anthropic({ apiKey, dangerouslyAllowBrowser: true })
  }

  chat = {
    completions: {
      create: async (params: {
        model: string
        max_tokens?: number
        messages: any[]
        tools?: any[]
      }): Promise<NormalizedResponse> => {
        const systemMessages = params.messages.filter(m => m.role === 'system')
        const system = systemMessages.map(m => m.content).join('\n') || undefined
        const conversationMessages = toAnthropicMessages(params.messages.filter(m => m.role !== 'system'))
        const tools = params.tools?.map(t => ({
          name: t.function.name,
          description: t.function.description ?? '',
          input_schema: t.function.parameters,
        })) as Anthropic.Tool[] | undefined
        const response = await this.anthropic.messages.create({
          model: params.model,
          max_tokens: params.max_tokens ?? 1024,
          ...(system ? { system } : {}),
          messages: conversationMessages,
          ...(tools?.length ? { tools } : {}),
        })
        return toNormalizedResponse(response)
      },
    },
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────
export function createLLMClient(provider: LLMProvider, apiKey: string): ClaudeAdapter | OpenAI {
  if (provider === 'claude') return new ClaudeAdapter(apiKey)
  const baseURL = provider === 'groq'
    ? 'https://api.groq.com/openai/v1'
    : 'https://generativelanguage.googleapis.com/v1beta/openai'
  return new OpenAI({ apiKey, baseURL, dangerouslyAllowBrowser: true })
}
```

**Step 4: Run the test**

```bash
npx vitest --run llm.test
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/lib/llm.ts src/__tests__/llm.test.ts
git commit -m "feat: add LLM provider abstraction layer with ClaudeAdapter"
```

---

### Task 5: Update tool definitions in `src/lib/claude.ts`

The `tools` array is currently typed as `Anthropic.Tool[]` with `input_schema`. Reshape to OpenAI format: `{ type: 'function', function: { name, description, parameters } }`.

**Files:**
- Modify: `src/lib/claude.ts` (lines 1–10 imports, lines 1197–1537 tools array)

**Step 1: Update the import at the top of the file**

Remove:
```ts
import Anthropic from '@anthropic-ai/sdk'
```

Add:
```ts
import { createLLMClient, MODEL_FOR_PROVIDER } from './llm'
import type { NormalizedResponse } from './llm'
```

**Step 2: Reshape the `tools` array**

Find the line `const tools: Anthropic.Tool[] = [` (line 1197). Change the type annotation and wrap each entry:

Old pattern per tool:
```ts
{
  name: 'navigate_to',
  description: 'Navigate to a page...',
  input_schema: {
    type: 'object' as const,
    properties: { route: { ... } },
    required: ['route'],
  },
},
```

New pattern:
```ts
{
  type: 'function' as const,
  function: {
    name: 'navigate_to',
    description: 'Navigate to a page...',
    parameters: {
      type: 'object' as const,
      properties: { route: { ... } },
      required: ['route'],
    },
  },
},
```

Change declaration line to:
```ts
const tools = [
```
(No explicit type annotation needed — TypeScript infers it.)

Apply this reshape to all ~25 tools: rename `name`/`description`/`input_schema` to `function: { name, description, parameters }` and add `type: 'function' as const` at the outer level.

**Step 3: Update `Anthropic.ToolUseBlock` type references**

Search for `Anthropic.ToolUseBlock` in the file. Replace any remaining references with `any` or the new normalized tool call shape.

**Step 4: Verify TypeScript compiles**

```bash
npm run build 2>&1 | head -40
```

Expected: No errors in the tools section.

**Step 5: Commit**

```bash
git add src/lib/claude.ts
git commit -m "feat: convert claude.ts tool definitions to OpenAI format"
```

---

### Task 6: Update `runCommand()` in `src/lib/claude.ts`

This is the main agentic loop. Switch from Anthropic SDK calls + Anthropic response parsing to the unified LLM client + OpenAI response format.

**Files:**
- Modify: `src/lib/claude.ts` (lines ~1163–1170, ~2548–2700)

**Step 1: Replace `extractTextFromClaudeResponse`**

Find (lines 1163–1169):
```ts
function extractTextFromClaudeResponse(response: any): string {
  return (response?.content ?? [])
    .filter((block: any) => block.type === 'text')
    .map((block: any) => String(block.text ?? '').trim())
    .filter(Boolean)
    .join('\n')
}
```

Replace with:
```ts
function extractTextFromResponse(response: NormalizedResponse): string {
  return response.choices[0]?.message?.content ?? ''
}
```

Then find every call to `extractTextFromClaudeResponse(response)` in `runCommand` and rename to `extractTextFromResponse(response)`.

**Step 2: Replace the client instantiation and `runClaude` in `runCommand`**

Find (lines ~2548–2557):
```ts
const client = new Anthropic({ apiKey: config.claudeApiKey, dangerouslyAllowBrowser: true })
const baseSystemPrompt = buildSystemPrompt(assets, userName)

const runClaude = async (systemPrompt: string, inputMessages: any) => client.messages.create({
  model: 'claude-sonnet-4-6',
  max_tokens: 1024,
  system: systemPrompt,
  messages: inputMessages,
  tools,
})
```

Replace with:
```ts
const client = createLLMClient(config.llmProvider, config.activeApiKey)
const baseSystemPrompt = buildSystemPrompt(assets, userName)

const runLLM = async (systemPrompt: string, inputMessages: any[]) => client.chat.completions.create({
  model: MODEL_FOR_PROVIDER[config.llmProvider],
  max_tokens: 1024,
  messages: [{ role: 'system' as const, content: systemPrompt }, ...inputMessages],
  tools,
})
```

Also update the `response` declaration below it:
```ts
let claudeMessages: any[] = [...messages]
let response = await runLLM(systemPrompt, claudeMessages)
```

**Step 3: Update the read-tool loop (lines ~2596–2647)**

A. Replace the response-parsing line:
```ts
// OLD:
const toolUsesInRound = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
// NEW:
const rawToolCalls = response.choices[0]?.message?.tool_calls ?? []
const toolUsesInRound = rawToolCalls.map(tc => ({
  id: tc.id,
  name: tc.function.name,
  input: (() => { try { return JSON.parse(tc.function.arguments || '{}') } catch { return {} } })(),
}))
```

B. Replace the `readToolUses` and `hasNonReadToolUse` lines:
```ts
// OLD:
const readToolUses = toolUsesInRound.filter((tool) => READ_TOOL_NAMES.has(tool.name))
const hasNonReadToolUse = toolUsesInRound.some((tool) => !READ_TOOL_NAMES.has(tool.name))
// NEW (same shape, works as-is since toolUsesInRound now has .name):
const readToolUses = toolUsesInRound.filter(tool => READ_TOOL_NAMES.has(tool.name))
const hasNonReadToolUse = toolUsesInRound.some(tool => !READ_TOOL_NAMES.has(tool.name))
```

C. Replace the `toolResultBlocks` build and thread append (the `Promise.all` block):

OLD:
```ts
const toolResultBlocks = await Promise.all(readToolUses.map(async (tool) => {
  try {
    const result = await executeReadTool(tool.name, tool.input, { assets, getSnapshotsCached })
    // ...addTrace
    return { type: 'tool_result' as const, tool_use_id: tool.id, content: JSON.stringify({ ok: true, result }) }
  } catch (error: any) {
    // ...addTrace
    return { type: 'tool_result' as const, tool_use_id: tool.id, content: JSON.stringify({ ok: false, error: String(error?.message ?? 'Read tool failed') }) }
  }
}))

claudeMessages = [
  ...claudeMessages,
  { role: 'assistant', content: response.content as any },
  { role: 'user', content: toolResultBlocks as any },
]
```

NEW:
```ts
const toolResultMessages = await Promise.all(readToolUses.map(async (tool) => {
  try {
    const result = await executeReadTool(tool.name, tool.input, { assets, getSnapshotsCached })
    addTrace(
      `Read tool: ${tool.name}`,
      `${summarizeReadToolResult(tool.name, result)}${tool.input ? ` | input ${clipText(tool.input, 120)}` : ''}`,
    )
    return { role: 'tool' as const, tool_call_id: tool.id, content: JSON.stringify({ ok: true, result }) }
  } catch (error: any) {
    addTrace(`Read tool failed: ${tool.name}`, String(error?.message ?? 'Read tool failed'))
    return { role: 'tool' as const, tool_call_id: tool.id, content: JSON.stringify({ ok: false, error: String(error?.message ?? 'Read tool failed') }) }
  }
}))

claudeMessages = [
  ...claudeMessages,
  { role: 'assistant' as const, content: response.choices[0].message.content ?? null, tool_calls: response.choices[0].message.tool_calls },
  ...toolResultMessages,
]
```

D. Replace the `runClaude` call at the end of the loop:
```ts
// OLD:
response = await runClaude(systemPrompt, claudeMessages)
// NEW:
response = await runLLM(systemPrompt, claudeMessages)
```

**Step 4: Update the clarification loop (lines ~2649–2679)**

A. Replace tool-use check:
```ts
// OLD:
const toolUsesInLoop = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
if (toolUsesInLoop.length > 0) {
// NEW:
if ((response.choices[0]?.message?.tool_calls?.length ?? 0) > 0) {
```

B. Replace assistant text extraction:
```ts
// OLD:
const assistantText = extractTextFromClaudeResponse(response)
// NEW:
const assistantText = extractTextFromResponse(response)
```

C. Replace the `runClaude` calls in the loop:
```ts
// Both occurrences: runClaude → runLLM
response = await runLLM(baseSystemPrompt, claudeMessages)
```

**Step 5: Update final tool-use extraction (lines ~2681–2701)**

```ts
// OLD:
const toolUses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
if (toolUses.length === 0) {
  const text = extractTextFromClaudeResponse(response)
  ...
}
const navigateTool = toolUses.find((tool) => tool.name === 'navigate_to')
const writeTools = toolUses.filter((tool) => WRITE_TOOL_NAMES.has(tool.name))
...
addTrace('Performed navigation', String((navigateTool.input as any).route ?? ''))
window.location.href = (navigateTool.input as any).route
return { type: 'navigate', route: (navigateTool.input as any).route }
...
if (writeTools.length === 0) {
  const text = extractTextFromClaudeResponse(response)

// NEW:
const rawFinalCalls = response.choices[0]?.message?.tool_calls ?? []
const toolUses = rawFinalCalls.map(tc => ({
  id: tc.id,
  name: tc.function.name,
  input: (() => { try { return JSON.parse(tc.function.arguments || '{}') } catch { return {} } })(),
}))
if (toolUses.length === 0) {
  const text = extractTextFromResponse(response)
  ...
}
const navigateTool = toolUses.find(tool => tool.name === 'navigate_to')
const writeTools = toolUses.filter(tool => WRITE_TOOL_NAMES.has(tool.name))
...
addTrace('Performed navigation', String(navigateTool.input.route ?? ''))
window.location.href = navigateTool.input.route
return { type: 'navigate', route: navigateTool.input.route }
...
if (writeTools.length === 0) {
  const text = extractTextFromResponse(response)
```

Also update `buildWriteConfirmation` — it uses `tool.input` (same shape, no change needed since we normalized input in the map above).

**Step 6: Compile and verify**

```bash
npm run build 2>&1 | head -50
```

Expected: Clean build.

**Step 7: Smoke-test in dev**

```bash
npm run dev
```

Open the app, use the command bar (⌘K), type `what is my net worth`. Should respond correctly.

**Step 8: Commit**

```bash
git add src/lib/claude.ts
git commit -m "feat: migrate claude.ts to unified LLM client (OpenAI format)"
```

---

### Task 7: Update `src/lib/autoThemes.ts`

**Files:**
- Modify: `src/lib/autoThemes.ts`

**Step 1: Update imports and `suggestTickerThemesWithClaude`**

Remove:
```ts
import Anthropic from '@anthropic-ai/sdk'
```

Add:
```ts
import { createLLMClient, MODEL_FOR_PROVIDER } from './llm'
```

Replace the `suggestTickerThemesWithClaude` function body:

```ts
async function suggestTickerThemes(
  symbol: string,
  existingThemes: string[],
  profile: { name: string; industry: string },
): Promise<string[]> {
  if (!config.activeApiKey) return []

  const client = createLLMClient(config.llmProvider, config.activeApiKey)
  const existingThemeList = existingThemes.slice(0, 80)

  try {
    const response = await client.chat.completions.create({
      model: MODEL_FOR_PROVIDER[config.llmProvider],
      max_tokens: 180,
      messages: [
        {
          role: 'system',
          content: 'Return only valid JSON in shape {"themes":["Theme 1","Theme 2"]}. No extra text.',
        },
        {
          role: 'user',
          content: `Suggest 1-3 investment themes for ticker ${symbol}.
Company name: ${profile.name || 'unknown'}.
Industry: ${profile.industry || 'unknown'}.
Existing user theme vocabulary (reuse exact names when applicable): ${JSON.stringify(existingThemeList)}.
Rules:
- Prefer reusing existing theme names when they fit.
- If nothing fits, suggest concise new themes (1-3 words each).
- Do not include duplicates.
- Return only JSON.`,
        },
      ],
    })

    const text = response.choices[0]?.message?.content ?? ''
    if (!text) return []
    return parseThemeSuggestions(text)
  } catch {
    return []
  }
}
```

Also update the call site — the old function was named `suggestTickerThemesWithClaude`. Find and rename to `suggestTickerThemes`:
```ts
// Line 134 in original:
let suggestedThemes = await suggestTickerThemesWithClaude(symbol, existingThemeNames, profile)
// becomes:
let suggestedThemes = await suggestTickerThemes(symbol, existingThemeNames, profile)
```

**Step 2: Build check**

```bash
npm run build 2>&1 | head -30
```

**Step 3: Commit**

```bash
git add src/lib/autoThemes.ts
git commit -m "feat: migrate autoThemes.ts to unified LLM client"
```

---

### Task 8: Update `src/pages/Onboarding.tsx`

The `apikeys` step gets a provider picker and a dynamic key field instead of the hard-coded Claude field.

**Files:**
- Modify: `src/pages/Onboarding.tsx`

**Step 1: Add provider metadata constant and import `LLMProvider`**

At the top of the file, add after existing imports:
```ts
import type { LLMProvider } from '@/store/config'

const PROVIDER_META: Record<LLMProvider, { label: string; placeholder: string; href: string }> = {
  claude: { label: 'Claude API Key', placeholder: 'sk-ant-...', href: 'https://console.anthropic.com/settings/keys' },
  groq:   { label: 'Groq API Key',   placeholder: 'gsk_...',   href: 'https://console.groq.com/keys' },
  gemini: { label: 'Gemini API Key', placeholder: 'AIza...',   href: 'https://aistudio.google.com/app/apikey' },
}
```

**Step 2: Update state in the `Onboarding` component**

Replace:
```ts
const [apiKeys, setApiKeys] = useState({ claudeApiKey: '', finnhubApiKey: '' })
```
With:
```ts
const [provider, setProvider] = useState<LLMProvider>('claude')
const [aiKey, setAiKey] = useState('')
const [finnhubKey, setFinnhubKey] = useState('')
```

**Step 3: Update `handleSaveApiKeys`**

Replace the existing function:
```ts
async function handleSaveApiKeys() {
  if (!aiKey || !finnhubKey) { setError('Both fields are required'); return }
  setLoading(true)
  setError('')
  try {
    const { data: { user } } = await getSupabaseClient().auth.getUser()
    if (!user) { setError('Not authenticated'); setLoading(false); return }
    const dbRow: Record<string, string> = {
      user_id: user.id,
      finnhub_api_key: finnhubKey,
      llm_provider: provider,
    }
    if (provider === 'claude') dbRow.claude_api_key = aiKey
    if (provider === 'groq') dbRow.groq_api_key = aiKey
    if (provider === 'gemini') dbRow.gemini_api_key = aiKey
    await saveSettings(dbRow)
    config.save({
      claudeApiKey: provider === 'claude' ? aiKey : '',
      groqApiKey:   provider === 'groq'   ? aiKey : '',
      geminiApiKey: provider === 'gemini' ? aiKey : '',
      llmProvider: provider,
      finnhubApiKey: finnhubKey,
    })
    onComplete()
  } catch (e: any) {
    setError(e.message ?? 'Failed to save API keys')
    setLoading(false)
  }
}
```

**Step 4: Replace the `apikeys` JSX step**

Find the `return wrap(` block that renders the API keys step (the last `return wrap(...)` in the component). Replace its content:

```tsx
return wrap(
  <div className="space-y-4">
    <div className="mb-6">
      <h1 className="font-syne text-xl font-semibold text-foreground">API keys</h1>
      <p className="text-sm text-muted-foreground mt-1">Needed for AI commands and live prices.</p>
    </div>
    {/* Provider picker */}
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">AI Provider</label>
      <div className="flex gap-1 bg-muted/60 rounded-lg p-1">
        {(['claude', 'groq', 'gemini'] as LLMProvider[]).map(p => (
          <button
            key={p}
            type="button"
            onClick={() => { setProvider(p); setAiKey('') }}
            className={`flex-1 text-xs py-1.5 rounded-md transition-colors capitalize ${provider === p ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
          >
            {p === 'claude' ? 'Claude' : p === 'groq' ? 'Groq' : 'Gemini'}
          </button>
        ))}
      </div>
    </div>
    {/* Dynamic AI key field */}
    <Field
      id="aiKey"
      label={PROVIDER_META[provider].label}
      placeholder={PROVIDER_META[provider].placeholder}
      value={aiKey}
      onChange={setAiKey}
      hint={{ text: 'Get key', href: PROVIDER_META[provider].href }}
    />
    <Field
      id="finnhubApiKey"
      label="Finnhub API Key"
      placeholder="your_key"
      value={finnhubKey}
      onChange={setFinnhubKey}
      hint={{ text: 'Get key', href: 'https://finnhub.io/dashboard' }}
    />
    {error && <p className="text-destructive text-xs">{error}</p>}
    <PrimaryBtn onClick={handleSaveApiKeys} disabled={loading}>
      {loading ? 'Saving…' : 'Continue'}
    </PrimaryBtn>
  </div>
)
```

**Step 5: Build check + smoke test**

```bash
npm run build 2>&1 | head -30
npm run dev
```

Navigate to the onboarding flow (sign out if needed). Verify provider picker renders, labels update when switching provider.

**Step 6: Commit**

```bash
git add src/pages/Onboarding.tsx
git commit -m "feat: add provider picker to onboarding API keys step"
```

---

### Task 9: Update `src/pages/Settings.tsx`

Two changes: (1) add AI Provider picker in the AI section, (2) expand the API Keys edit form to include Groq and Gemini fields.

**Files:**
- Modify: `src/pages/Settings.tsx`

**Step 1: Add import and state**

Add import at top:
```ts
import type { LLMProvider } from '@/store/config'
```

Add state inside the `Settings` component after existing state declarations:
```ts
const [providerWarning, setProviderWarning] = useState('')
```

Update `keyDraft` state type and initial value:
```ts
const [keyDraft, setKeyDraft] = useState({ claudeApiKey: '', groqApiKey: '', geminiApiKey: '', finnhubApiKey: '' })
```

**Step 2: Add `handleProviderChange` function**

Add after `handleThemeChange`:
```ts
function handleProviderChange(p: LLMProvider) {
  const keyForProvider = p === 'claude' ? config.claudeApiKey : p === 'groq' ? config.groqApiKey : config.geminiApiKey
  if (!keyForProvider) {
    const name = p === 'claude' ? 'Claude' : p === 'groq' ? 'Groq' : 'Gemini'
    setProviderWarning(`Add a ${name} API key in API Keys first.`)
    return
  }
  setProviderWarning('')
  config.setLLMProvider(p)
  saveSettings({ llm_provider: p }).catch(console.error)
}
```

**Step 3: Update `handleSaveKeys`**

Replace the existing function:
```ts
async function handleSaveKeys() {
  const mergedClaude  = keyDraft.claudeApiKey  || config.claudeApiKey
  const mergedGroq    = keyDraft.groqApiKey    || config.groqApiKey
  const mergedGemini  = keyDraft.geminiApiKey  || config.geminiApiKey
  const mergedFinnhub = keyDraft.finnhubApiKey || config.finnhubApiKey
  if (!mergedFinnhub) { setKeyError('Finnhub API key is required'); return }
  if (!mergedClaude && !mergedGroq && !mergedGemini) { setKeyError('At least one AI provider key is required'); return }
  setKeySaving(true)
  setKeyError('')
  try {
    const { data: { user } } = await getSupabaseClient().auth.getUser()
    if (!user) { setKeyError('Not authenticated'); return }
    const dbRow: Record<string, string> = { user_id: user.id, finnhub_api_key: mergedFinnhub }
    if (keyDraft.claudeApiKey) dbRow.claude_api_key = keyDraft.claudeApiKey
    if (keyDraft.groqApiKey)   dbRow.groq_api_key   = keyDraft.groqApiKey
    if (keyDraft.geminiApiKey) dbRow.gemini_api_key  = keyDraft.geminiApiKey
    await saveSettings(dbRow)
    config.save({
      claudeApiKey:  keyDraft.claudeApiKey  || config.claudeApiKey,
      groqApiKey:    keyDraft.groqApiKey    || config.groqApiKey,
      geminiApiKey:  keyDraft.geminiApiKey  || config.geminiApiKey,
      finnhubApiKey: mergedFinnhub,
    })
    setEditingKeys(false)
  } catch (e: any) {
    setKeyError(e.message ?? 'Failed to save')
  } finally {
    setKeySaving(false)
  }
}
```

**Step 4: Add provider picker row to the AI section**

Find the `{/* AI */}` comment and the auto-assign themes toggle. Add the provider picker card BEFORE the auto-assign toggle:

```tsx
{/* AI Provider */}
<div className="bg-card rounded-xl px-4 py-4 space-y-2">
  <p className="text-sm font-medium">AI Provider</p>
  <div className="flex gap-1 bg-muted/60 rounded-lg p-1">
    {(['claude', 'groq', 'gemini'] as LLMProvider[]).map(p => (
      <button
        key={p}
        type="button"
        onClick={() => handleProviderChange(p)}
        className={`flex-1 text-xs py-1.5 rounded-md transition-colors ${config.llmProvider === p ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
      >
        {p === 'claude' ? 'Claude' : p === 'groq' ? 'Groq' : 'Gemini'}
      </button>
    ))}
  </div>
  {providerWarning && <p className="text-xs text-amber-500 mt-1">{providerWarning}</p>}
</div>
```

**Step 5: Update the API Keys edit form**

In the `{editingKeys ? (` branch, add Groq and Gemini key fields between Claude and Finnhub:

After the Claude key input block and before the Finnhub key input block, add:

```tsx
{/* Groq API Key */}
<div className="space-y-1.5">
  <div className="flex items-center justify-between">
    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Groq API Key</label>
    <a href="https://console.groq.com/keys" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[11px] text-primary/70 hover:text-primary transition-colors">
      Get key <ExternalLink size={9} />
    </a>
  </div>
  <input
    type="password"
    placeholder="gsk_..."
    value={keyDraft.groqApiKey}
    onChange={e => setKeyDraft(d => ({ ...d, groqApiKey: e.target.value }))}
    className="w-full bg-muted/40 border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/60"
  />
</div>
{/* Gemini API Key */}
<div className="space-y-1.5">
  <div className="flex items-center justify-between">
    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Gemini API Key</label>
    <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[11px] text-primary/70 hover:text-primary transition-colors">
      Get key <ExternalLink size={9} />
    </a>
  </div>
  <input
    type="password"
    placeholder="AIza..."
    value={keyDraft.geminiApiKey}
    onChange={e => setKeyDraft(d => ({ ...d, geminiApiKey: e.target.value }))}
    className="w-full bg-muted/40 border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/60"
  />
</div>
```

**Step 6: Update the collapsed API Keys view**

In the `else` branch (collapsed state), add rows for Groq and Gemini between Claude and Finnhub:

```tsx
{/* After the Claude row divider */}
<div className="flex items-center gap-3 px-4 py-4">
  <div className="flex-1 min-w-0">
    <p className="text-sm font-medium">Groq</p>
    <a href="https://console.groq.com/keys" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[11px] text-primary/70 hover:text-primary transition-colors mt-0.5 w-fit">
      Get key <ExternalLink size={9} />
    </a>
  </div>
  <span className="text-xs font-mono text-muted-foreground">{config.groqApiKey ? '••••••••' : 'Not set'}</span>
</div>
<div className="h-px bg-border mx-4" />
<div className="flex items-center gap-3 px-4 py-4">
  <div className="flex-1 min-w-0">
    <p className="text-sm font-medium">Gemini</p>
    <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[11px] text-primary/70 hover:text-primary transition-colors mt-0.5 w-fit">
      Get key <ExternalLink size={9} />
    </a>
  </div>
  <span className="text-xs font-mono text-muted-foreground">{config.geminiApiKey ? '••••••••' : 'Not set'}</span>
</div>
<div className="h-px bg-border mx-4" />
```

Also update the "Update API keys" `onClick` to include groq/gemini in the draft:
```tsx
onClick={() => { setKeyDraft({ claudeApiKey: '', groqApiKey: '', geminiApiKey: '', finnhubApiKey: '' }); setKeyError(''); setEditingKeys(true) }}
```

**Step 7: Build check + manual test**

```bash
npm run build 2>&1 | head -30
npm run dev
```

Go to Settings → API Keys. Verify: collapsed view shows all four providers. Click "Update API keys" — all four fields visible. Go to Settings → AI section — provider picker present. Try switching to Groq without a key — should show warning message. Add a Groq key then switch — should switch successfully.

**Step 8: Run tests**

```bash
npx vitest --run
```

Expected: all existing tests pass.

**Step 9: Commit**

```bash
git add src/pages/Settings.tsx
git commit -m "feat: add provider picker in AI section and multi-key edit form in Settings"
```

---

### Task 10: Final verification

**Step 1: Full build**

```bash
npm run build
```

Expected: Clean build, no TypeScript errors.

**Step 2: Run all tests**

```bash
npx vitest --run
```

Expected: All pass.

**Step 3: Manual end-to-end check**

1. Sign out → go through onboarding → pick Groq → enter a Groq key + Finnhub key → continue → app loads
2. Open command bar (⌘K) → type a natural language command → verify response comes from Groq (can check network tab for `api.groq.com`)
3. Settings → AI section → switch provider to Claude (should warn if no Claude key) → add Claude key in API Keys → switch to Claude → works
4. Settings → AI section → switch to Gemini → verify

**Step 4: Commit final state**

```bash
git add -A
git commit -m "feat: complete multi-provider LLM support (Claude, Groq, Gemini)"
```
