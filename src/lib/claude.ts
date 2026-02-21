import Anthropic from '@anthropic-ai/sdk'
import { config } from '@/store/config'
import { getAllAssets } from './db/assets'
import { getAllTickers } from './db/tickers'
import { getSupabaseClient } from './supabase'

export function buildSystemPrompt(assets: any[]): string {
  return `You are a portfolio assistant for a personal finance app.
The user will issue read or write commands in natural language.

Current portfolio data (JSON):
${JSON.stringify(assets, null, 2)}

Respond ONLY with a JSON object in one of these shapes:

For READ commands (navigate to a view):
{ "type": "navigate", "route": "/portfolio" | "/tax" | "/watchlist" | "/settings", "filter": "optional filter string" }

For WRITE commands (data changes — always require confirmation):
{ "type": "write_confirm", "confirmationMessage": "Human-readable summary of the change", "writes": [{ "table": "string", "operation": "upsert"|"delete", "data": {} }] }

For errors or ambiguous commands:
{ "type": "error", "message": "explanation" }

Rules:
- ALL write commands must use type "write_confirm", never auto-commit
- Be specific in confirmationMessage (include names, amounts, dates)
- For stock transactions, include capital_gains_status based on whether purchase_date is within 1 year
- Today's date is ${new Date().toISOString().split('T')[0]}`
}

export async function runCommand(query: string): Promise<any> {
  const [assets, tickers] = await Promise.all([getAllAssets(), getAllTickers()])
  const client = new Anthropic({ apiKey: config.claudeApiKey, dangerouslyAllowBrowser: true })

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: buildSystemPrompt(assets),
    messages: [{ role: 'user', content: query }],
  })

  const text = response.content[0].type === 'text' ? response.content[0].text : ''
  const action = JSON.parse(text)

  if (action.type === 'navigate') {
    window.location.href = action.route + (action.filter ? `?filter=${action.filter}` : '')
  }

  if (action.type === 'write_confirm') {
    action.execute = async () => {
      const supabase = getSupabaseClient()
      for (const w of action.writes) {
        if (w.operation === 'upsert') {
          await supabase.from(w.table).upsert(w.data)
        } else if (w.operation === 'delete') {
          await supabase.from(w.table).delete().eq('id', w.data.id)
        }
      }
    }
  }

  return action
}
