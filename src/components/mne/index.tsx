import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

// Thin React wrappers over the design system's `.mne-*` classes (src/styles/mne.css).
// Pages may also use the classes directly; these only remove boilerplate.

/** Signed change with arrow, e.g. "▲ +1.20%": sign and arrow always accompany the colour. */
export function Delta({ value, suffix = '', digits = 2, className = '', format }: {
  value: number
  suffix?: string
  digits?: number
  className?: string
  /** Custom number formatter for the absolute value (e.g. currency); defaults to fixed digits. */
  format?: (abs: number) => string
}) {
  const up = value >= 0
  const abs = Math.abs(value)
  const body = format ? format(abs) : `${abs.toFixed(digits)}%`
  return (
    <span className={`${up ? 'mne-up' : 'mne-down'} mne-num ${className}`}>
      {up ? '▲ +' : '▼ −'}{body}{suffix ? ` ${suffix}` : ''}
    </span>
  )
}

export function Eyebrow({ icon: Icon, accent, children }: { icon?: LucideIcon; accent?: boolean; children: ReactNode }) {
  return (
    <div className={`mne-eyebrow${accent ? ' is-accent' : ''}`}>
      {Icon && <Icon size={16} strokeWidth={1.5} aria-hidden="true" />}
      {children}
    </div>
  )
}

export function Chip({ variant, children, className = '' }: { variant?: 'tag' | 'outline' | 'accent'; children: ReactNode; className?: string }) {
  return <span className={`mne-chip${variant ? ` is-${variant}` : ''} ${className}`}>{children}</span>
}

export function Stat({ label, value, sub, subClassName = '', className = '' }: { label: ReactNode; value: ReactNode; sub?: ReactNode; subClassName?: string; className?: string }) {
  return (
    <div className={`mne-stat ${className}`}>
      <div className="l">{label}</div>
      <div className="v">{value}</div>
      {sub && <div className={`s ${subClassName}`}>{sub}</div>}
    </div>
  )
}

export function SegmentedControl<T extends string>({ value, options, onChange, label }: {
  value: T
  options: readonly { value: T; label: ReactNode }[] | readonly T[]
  onChange: (v: T) => void
  label?: string
}) {
  const opts = (options as readonly unknown[]).map(o => (typeof o === 'string' ? { value: o as T, label: o as string } : (o as { value: T; label: ReactNode })))
  return (
    <div className="mne-seg" role="group" aria-label={label}>
      {opts.map(o => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (next: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} className="mne-switch" onClick={() => onChange(!checked)} />
}

export function PageHead({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className="mne-page-head">
      <h1 className="mne-page-title">{title}</h1>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  )
}

/** Standard page body padding: matches the design's `.mne-main`. */
export function PageBody({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`mne-main ${className}`}>{children}</div>
}

export function Field({ id, label, help, error, children }: { id: string; label: string; help?: ReactNode; error?: ReactNode; children: ReactNode }) {
  return (
    <div className="mne-field">
      <label htmlFor={id}>{label}</label>
      {children}
      {error ? <span className="mne-help is-error">▼ {error}</span> : help ? <span className="mne-help">{help}</span> : null}
    </div>
  )
}
