import { useEffect, useState } from 'react'
import { Dropdown } from './Dropdown'

const ACCOUNT_TYPES = ['Investment', 'Checking', 'Savings', 'Misc'] as const
const NEW_ACCOUNT = '__new__'

/** Account (location) picker: choose one you already have, or add a new one with its type. */
export function LocationField({ label, idBase, locations, name, accountType, fixedType, onChange }: {
  label: string
  idBase: string
  locations: { id: string; name: string; account_type: string }[]
  name: string
  accountType: string
  fixedType?: string
  onChange: (name: string, accountType: string) => void
}) {
  // A coin lives at a Crypto account; everything else never offers one.
  const visible = fixedType ? locations.filter((l) => l.account_type === fixedType) : locations.filter((l) => l.account_type !== 'Crypto')
  const initial = visible.find((l) => l.name === name && l.account_type === accountType)
    ?? visible.find((l) => l.name.toLowerCase() === name.toLowerCase())
  const [selected, setSelected] = useState<string>(initial?.id ?? NEW_ACCOUNT)
  const type = fixedType ?? (accountType || 'Investment')

  // Adopt a matched existing account once on mount, so the stored edit agrees with what's shown.
  useEffect(() => {
    if (initial && (initial.name !== name || initial.account_type !== accountType)) onChange(initial.name, initial.account_type)
    else if (!initial && accountType !== type) onChange(name, type)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const options = [
    ...visible.map((l) => ({ value: l.id, label: `${l.name} (${l.account_type})` })),
    { value: NEW_ACCOUNT, label: '+ Add a new account' },
  ]

  return (
    <div className="mne-field" style={{ gridColumn: '1 / -1' }}>
      <label id={`${idBase}-label`}>{label} *</label>
      <Dropdown
        label={label}
        className="is-block"
        options={options}
        value={selected}
        onChange={(v) => {
          setSelected(v)
          const loc = visible.find((l) => l.id === v)
          if (loc) onChange(loc.name, loc.account_type)
          else onChange(name, type)
        }}
      />
      {selected === NEW_ACCOUNT && (
        <div className="mne-form-grid" style={{ marginTop: 8 }}>
          <div className="mne-field">
            <label htmlFor={`${idBase}-name`}>Account name *</label>
            <input
              id={`${idBase}-name`}
              className="mne-input"
              type="text"
              value={name}
              onChange={(e) => onChange(e.target.value, type)}
            />
          </div>
          {!fixedType && (
            <div className="mne-field">
              <label id={`${idBase}-type-label`}>Account type</label>
              <Dropdown
                label="Account type"
                className="is-block"
                options={ACCOUNT_TYPES.map((t) => ({ value: t, label: t }))}
                value={ACCOUNT_TYPES.includes(type as any) ? (type as (typeof ACCOUNT_TYPES)[number]) : 'Investment'}
                onChange={(v) => onChange(name, v)}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

