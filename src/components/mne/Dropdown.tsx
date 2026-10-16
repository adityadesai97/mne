import { Check, ChevronDown } from 'lucide-react'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

export interface DropdownOption<T extends string> { value: T; label: ReactNode; description?: ReactNode }

interface BaseProps<T extends string> {
  options: readonly DropdownOption<T>[]
  /** Visible label inside the trigger when nothing/everything is chosen, and the accessible name. */
  label: string
  className?: string
  /** Align the menu to the trigger's right edge (for controls at the right of a card). */
  alignRight?: boolean
}

/** Themed dropdown, single choice. The one selector style for the whole app. */
export function Dropdown<T extends string>({ value, onChange, ...base }: BaseProps<T> & { value: T; onChange: (v: T) => void }) {
  return <Menu {...base} selected={[value]} mode="single" onToggle={(v) => onChange(v)} summary={base.options.find(o => o.value === value)?.label ?? base.label} />
}

/** Themed dropdown, multiple choice (checkmarks). `summary` overrides the trigger text. */
export function MultiDropdown<T extends string>({ values, onChange, summary, ...base }: BaseProps<T> & { values: readonly T[]; onChange: (v: T[]) => void; summary?: ReactNode }) {
  const text = summary ?? (values.length === base.options.length ? `All ${base.label.toLowerCase()}` : values.length === 0 ? `No ${base.label.toLowerCase()}` : base.options.filter(o => values.includes(o.value)).map(o => o.label).join(', '))
  return (
    <Menu
      {...base}
      selected={values}
      mode="multi"
      summary={text}
      onToggle={(v) => onChange(values.includes(v) ? values.filter(x => x !== v) : [...values, v])}
    />
  )
}

function Menu<T extends string>({ options, label, className = '', alignRight, selected, mode, summary, onToggle }: BaseProps<T> & {
  selected: readonly T[]
  mode: 'single' | 'multi'
  summary: ReactNode
  onToggle: (v: T) => void
}) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  const id = useId()

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const choose = (v: T) => { onToggle(v); if (mode === 'single') setOpen(false) }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { setOpen(false); return }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) { setOpen(true); return }
      setActive(i => (i + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length)
    } else if ((e.key === 'Enter' || e.key === ' ') && open) {
      e.preventDefault()
      choose(options[active].value)
    }
  }

  return (
    <div ref={root} className={`mne-dd ${className}`} onKeyDown={onKeyDown}>
      <button
        type="button"
        className="mne-dd-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={id}
        aria-label={label}
        onClick={() => { setOpen(o => !o); setActive(Math.max(0, options.findIndex(o => selected.includes(o.value)))) }}
      >
        <span className="mne-dd-value">{summary}</span>
        <ChevronDown size={16} strokeWidth={1.5} aria-hidden="true" />
      </button>
      {open && (
        <ul id={id} role="listbox" aria-multiselectable={mode === 'multi'} aria-label={label} className={`mne-dd-menu${alignRight ? ' is-right' : ''}`}>
          {options.map((o, i) => {
            const on = selected.includes(o.value)
            return (
              <li
                key={o.value}
                role="option"
                aria-selected={on}
                className={`mne-dd-item${i === active ? ' is-active' : ''}${on ? ' is-on' : ''}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(o.value)}
              >
                <span className="mne-dd-check">{on && <Check size={16} strokeWidth={2} aria-hidden="true" />}</span>
                <span>{o.label}{o.description && <small>{o.description}</small>}</span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
