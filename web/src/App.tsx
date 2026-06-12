import { NavLink, Route, Routes } from 'react-router-dom'
import { ImportPage } from './pages/ImportPage'
import { PracticePage } from './pages/PracticePage'
import { SettingsPage } from './pages/SettingsPage'

export default function App() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-brand">
          <span className="app-brand-mark" aria-hidden="true">
            D
          </span>
          <div className="app-brand-text">
            <h1>Drillly</h1>
            <span className="app-brand-sub">做题本</span>
          </div>
        </div>
        <nav className="app-nav" aria-label="主导航">
          <NavLink to="/" end className={({ isActive }) => (isActive ? 'app-nav-link active' : 'app-nav-link')}>
            练习
          </NavLink>
          <NavLink
            to="/import"
            className={({ isActive }) => (isActive ? 'app-nav-link active' : 'app-nav-link')}
          >
            导入题目数据
          </NavLink>
          <NavLink
            to="/settings"
            className={({ isActive }) => (isActive ? 'app-nav-link active' : 'app-nav-link')}
          >
            设置
          </NavLink>
        </nav>
        <div className="app-header-meta">
          <span className="app-status-dot" title="本地 API" />
          <span className="app-header-caption">Study · :5213</span>
        </div>
      </header>
      <div className="app-body">
        <Routes>
          <Route path="/" element={<PracticePage />} />
          <Route path="/import" element={<ImportPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </div>
    </div>
  )
}
