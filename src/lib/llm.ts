import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import type { LLMProvider } from '@/store/config'

export const MODEL_FOR_PROVIDER: Record<LLMProvider, string> = {
  claude: 'claude-sonnet-5',
  groq: 'llama-3.3-70b-versatile',
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
        params: { model: string; max_tokens?: number; temperature?: number; messages: any[]; tools?: any[] },
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
      create: async (
        params: {
          model: string
          max_tokens?: number
          temperature?: number
          messages: any[]
          tools?: any[]
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
        callbacks?.onStreamStart?.()
        const stream = this.anthropic.messages.stream({
          model: params.model,
          max_tokens: params.max_tokens ?? 1024,
          ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
          ...(system ? { system } : {}),
          messages: conversationMessages,
          ...(tools?.length ? { tools } : {}),
        })
        if (callbacks?.onTextDelta) {
          stream.on('text', (delta) => callbacks.onTextDelta!(delta))
        }
        const response = await stream.finalMessage()
        return toNormalizedResponse(response)
      },
    },
  }
}

// ── Groq adapter (OpenAI-compatible) ─────────────────────────────────────────
class GroqAdapter {
  private openai: OpenAI

  constructor(apiKey: string) {
    this.openai = new OpenAI({ apiKey, baseURL: 'https://api.groq.com/openai/v1', dangerouslyAllowBrowser: true })
  }

  chat = {
    completions: {
      create: async (
        params: {
          model: string
          max_tokens?: number
          temperature?: number
          messages: any[]
          tools?: any[]
        },
        callbacks?: StreamCallbacks,
      ): Promise<NormalizedResponse> => {
        callbacks?.onStreamStart?.()
        const stream = await this.openai.chat.completions.create({
          model: params.model,
          max_tokens: params.max_tokens,
          ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
          messages: params.messages,
          ...(params.tools?.length ? { tools: params.tools } : {}),
          stream: true,
        })

        let content = ''
        // Tool-call argument fragments arrive indexed by position, in
        // whatever order the model interleaves them — accumulate per index,
        // not by concatenating chunks in arrival order.
        const toolCallsByIndex = new Map<number, { id: string; name: string; arguments: string }>()

        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta
          if (!delta) continue
          if (delta.content) {
            content += delta.content
            callbacks?.onTextDelta?.(delta.content)
          }
          for (const tc of delta.tool_calls ?? []) {
            const existing = toolCallsByIndex.get(tc.index) ?? { id: '', name: '', arguments: '' }
            if (tc.id) existing.id = tc.id
            if (tc.function?.name) existing.name += tc.function.name
            if (tc.function?.arguments) existing.arguments += tc.function.arguments
            toolCallsByIndex.set(tc.index, existing)
          }
        }

        const toolCalls: NormalizedToolCall[] = [...toolCallsByIndex.values()].map(tc => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.name, arguments: tc.arguments },
        }))
        return { choices: [{ message: { content: content || null, tool_calls: toolCalls.length ? toolCalls : undefined } }] }
      },
    },
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────
export function createLLMClient(provider: LLMProvider, apiKey: string): LLMClient {
  if (provider === 'claude') return new ClaudeAdapter(apiKey)
  return new GroqAdapter(apiKey)
}
