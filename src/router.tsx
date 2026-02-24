import { createBrowserRouter } from 'react-router-dom'
import AppLayout from './layouts/AppLayout'
import Home from './pages/Home'
import Portfolio from './pages/Portfolio'
import Charts from './pages/Charts'
import Watchlist from './pages/Watchlist'
import Settings from './pages/Settings'
import AssetDetail from './pages/AssetDetail'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <Home /> },
      { path: 'portfolio', element: <Portfolio /> },
      { path: 'portfolio/:id', element: <AssetDetail /> },
      { path: 'charts', element: <Charts /> },
      { path: 'watchlist', element: <Watchlist /> },
      { path: 'settings', element: <Settings /> },
    ],
  },
])
