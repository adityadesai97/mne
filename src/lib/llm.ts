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
