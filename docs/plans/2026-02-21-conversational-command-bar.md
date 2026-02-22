# Conversational Command Bar Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Expand the command bar into a 70vh conversational modal with the input at the bottom when Claude asks a follow-up question; one-shot tool calls keep the existing compact layout unchanged.

**Architecture:** `runCommand` accepts a full `Message[]` history instead of a single string — each API call sends the accumulated conversation. `CommandBar` tracks a `displayMessages` array and an `isExpanded` flag. A text response sets `isExpanded=true`, triggering a Framer Motion spring animation from compact → 70vh with the thread above and input pinned at the bottom.

**Tech Stack:** Framer Motion (spring animation), Anthropic SDK multi-turn messages

---

### Task 1: Install framer-motion

**Files:**
- Run: `npm install framer-motion`

**Step 1: Install**
```bash
npm install framer-motion
```

**Step 2: Verify build**
```bash
npm run build 2>&1 | grep -E 'error|✓'
```
Expected: `✓ built in ...`

**Step 3: Commit**
```bash
git add package.json package-lock.json
git commit -m "chore: add framer-motion"
```

---

### Task 2: Update `claude.ts` — message history + text response type

**Files:**
- Modify: `src/lib/claude.ts`

**Step 1: Export `Message` type and update `runCommand` signature**

Add near the top of the file (after imports):
```typescript
export type Message = { role: 'user' | 'assistant'; content: string }
```

Replace the `runCommand` function signature and first few lines:
```typescript
// Before:
export async function runCommand(query: string): Promise<any> {
  if (/^mock:/i.test(query)) return mockCommand(query)
  const [assets] = await Promise.all([getAllAssets(), getAllTickers()])
  const client = new Anthropic({ apiKey: config.claudeApiKey, dangerouslyAllowBrowser: true })
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: buildSystemPrompt(assets),
    messages: [{ role: 'user', content: query }],
    tools,
  })

// After:
export async function runCommand(messages: Message[]): Promise<any> {
  const lastUserContent = messages.findLast(m => m.role === 'user')?.content ?? ''
  if (/^mock:/i.test(lastUserContent)) return mockCommand(lastUserContent)
  const [assets] = await Promise.all([getAllAssets(), getAllTickers()])
  const client = new Anthropic({ apiKey: config.claudeApiKey, dangerouslyAllowBrowser: true })
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: buildSystemPrompt(assets),
    messages,
    tools,
  })
```

**Step 2: Change text response from `type: 'error'` to `type: 'text'`**

```typescript
// Before:
return { type: 'error', message: (text as any)?.text || 'Could not understand command' }

// After:
return { type: 'text', message: (text as any)?.text || 'Could not understand command' }
```

**Step 3: Add a `text` case to mock mode for manual testing**

In `mockCommand`, add before the final `return`:
```typescript
if (cmd.startsWith('text')) {
  return { type: 'text', message: "What's the grant date and total shares?" }
}
```

**Step 4: Run tests**
```bash
npm test 2>&1 | tail -6
```
Expected: 19 passed (no tests touch `runCommand` signature directly)

**Step 5: Commit**
```bash
git add src/lib/claude.ts
git commit -m "feat: runCommand accepts message history, text responses return type:text"
```

---

### Task 3: Rewrite `CommandBar` — state, logic, and static expanded layout

**Files:**
- Modify: `src/components/CommandBar.tsx`

This task wires up all state and logic, and adds the expanded layout — but with no animation yet (animation in Task 4). After this task, the expanded conversation view works correctly, just without the spring.

**Step 1: Replace imports and add `DisplayMessage` type**

```typescript
import { useState, useEffect, useRef } from 'react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { VisuallyHidden } from '@radix-ui/react-visually-hidden'
import { Input } from '@/components/ui/input'
import { runCommand, type Message } from '@/lib/claude'

type DisplayMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; kind: 'text'; content: string }
  | { role: 'assistant'; kind: 'action'; action: any }
```

**Step 2: Replace `CommandBar` component**

