import { getSupabaseClient } from '../supabase'

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
    })
  if (error) throw error
}
