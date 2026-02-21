import { createBrowserRouter } from 'react-router-dom'
import AppLayout from './layouts/AppLayout'
import Home from './pages/Home'
import Portfolio from './pages/Portfolio'
import Tax from './pages/Tax'
import Watchlist from './pages/Watchlist'
import Settings from './pages/Settings'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <Home /> },
      { path: 'portfolio', element: <Portfolio /> },
      { path: 'tax', element: <Tax /> },
      { path: 'watchlist', element: <Watchlist /> },
      { path: 'settings', element: <Settings /> },
    ],
  },
])
