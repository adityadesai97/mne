import { getSupabaseClient } from '../supabase'
import type { ConversationOrigin } from './conversations'

export interface CommandFeedbackAttachment {
  filename: string
  mimeType: string
  /** base64-encoded content (no data-URL prefix) */
  content: string
}

export interface SubmitCommandFeedbackInput {
  userQuery?: string | null
  agentResponse: string
  feedbackText?: string | null
  attachment?: CommandFeedbackAttachment | null
  /** This turn's token usage (from AgentTrace.usage), so cost can be
   *  correlated with feedback quality without a separate join. */
  inputTokens?: number | null
  outputTokens?: number | null
  /** Which surface the conversation started from — defaults to
   *  'command_bar'. Passing 'portfolio_explanation' makes it evident, on
   *  review, that this feedback came from a session seeded by the Home
   *  page explanation card rather than a directly-typed command. */
  conversationOrigin?: ConversationOrigin
}

/** Records a user's feedback on a specific command bar agent response,
 *  including the response text itself so the feedback is self-contained. */
export async function submitCommandFeedback(input: SubmitCommandFeedbackInput) {
  const { data: { user } } = await getSupabaseClient().auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { error } = await getSupabaseClient()
    .from('command_feedback')
    .insert({
      user_id: user.id,
      user_query: input.userQuery ?? null,
      agent_response: input.agentResponse,
      feedback_text: input.feedbackText ?? null,
      attachment_filename: input.attachment?.filename ?? null,
      attachment_mime_type: input.attachment?.mimeType ?? null,
      attachment_content: input.attachment?.content ?? null,
      input_tokens: input.inputTokens ?? null,
      output_tokens: input.outputTokens ?? null,
      conversation_origin: input.conversationOrigin ?? 'command_bar',
    })
  if (error) throw error
}
