import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/authContextCore'

function AppLayout() {
  const { currentUser, logout } = useAuth()
  const navigate = useNavigate()

  function handleLogout() {
    logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="app-layout">
      <header className="app-navbar">
        <NavLink to="/home" className="app-brand">
          Route Catch
        </NavLink>
        <nav className="app-nav-links" aria-label="Primary navigation">
          <NavLink to="/play/solo">Solo</NavLink>
          <NavLink to="/rooms">Rooms</NavLink>
          <NavLink to="/stats">Stats</NavLink>
          <NavLink to="/leaderboard">Leaderboard</NavLink>
          <NavLink to="/profile">Profile</NavLink>
        </nav>
        <div className="app-account">
          <span>{currentUser?.displayName || 'Player'}</span>
          <button type="button" onClick={handleLogout}>
            Logout
          </button>
        </div>
      </header>
      <div className="app-content">
        <Outlet />
      </div>
    </div>
  )
}

export default AppLayout
