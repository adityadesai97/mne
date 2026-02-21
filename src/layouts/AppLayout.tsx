import { Outlet } from 'react-router-dom'
import BottomNav from './BottomNav'

export default function AppLayout() {
  return (
    <div className="min-h-screen bg-background pb-16">
      <Outlet />
      <BottomNav />
    </div>
  )
}
