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
          <p className="text-sm text-muted-foreground">Checking linked assets…</p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              {count === 0
                ? 'No assets are linked to this connection, so only the connection is removed.'
                : `${count} asset${count !== 1 ? 's are' : ' is'} linked to this connection. Choose what happens to ${count !== 1 ? 'them' : 'it'}:`}
            </p>
            {count > 0 && (
              <ul className="text-xs text-muted-foreground max-h-32 overflow-y-auto rounded-md border border-border/60 p-2 space-y-0.5">
                {assets.map((a) => (
                  <li key={a.id}>{a.name}</li>
                ))}
              </ul>
            )}
            <div className="space-y-2 pt-1">
              <button
                type="button"
                disabled={busy}
                onClick={onUnlink}
                className="w-full bg-primary text-primary-foreground rounded-md py-2 text-xs font-medium disabled:opacity-50"
              >
                {busy ? 'Working…' : count > 0 ? 'Disconnect and keep my assets' : 'Disconnect'}
              </button>
              {count > 0 && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={onDelete}
                  className="w-full bg-destructive/10 text-destructive rounded-md py-2 text-xs font-medium hover:bg-destructive/20 disabled:opacity-50"
                >
                  Disconnect and delete {count} linked asset{count !== 1 ? 's' : ''}
                </button>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={onCancel}
                className="w-full bg-muted text-muted-foreground rounded-md py-2 text-xs hover:bg-muted/80 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
            {count > 0 && (
              <p className="text-xs text-muted-foreground">
                Keeping them leaves the assets, lots and history exactly as they are; they just stop syncing. Deleting
                removes each asset and all of its lots, and can't be undone.
              </p>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
