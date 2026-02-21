import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

export default function App() {
  return (
    <div className="min-h-screen bg-background text-foreground p-6 space-y-4">
      <h1 className="text-4xl font-bold">mne</h1>
      <Card>
        <CardHeader>
          <CardTitle>Net Worth</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-3xl font-bold text-gain">$575,283</p>
          <p className="text-loss mt-1">-$2,400 today</p>
        </CardContent>
      </Card>
      <div className="flex gap-2">
        <Button>Primary</Button>
        <Button variant="outline">Outline</Button>
        <Badge>AI</Badge>
        <Badge variant="secondary">Technology</Badge>
      </div>
    </div>
  )
}
