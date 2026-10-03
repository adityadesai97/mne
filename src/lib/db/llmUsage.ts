import { getSupabaseClient } from '../supabase'

export type LlmUsageFeature = 'portfolio_explanation' | 'command_bar'

/** Appends one row to the shared usage ledger. Best-effort and fire-and-
 *  forget — a logging failure must never break the feature that produced
 *  the usage it's trying to record. This is the one place either feature's
 *  token usage can be trended over time; each feature also denormalizes
 *  its own latest/running totals (portfolio_explanations.input_tokens/
 *  output_tokens, command_conversations.total_input_tokens/
 *  total_output_tokens) for cheap inline display without querying this. */
export async function logLlmUsage(input: {
  feature: LlmUsageFeature
  provider: string
  model: string
  inputTokens: number
  outputTokens: number
  conversationId?: string | null
}): Promise<void> {
  try {
    const { data: { user } } = await getSupabaseClient().auth.getUser()
    if (!user) return
    await getSupabaseClient().from('llm_usage_log').insert({
      user_id: user.id,
      feature: input.feature,
      provider: input.provider,
      model: input.model,
      input_tokens: input.inputTokens,
      output_tokens: input.outputTokens,
      conversation_id: input.conversationId ?? null,
    })
  } catch (err) {
    console.error('Failed to log LLM usage', err)
  }
}
