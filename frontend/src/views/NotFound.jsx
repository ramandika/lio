import { Link } from 'react-router-dom'

export default function NotFound() {
  return (
    <div className="empty">
      <h1 className="empty__title">Page Not Found</h1>
      <p className="empty__body">The address did not match anything in this system.</p>
      <Link className="btn btn--primary" to="/">
        Back to askLio
      </Link>
    </div>
  )
}