import { Outlet } from 'react-router-dom'
import BottomNav from './BottomNav'
import { CommandBar } from '@/components/CommandBar'

export default function AppLayout() {
  return (
    <div className="min-h-screen bg-background pb-16">
      <CommandBar />
      <Outlet />
      <BottomNav />
    </div>
  )
}
