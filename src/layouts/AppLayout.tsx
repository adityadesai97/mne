import { Outlet } from 'react-router-dom'
import BottomNav from './BottomNav'
import { CommandBar } from '@/components/CommandBar'

export default function AppLayout() {
  return (
    <div className="min-h-screen bg-background" style={{ paddingBottom: 'calc(4rem + env(safe-area-inset-bottom))' }}>
      <CommandBar />
      <Outlet />
      <BottomNav />
    </div>
  )
}
