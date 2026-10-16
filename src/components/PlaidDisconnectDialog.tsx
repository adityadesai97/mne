import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { LinkedPlaidAsset } from '@/lib/db/plaid'

// Disconnecting always keeps your data unless you ask otherwise: the first choice only
// removes the connection (the assets stay, just no longer synced); the second also
// deletes the assets this connection was confirmed into, with all their lots.

interface Props {
  institutionName: string
  assets: LinkedPlaidAsset[] | null // null while loading
  busy: boolean
  onUnlink: () => void
  onDelete: () => void
  onCancel: () => void
}

export function PlaidDisconnectDialog({ institutionName, assets, busy, onUnlink, onDelete, onCancel }: Props) {
  const count = assets?.length ?? 0
  const [mode, setMode] = useState<'keep' | 'delete'>('keep')
  return (
    <Dialog open onOpenChange={(next) => { if (!next && !busy) onCancel() }}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Disconnect {institutionName}?</DialogTitle>
        </DialogHeader>
        {assets === null ? (
          <p className="mne-muted" style={{ margin: 0 }}>Checking linked assets…</p>
        ) : (
          <>
            <p className="mne-muted" style={{ margin: 0 }}>
              {count === 0
                ? 'No assets are linked to this connection, so only the connection is removed.'
                : `${count} asset${count !== 1 ? 's were' : ' was'} created from this connection.`}
            </p>
            {count > 0 && (
              <div className="mne-item" style={{ maxHeight: 160, overflowY: 'auto' }}>
                {assets.map((a) => (
                  <div key={a.id} className="mne-row" style={{ padding: 0, border: 0 }}>
                    <div className="t">{a.name}</div>
                  </div>
                ))}
              </div>
            )}
            {count > 0 && (
              <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 12 }}>
                <legend className="sr-only">What happens to the linked assets</legend>
                <label className="mne-check">
                  <input type="radio" name="plaid-disconnect" checked={mode === 'keep'} onChange={() => setMode('keep')} disabled={busy} />
                  <span>
                    Disconnect and keep my assets
                    <small>Syncing stops. Your positions and lots stay as they are.</small>
                  </span>
                </label>
                <label className="mne-check">
                  <input type="radio" name="plaid-disconnect" checked={mode === 'delete'} onChange={() => setMode('delete')} disabled={busy} />
                  <span>
                    Disconnect and delete {count} linked asset{count !== 1 ? 's' : ''}
                    <small>Removes the assets and their lots. This can't be undone.</small>
                  </span>
                </label>
              </fieldset>
            )}
            <div className="mne-dialog-actions">
              <button type="button" className="mne-btn is-ghost" disabled={busy} onClick={onCancel}>Cancel</button>
              <button
                type="button"
                className="mne-btn"
                disabled={busy}
                onClick={() => (count > 0 && mode === 'delete' ? onDelete() : onUnlink())}
              >
                {busy ? 'Working…' : 'Disconnect'}
              </button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
