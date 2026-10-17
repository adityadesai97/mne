import Anthropic from '@anthropic-ai/sdk'
import { getSupabaseClient } from './supabase'

export const LLM_MODEL = 'claude-sonnet-5'

// The Claude API key never reaches the browser. The SDK is pointed at the
// llm-proxy edge function, which swaps in the key saved on the user's account
// and relays Anthropic's reply. The browser authenticates with its Supabase
// session instead; `apiKey` here is a placeholder the proxy ignores.
// (`dangerouslyAllowBrowser` is just the SDK's guard against shipping a real
// key to a browser; nothing secret is held here.)
function proxyBaseUrl(): string {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
  if (!url) throw new Error('Supabase is not configured.')
  return `${url}/functions/v1/llm-proxy`
}

const proxyFetch: typeof fetch = async (input, init) => {
  const { data: { session } } = await getSupabaseClient().auth.getSession()
  if (!session) throw new Error('You are signed out. Sign in again to use AI features.')
  const headers = new Headers(init?.headers)
  headers.set('Authorization', `Bearer ${session.access_token}`)
  return fetch(input, { ...init, headers })
}

function createAnthropic(): Anthropic {
  return new Anthropic({ apiKey: 'proxy', baseURL: proxyBaseUrl(), dangerouslyAllowBrowser: true, fetch: proxyFetch })
}

// ── Normalized response type (OpenAI shape) ──────────────────────────────────
interface NormalizedToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}
export interface NormalizedUsage {
  inputTokens: number
  outputTokens: number
}
export interface NormalizedResponse {
  choices: [{ message: { content: string | null; tool_calls?: NormalizedToolCall[] }; finish_reason?: string | null }]
  usage?: NormalizedUsage
}

// ── Streaming callbacks ───────────────────────────────────────────────────────
export interface StreamCallbacks {
  /** Called with each incremental text chunk as the model generates its
   *  reply. Never fires for tool-call argument JSON — only visible reply
   *  text. */
  onTextDelta?: (delta: string) => void
  /** Called once, before any onTextDelta for a given `create()` call — lets
   *  a consumer accumulating deltas into a buffer know to clear it. Needed
   *  because runCommand's agent loop can call `create()` several times
   *  (tool-use rounds) before the round that produces the final reply. */
  onStreamStart?: () => void
}

export interface LLMClient {
  chat: {
    completions: {
      create(
        params: {
          model: string
          max_tokens?: number
          temperature?: number
          messages: any[]
          tools?: any[]
          // Caps thinking/reasoning depth for simple, low-stakes calls (e.g. the
          // portfolio explanation summary) that don't need Sonnet's default
          // adaptive thinking.
          output_config?: { effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max' }
        },
        callbacks?: StreamCallbacks,
      ): Promise<NormalizedResponse>
    }
  }
}

// ── Convert OpenAI-format messages → Anthropic format ────────────────────────
function toAnthropicMessages(messages: any[]): Anthropic.MessageParam[] {
  const result: Anthropic.MessageParam[] = []
  let i = 0
  while (i < messages.length) {
    const msg = messages[i]
    if (msg.role === 'assistant' && msg.tool_calls?.length) {
      const content: any[] = []
      if (msg.content) content.push({ type: 'text', text: msg.content })
      for (const tc of msg.tool_calls) {
        content.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.function.name,
          input: (() => { try { return JSON.parse(tc.function.arguments || '{}') } catch { return {} } })(),
        })
      }
      result.push({ role: 'assistant', content })
      // Collect following tool result messages and batch into one user message
      const toolResults: any[] = []
      while (i + 1 < messages.length && messages[i + 1].role === 'tool') {
        i++
        toolResults.push({ type: 'tool_result', tool_use_id: messages[i].tool_call_id, content: messages[i].content })
      }
      if (toolResults.length > 0) result.push({ role: 'user', content: toolResults })
    } else if (msg.role === 'tool') {
      result.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: msg.tool_call_id, content: msg.content }] })
    } else {
      result.push({ role: msg.role, content: msg.content ?? '' })
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
  const usage = response.usage
    ? { inputTokens: response.usage.input_tokens ?? 0, outputTokens: response.usage.output_tokens ?? 0 }
    : undefined
  return { choices: [{ message: { content: text, tool_calls: toolCalls.length ? toolCalls : undefined }, finish_reason: response.stop_reason === 'max_tokens' ? 'length' : response.stop_reason }], usage }
}

