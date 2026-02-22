# Conversational Command Bar

## Summary

The command bar expands from a compact input into a full conversational modal when the LLM asks follow-up questions. One-shot commands (tool call on first response) keep the current compact UI unchanged.

## Interaction Model

**Happy path (tool call on first response):**
- UI stays exactly as today — compact bar, confirm/cancel below the input.
- No visual change, no expansion.

**Follow-up path (Claude returns text):**
- Dialog springs open into a tall modal (~70vh).
- Input moves to the bottom (pinned), conversation thread fills the upper area.
- Thread scrolls automatically to the latest message.
- Each subsequent reply appends to the thread.
- When Claude eventually calls a tool, the confirm/cancel UI appears inline as the last item in the thread.

**Reset:** ⌘K closes and clears all history. No persistence between opens.

## Visual Layout

```
Compact (one-shot):          Expanded (follow-up):
┌───────────────────────┐    ┌───────────────────────┐
│ [input field]         │    │                       │
│                       │    │  You                  │
│ Confirm action...     │    │  Add AAPL RSU grant   │
│ [Confirm] [Cancel]    │    │                       │
└───────────────────────┘    │  ◎  What's the grant  │
                             │  date and total shares?│
                             │                       │
                             │  You                  │
                             │  Jan 1, 200 shares    │
                             │                       │
                             │  ◎  [Confirm action]  │
                             │  [Confirm]  [Cancel]  │
                             │                       │
                             ├───────────────────────┤
                             │ [input field]       ↵ │
                             └───────────────────────┘
```

- User messages: right-aligned, muted pill
- Claude messages: left-aligned, no bubble (clean, minimal)
- Thread area: scrollable, auto-scrolls to bottom on new message
- Confirm/cancel: inline in the last Claude message

## Animation

- Framer Motion `AnimatePresence` + `motion.div` for spring expansion
- Dialog height animates from compact → 70vh on first text response
- Each new message animates in with a subtle fade+slide-up

## Code Changes

### `src/lib/claude.ts`
- Change `runCommand(query: string)` → `runCommand(messages: Message[])`
- Return `{ type: 'text', message: string }` for text responses (currently returns `type: 'error'`)

### `src/components/CommandBar.tsx`
- Track `messages: Message[]` state (each: `{ role: 'user' | 'assistant', content: string, action?: Result }`)
- `isExpanded`: true when any message exists with `type: 'text'`
- Compact layout: input at top (current)
- Expanded layout: thread above, input pinned at bottom
- Framer Motion animates the height transition between states
- Auto-scroll thread div to bottom after each append
