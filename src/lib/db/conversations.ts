import { getSupabaseClient } from '../supabase'

export interface ConversationMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ConversationSummary {
  id: string
  title: string
  created_at: string
  updated_at: string
}

export interface Conversation extends ConversationSummary {
  messages: ConversationMessage[]
}

const TITLE_MAX_LENGTH = 60

/** Derives a short conversation title from the user's first prompt: the
 *  first line, trimmed to a fixed length. Deliberately simple (no LLM call)
 *  — a title is just a label to find the conversation again later. */
export function deriveConversationTitle(firstUserMessage: string): string {
  const firstLine = firstUserMessage.split('\n')[0].trim()
  if (firstLine.length <= TITLE_MAX_LENGTH) return firstLine || 'Untitled conversation'
  return `${firstLine.slice(0, TITLE_MAX_LENGTH - 1).trimEnd()}…`
}

/** Lists the signed-in user's conversations, most recently updated first.
 *  Omits `messages` — the history list only needs title + timestamps. */
export async function listConversations(): Promise<ConversationSummary[]> {
  const { data: { user } } = await getSupabaseClient().auth.getUser()
  if (!user) throw new Error('Not authenticated')
  const { data, error } = await getSupabaseClient()
    .from('command_conversations')
    .select('id, title, created_at, updated_at')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function getConversation(id: string): Promise<Conversation | null> {
  const { data, error } = await getSupabaseClient()
    .from('command_conversations')
    .select('id, title, messages, created_at, updated_at')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return { ...data, messages: Array.isArray(data.messages) ? data.messages : [] }
}

/** Creates or updates a conversation's saved message list. Pass `id` to
 *  update an existing conversation (title is left as-is when a title was
 *  already set); omit it to create a new one, deriving the title from the
 *  first message. Returns the conversation's id. */
export async function saveConversation(input: {
  id?: string | null
  messages: ConversationMessage[]
}): Promise<string> {
  const { data: { user } } = await getSupabaseClient().auth.getUser()
  if (!user) throw new Error('Not authenticated')

  if (input.id) {
    const { error } = await getSupabaseClient()
      .from('command_conversations')
      .update({ messages: input.messages, updated_at: new Date().toISOString() })
      .eq('id', input.id)
      .eq('user_id', user.id)
    if (error) throw error
    return input.id
  }

  const firstUserMessage = input.messages.find(m => m.role === 'user')?.content ?? ''
  const { data, error } = await getSupabaseClient()
    .from('command_conversations')
    .insert({
      user_id: user.id,
      title: deriveConversationTitle(firstUserMessage),
      messages: input.messages,
    })
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

export async function deleteConversation(id: string): Promise<void> {
  const { error } = await getSupabaseClient()
    .from('command_conversations')
    .delete()
    .eq('id', id)
  if (error) throw error
}
