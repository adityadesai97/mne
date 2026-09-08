import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { getSupabaseClient } from '@/lib/supabase'
import { executeTool, validateWriteToolInput } from '@/lib/claude'
import {
  listPendingPositions,
  markPendingPositionConfirmed,
  dismissPendingPosition,
  type PendingPlaidPosition,
} from '@/lib/db/plaid'

// Review-first confirmation screen for positions a Plaid sync detected.
// Nothing here has touched assets/transactions/fixed_income_lots yet —
// Confirm routes through the exact same executeTool/validateWriteToolInput
// path the AI command bar's write-tool confirmations use (see
// src/lib/claude.ts and CommandBar.tsx's PreviewSections), so a synced
// position is written the same way a manually-entered one would be.

interface Props {
  open: boolean
  onClose: () => void
  /** Called after any confirm/skip so a caller (e.g. AppLayout's banner) can refresh its pending count. */
  onChanged?: () => void
}

const TOOL_FOR_TYPE: Record<PendingPlaidPosition['detected_type'], string> = {
  stock: 'add_stock_transaction',
  stock_plan: 'add_stock_transaction',
  cash: 'add_cash_asset',
  fixed_income: 'add_cash_asset',
}

const TYPE_LABEL: Record<PendingPlaidPosition['detected_type'], string> = {
  stock: 'Stock',
  stock_plan: 'Stock plan (RSU/ESPP) — check the type below',
  cash: 'Balance',
  fixed_income: 'Fixed Income',
}

type FieldType = 'text' | 'number' | 'date' | 'select'
interface FieldConfig {
  key: string
  label: string
  type: FieldType
  options?: string[]
  required?: boolean
}

const STOCK_FIELDS: FieldConfig[] = [
  { key: 'symbol', label: 'Symbol', type: 'text', required: true },
  { key: 'count', label: 'Shares', type: 'number', required: true },
  { key: 'cost_price', label: 'Cost/share ($)', type: 'number', required: true },
  { key: 'purchase_date', label: 'Purchase date', type: 'date', required: true },
  { key: 'subtype', label: 'Type', type: 'select', options: ['Market', 'ESPP', 'RSU'] },
  { key: 'grant_date', label: 'RSU grant date (if RSU)', type: 'date' },
  { key: 'location_name', label: 'Location', type: 'text', required: true },
]

const FIELDS_BY_TYPE: Record<PendingPlaidPosition['detected_type'], FieldConfig[]> = {
  stock: STOCK_FIELDS,
  stock_plan: STOCK_FIELDS,
  cash: [
    { key: 'name', label: 'Name', type: 'text', required: true },
    { key: 'price', label: 'Value ($)', type: 'number', required: true },
    { key: 'location_name', label: 'Location', type: 'text', required: true },
  ],
  fixed_income: [
    { key: 'name', label: 'Name', type: 'text', required: true },
    { key: 'count', label: 'Units', type: 'number', required: true },
    { key: 'cost_price', label: 'Cost/unit ($)', type: 'number', required: true },
    { key: 'purchase_date', label: 'Purchase date', type: 'date', required: true },
    { key: 'interest_rate', label: 'Coupon rate (%, Bond only)', type: 'number' },
    { key: 'maturity_date', label: 'Maturity date', type: 'date' },
    { key: 'face_value', label: 'Face value ($/unit at maturity)', type: 'number' },
    { key: 'location_name', label: 'Location', type: 'text', required: true },
  ],
}

