import { Link } from 'react-router-dom'

const HOME_ACTIONS = [
  { to: '/play/solo', title: 'Play Solo', description: 'Start or continue a personal catching round.' },
  { to: '/rooms', title: 'Multiplayer Rooms', description: 'Create, join, or return to a shared room.' },
  { to: '/stats', title: 'Stats', description: 'Review your sessions, catches, and totals.' },
  { to: '/leaderboard', title: 'Leaderboard', description: 'See the best completed scores.' },
  { to: '/profile', title: 'Profile', description: 'View account details and future profile options.' },
]

function HomePage() {
  return (
    <main className="page-shell">
      <div className="page-header">
        <h1>Home</h1>
        <p>Choose where to go next.</p>
      </div>
      <div className="home-grid">
        {HOME_ACTIONS.map((action) => (
          <Link key={action.to} to={action.to} className="home-card">
            <strong>{action.title}</strong>
            <span>{action.description}</span>
          </Link>
        ))}
      </div>
    </main>
  )
}

export default HomePage
