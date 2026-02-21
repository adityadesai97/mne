// src/pages/Settings.tsx
import { useEffect, useState } from 'react'
import { getSettings, saveSettings } from '@/lib/db/settings'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { config } from '@/store/config'
import { exportData, importData } from '@/lib/importExport'

export default function Settings() {
  const [settings, setSettings] = useState({
    price_alert_threshold: 5,
    tax_harvest_threshold: 1000,
    rsu_alert_days_before: 7,
  })

  useEffect(() => {
    getSettings().then(s => { if (s) setSettings(s as any) }).catch(console.error)
  }, [])

  async function handleSave() {
    await saveSettings(settings)
    alert('Saved')
  }

  return (
    <div className="pt-6 pb-4 px-4 space-y-4">
      <h1 className="text-xl font-bold">Settings</h1>

      <Card>
        <CardHeader><CardTitle className="text-sm">Notifications</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="price-alert">Price alert threshold (%)</Label>
            <Input id="price-alert" type="number" value={settings.price_alert_threshold}
              onChange={e => setSettings(s => ({ ...s, price_alert_threshold: Number(e.target.value) }))} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="tax-harvest">Tax harvest threshold ($)</Label>
            <Input id="tax-harvest" type="number" value={settings.tax_harvest_threshold}
              onChange={e => setSettings(s => ({ ...s, tax_harvest_threshold: Number(e.target.value) }))} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="rsu-alert">RSU vest reminder (days before)</Label>
            <Input id="rsu-alert" type="number" value={settings.rsu_alert_days_before}
              onChange={e => setSettings(s => ({ ...s, rsu_alert_days_before: Number(e.target.value) }))} />
          </div>
          <Button onClick={handleSave} className="w-full">Save</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm">Data</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <Button variant="outline" className="w-full" onClick={exportData}>Export JSON</Button>
          <Button variant="outline" className="w-full" onClick={() => document.getElementById('import-file')?.click()}>
            Import JSON
          </Button>
          <input id="import-file" type="file" accept=".json" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) importData(f) }} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm">API Keys</CardTitle></CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">Claude: {config.claudeApiKey ? '••••••' : 'Not set'}</p>
          <p className="text-muted-foreground text-sm">Finnhub: {config.finnhubApiKey ? '••••••' : 'Not set'}</p>
          <Button variant="outline" className="w-full mt-3" onClick={() => { config.clear(); window.location.reload() }}>
            Reset & Re-configure
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