export function PlaidReviewModal({ open, onClose, onChanged }: Props) {
  const [rows, setRows] = useState<PendingPlaidPosition[]>([])
  const [edits, setEdits] = useState<Record<string, Record<string, unknown>>>({})
  const [matchedNames, setMatchedNames] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!open) return
    void load()
  }, [open])

  async function load() {
    setLoading(true)
    try {
      const pending = await listPendingPositions()
      setRows(pending)
      const initialEdits: Record<string, Record<string, unknown>> = {}
      for (const row of pending) initialEdits[row.id] = { ...row.payload }
      setEdits(initialEdits)

      const matchedIds = Array.from(new Set(pending.map((r) => r.matched_asset_id).filter(Boolean))) as string[]
      if (matchedIds.length > 0) {
        const { data } = await getSupabaseClient().from('assets').select('id, name').in('id', matchedIds)
        const map: Record<string, string> = {}
        for (const a of data ?? []) map[a.id] = a.name
        setMatchedNames(map)
      } else {
        setMatchedNames({})
      }
    } finally {
      setLoading(false)
    }
  }

  function setField(rowId: string, key: string, value: unknown) {
    setEdits((prev) => ({ ...prev, [rowId]: { ...prev[rowId], [key]: value } }))
  }

  async function handleConfirm(row: PendingPlaidPosition) {
    const toolName = TOOL_FOR_TYPE[row.detected_type]
    const input: Record<string, unknown> = { ...edits[row.id] }
    delete input._lots

    const validationError = validateWriteToolInput(toolName, input)
    if (validationError) {
      setErrors((prev) => ({ ...prev, [row.id]: validationError }))
      return
    }

    setBusyId(row.id)
    setErrors((prev) => ({ ...prev, [row.id]: '' }))
    try {
      const { data: { user } } = await getSupabaseClient().auth.getUser()
      if (!user) throw new Error('Not authenticated')
      await executeTool(toolName, input, user.id)
      await markPendingPositionConfirmed(row.id)
      setRows((prev) => prev.filter((r) => r.id !== row.id))
      onChanged?.()
    } catch (err) {
      setErrors((prev) => ({ ...prev, [row.id]: err instanceof Error ? err.message : 'Failed to save' }))
    } finally {
      setBusyId(null)
    }
  }

  async function handleSkip(row: PendingPlaidPosition) {
    setBusyId(row.id)
    try {
      await dismissPendingPosition(row.id)
      setRows((prev) => prev.filter((r) => r.id !== row.id))
      onChanged?.()
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Review synced positions</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Plaid detected these positions. Nothing is added to your portfolio until you confirm each one — fill
          in anything Plaid couldn't supply first.
        </p>
        {loading ? (
          <p className="p-4 text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">Nothing left to review.</p>
        ) : (
          <div className="space-y-4">
            {rows.map((row) => (
              <PendingRow
                key={row.id}
                row={row}
                edit={edits[row.id] ?? {}}
                matchedName={row.matched_asset_id ? matchedNames[row.matched_asset_id] : undefined}
                error={errors[row.id]}
                busy={busyId === row.id}
                onFieldChange={(key, value) => setField(row.id, key, value)}
                onConfirm={() => handleConfirm(row)}
                onSkip={() => handleSkip(row)}
              />
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function PendingRow({
  row,
  edit,
  matchedName,
  error,
  busy,
  onFieldChange,
  onConfirm,
  onSkip,
}: {
  row: PendingPlaidPosition
  edit: Record<string, unknown>
  matchedName?: string
  error?: string
  busy: boolean
  onFieldChange: (key: string, value: unknown) => void
  onConfirm: () => void
  onSkip: () => void
}) {
  const fields = FIELDS_BY_TYPE[row.detected_type]

  return (
    <div className="rounded-md border border-border/70 p-3 space-y-2">
      <div>
        <span
          className={`inline-block text-[10px] font-medium px-1.5 py-0.5 rounded ${
            matchedName ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary'
          }`}
        >
          {matchedName ? `Will update "${matchedName}"` : 'New'}
        </span>
        <p className="text-xs text-muted-foreground mt-1">{TYPE_LABEL[row.detected_type]}</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {fields.map((field) => (
          <label key={field.key} className="text-xs space-y-1 block">
            <span className="text-muted-foreground">
              {field.label}
              {field.required ? ' *' : ''}
            </span>
            {field.type === 'select' ? (
              <select
                className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                value={String(edit[field.key] ?? '')}
                onChange={(e) => onFieldChange(field.key, e.target.value)}
              >
                <option value="">–</option>
                {field.options?.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            ) : (
              <Input
                type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
                value={(edit[field.key] as string | number | undefined) ?? ''}
                onChange={(e) =>
                  onFieldChange(
                    field.key,
                    field.type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value,
                  )
                }
              />
            )}
          </label>
        ))}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          disabled={busy}
          onClick={onConfirm}
          className="flex-1 bg-primary text-primary-foreground rounded-md py-1.5 text-xs font-medium disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Confirm'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onSkip}
          className="flex-1 bg-muted text-muted-foreground rounded-md py-1.5 text-xs hover:bg-muted/80 transition-colors disabled:opacity-50"
        >
          Skip
        </button>
      </div>
    </div>
  )
}