```typescript
export function CommandBar() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [displayMessages, setDisplayMessages] = useState<DisplayMessage[]>([])
  const [isExpanded, setIsExpanded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [compactResult, setCompactResult] = useState<any>(null)
  const threadRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setOpen(o => !o)
        reset()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight
    }
  }, [displayMessages])

  function reset() {
    setQuery('')
    setDisplayMessages([])
    setIsExpanded(false)
    setCompactResult(null)
    setDone(false)
  }

  function buildHistory(newUserContent: string): Message[] {
    const history: Message[] = displayMessages.flatMap(m => {
      if (m.role === 'user') return [{ role: 'user' as const, content: m.content }]
      if (m.role === 'assistant' && m.kind === 'text') return [{ role: 'assistant' as const, content: m.content }]
      return []
    })
    return [...history, { role: 'user', content: newUserContent }]
  }

  async function handleSubmit() {
    if (!query.trim()) return
    const userContent = query.trim()
    setQuery('')
    setLoading(true)
    setDone(false)
    setCompactResult(null)
    try {
      const action = await runCommand(buildHistory(userContent))
      if (action.type === 'text') {
        setDisplayMessages(prev => [
          ...prev,
          { role: 'user', content: userContent },
          { role: 'assistant', kind: 'text', content: action.message },
        ])
        setIsExpanded(true)
      } else if (isExpanded) {
        setDisplayMessages(prev => [
          ...prev,
          { role: 'user', content: userContent },
          { role: 'assistant', kind: 'action', action },
        ])
      } else {
        setCompactResult(action)
      }
    } catch (e: any) {
      const errAction = { type: 'error', message: e.message || 'Something went wrong' }
      if (isExpanded) {
        setDisplayMessages(prev => [
          ...prev,
          { role: 'user', content: userContent },
          { role: 'assistant', kind: 'action', action: errAction },
        ])
      } else {
        setCompactResult(errAction)
      }
    } finally {
      setLoading(false)
    }
  }

  function handleClose() {
    setOpen(false)
    reset()
  }

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) handleClose(); else setOpen(true) }}>
      <DialogContent className="p-0 gap-0 max-w-lg overflow-hidden">
        <VisuallyHidden><DialogTitle>Command Bar</DialogTitle></VisuallyHidden>
        {/* COMPACT — unchanged layout */}
        {!isExpanded && (
          <div>
            <div className="flex items-center border-b border-border px-4 py-3">
              <Input
                autoFocus
                placeholder="Ask anything or issue a command..."
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                className="border-0 focus-visible:ring-0 text-base"
              />
            </div>
            {loading && <p className="p-4 text-muted-foreground text-sm">Thinking...</p>}
            {done && <p className="p-4 text-sm text-gain">Done ✓</p>}
            {compactResult && !loading && !done && (
              <CommandResult action={compactResult} onDone={() => setDone(true)} onClose={handleClose} />
            )}
            {!compactResult && !loading && !done && (
              <p className="p-4 text-muted-foreground text-xs">
                Try: "What's my AI theme total?" or "Add 10 AAPL shares at $220 bought today" · Use "mock:write" to test without API credits
              </p>
            )}
          </div>
        )}
        {/* EXPANDED — thread + input at bottom */}
        {isExpanded && (
          <div className="flex flex-col h-[70vh]">
            <div ref={threadRef} className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
              {displayMessages.map((m, i) => (
                <MessageBubble key={i} message={m} onDone={() => setDone(true)} onClose={handleClose} />
              ))}
              {loading && <p className="text-muted-foreground text-sm">Thinking...</p>}
            </div>
            <div className="border-t border-border px-4 py-3">
              <Input
                autoFocus
                placeholder="Reply..."
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                className="border-0 focus-visible:ring-0 text-base"
              />
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
```

**Step 3: Add `MessageBubble` component** (below `CommandResult`)

```typescript
function MessageBubble({ message, onDone, onClose }: { message: DisplayMessage; onDone: () => void; onClose: () => void }) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <span className="bg-muted text-foreground text-sm px-3 py-1.5 rounded-full max-w-[80%]">
          {message.content}
        </span>
      </div>
    )
  }
  if (message.kind === 'text') {
    return (
      <div className="flex justify-start">
        <p className="text-sm text-foreground max-w-[80%]">{message.content}</p>
      </div>
    )
  }
  return (
    <div className="flex justify-start w-full">
      <div className="w-full">
        <CommandResult action={message.action} onDone={onDone} onClose={onClose} />
      </div>
    </div>
  )
}
```

**Step 4: Run tests**
```bash
npm test 2>&1 | tail -6
```
Expected: 19 passed

**Step 5: Smoke test in browser**
- `mock:write` → compact confirm/cancel works as before
- `mock:text anything` → dialog expands to full height showing thread, input at bottom, can type a reply

**Step 6: Commit**
```bash
git add src/components/CommandBar.tsx
git commit -m "feat: conversational CommandBar with expanded thread layout"
```

---

### Task 4: Add Framer Motion spring animation

**Files:**
- Modify: `src/components/CommandBar.tsx`

**Step 1: Add import**

```typescript
import { motion, AnimatePresence } from 'framer-motion'
```

**Step 2: Wrap compact/expanded views with `AnimatePresence`**

Replace the two `{!isExpanded && ...}` / `{isExpanded && ...}` blocks inside `DialogContent` with:

```tsx
<AnimatePresence mode="wait" initial={false}>
  {!isExpanded ? (
    <motion.div
      key="compact"
      exit={{ opacity: 0, transition: { duration: 0.1 } }}
    >
      {/* paste the existing compact <div> contents here, unchanged */}
    </motion.div>
  ) : (
    <motion.div
      key="expanded"
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: '70vh', opacity: 1 }}
      transition={{ type: 'spring', stiffness: 280, damping: 28 }}
      className="flex flex-col overflow-hidden"
    >
      <div ref={threadRef} className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
        <AnimatePresence initial={false}>
          {displayMessages.map((m, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            >
              <MessageBubble message={m} onDone={() => setDone(true)} onClose={handleClose} />
            </motion.div>
          ))}
        </AnimatePresence>
        {loading && (
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-muted-foreground text-sm">
            Thinking...
          </motion.p>
        )}
      </div>
      <div className="border-t border-border px-4 py-3">
        <Input
          autoFocus
          placeholder="Reply..."
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSubmit()}
          className="border-0 focus-visible:ring-0 text-base"
        />
      </div>
    </motion.div>
  )}
</AnimatePresence>
```

**Step 3: Run build**
```bash
npm run build 2>&1 | grep -E 'error|✓'
```
Expected: `✓ built`

**Step 4: Run tests**
```bash
npm test 2>&1 | tail -6
```
Expected: 19 passed

**Step 5: Visual verification**
- `mock:write` → compact, no animation, Confirm/Cancel works
- `mock:text anything` → dialog springs open smoothly to full height, each message fades+slides in
- Multi-turn: `mock:text q1` → reply → `mock:text q2` → messages animate in one at a time
- Close with ⌘K or Cancel → dialog closes, reopening ⌘K shows compact bar again

**Step 6: Commit**
```bash
git add src/components/CommandBar.tsx
git commit -m "feat: spring-animate command bar expansion with framer-motion"
```
