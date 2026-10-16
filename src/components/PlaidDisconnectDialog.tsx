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
            <div className="mne-dialog-actions" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
              <button type="button" className="mne-btn" disabled={busy} onClick={onUnlink}>
                {busy ? 'Working…' : count > 0 ? 'Disconnect and keep my assets' : 'Disconnect'}
              </button>
              {count > 0 && (
                <button type="button" className="mne-btn is-ghost" disabled={busy} onClick={onDelete} style={{ color: 'var(--mne-loss)' }}>
                  Disconnect and delete {count} linked asset{count !== 1 ? 's' : ''}
                </button>
              )}
              <button type="button" className="mne-btn is-quiet" disabled={busy} onClick={onCancel}>Cancel</button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
