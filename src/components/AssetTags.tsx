import type { ElementType } from 'react'
import { Award, Briefcase, Link2, User, Users } from 'lucide-react'
import { Tooltip } from '@/components/mne/Tooltip'
import { getPlaidSyncInfo } from '@/lib/portfolio'

interface Tag { key: string; label: string; icon: ElementType; accent?: boolean }

function stockPlanTypes(asset: any): string[] {
  const out = new Set<string>()
  for (const st of asset.stock_subtypes ?? []) {
    if ((st.subtype === 'RSU' || st.subtype === 'ESPP') && ((st.transactions?.length ?? 0) > 0 || (st.rsu_grants?.length ?? 0) > 0)) out.add(st.subtype)
  }
  return Array.from(out)
}

function assetTags(asset: any): Tag[] {
  const tags: Tag[] = []
  const sync = getPlaidSyncInfo(asset)
  if (sync.synced) {
    tags.push({ key: 'synced', label: sync.institutionName ? `Synced via Plaid (${sync.institutionName})` : 'Synced via Plaid', icon: Link2, accent: true })
  }
  for (const t of stockPlanTypes(asset)) {
    tags.push({ key: t, label: t === 'RSU' ? 'Includes RSUs' : 'Includes ESPP shares', icon: t === 'RSU' ? Briefcase : Award })
  }
  if (asset.ownership === 'Joint') tags.push({ key: 'joint', label: 'Joint account', icon: Users })
  else if (asset.ownership) tags.push({ key: 'individual', label: 'Individual account', icon: User })
  return tags
}

/** Icon-only asset tags (synced, RSU/ESPP, ownership); the text lives in a tooltip and aria-label. */
export function AssetTags({ asset }: { asset: any }) {
  const tags = assetTags(asset)
  if (tags.length === 0) return null
  return (
    <span className="pf-tags">
      {tags.map(({ key, label, icon: Icon, accent }) => (
        <Tooltip key={key} content={label}>
          <span className={`pf-tag${accent ? ' is-synced' : ''}`} tabIndex={0} role="img" aria-label={label}>
            <Icon size={16} strokeWidth={1.5} aria-hidden="true" />
          </span>
        </Tooltip>
      ))}
    </span>
  )
}