// ── Claude adapter ─────────────────────────────────────────────────────────
class ClaudeAdapter {
  private anthropic: Anthropic = createAnthropic()

  chat = {
    completions: {
      create: async (
        params: {
          model: string
          max_tokens?: number
          temperature?: number
          messages: any[]
          tools?: any[]
          output_config?: { effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max' }
        },
        callbacks?: StreamCallbacks,
      ): Promise<NormalizedResponse> => {
        const systemMessages = params.messages.filter(m => m.role === 'system')
        const system = systemMessages.map(m => m.content).join('\n') || undefined
        const conversationMessages = toAnthropicMessages(params.messages.filter(m => m.role !== 'system'))
        const tools = params.tools?.map(t => ({
          name: t.function.name,
          description: t.function.description ?? '',
          input_schema: t.function.parameters,
        })) as Anthropic.Tool[] | undefined
        const request = {
          model: params.model,
          max_tokens: params.max_tokens ?? 1024,
          ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
          ...(system ? { system } : {}),
          messages: conversationMessages,
          ...(tools?.length ? { tools } : {}),
          ...(params.output_config ? { output_config: params.output_config } : {}),
        } as any
        callbacks?.onStreamStart?.()
        try {
          const stream = this.anthropic.messages.stream(request)
          if (callbacks?.onTextDelta) {
            stream.on('text', (delta) => callbacks.onTextDelta!(delta))
          }
          const response = await stream.finalMessage()
          return toNormalizedResponse(response)
        } catch (err) {
          // Mobile Safari drops a long-lived streaming response with a bare "Load failed" even when the
          // server answered 200. Anthropic API errors (4xx/5xx) are real and surface as-is; a connection
          // failure gets one non-streaming retry, which comes back as a single plain JSON body.
          const isApiError = err instanceof Anthropic.APIError && !(err instanceof Anthropic.APIConnectionError)
          if (isApiError) throw err
          callbacks?.onStreamStart?.() // clear any partial text the dropped stream delivered
          const response = await this.anthropic.messages.create({ ...request, stream: false })
          const normalized = toNormalizedResponse(response)
          const text = normalized.choices[0].message.content
          if (text) callbacks?.onTextDelta?.(text)
          return normalized
        }
      },
    },
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────
export function createLLMClient(): LLMClient {
  return new ClaudeAdapter()
}

// ── Web search ───────────────────────────────────────────────────────────────
// Anthropic's server-side web search tool: the API runs the searches itself
// and returns a written answer with the pages it used.
export interface WebSearchResult {
  answer: string
  sources: Array<{ title: string; url: string }>
  /** Tokens the search call itself consumed (search results fed back to the model are in inputTokens). */
  usage: NormalizedUsage
}

export async function claudeWebSearch(query: string): Promise<WebSearchResult> {
  const anthropic = createAnthropic()
  const response: any = await anthropic.messages.create({
    model: LLM_MODEL,
    max_tokens: 1024,
    system: 'Search the web and answer the query concisely and factually in a few sentences, including specific dates and figures when relevant. If the results do not answer it, say so.',
    messages: [{ role: 'user', content: query }],
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
  } as any)
  const blocks: any[] = Array.isArray(response?.content) ? response.content : []
  const answer = blocks.filter(b => b.type === 'text').map(b => b.text).join('').trim()
  const seen = new Set<string>()
  const sources: Array<{ title: string; url: string }> = []
  for (const block of blocks) {
    if (block.type !== 'web_search_tool_result' || !Array.isArray(block.content)) continue
    for (const hit of block.content) {
      if (hit?.url && !seen.has(hit.url)) {
        seen.add(hit.url)
        sources.push({ title: String(hit.title ?? hit.url), url: hit.url })
      }
    }
  }
  return {
    answer,
    sources: sources.slice(0, 6),
    usage: { inputTokens: response?.usage?.input_tokens ?? 0, outputTokens: response?.usage?.output_tokens ?? 0 },
  }
}
