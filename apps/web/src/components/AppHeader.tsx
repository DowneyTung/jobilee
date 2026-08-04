import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider.tsx";

export function AppHeader({ children }: { children?: React.ReactNode }) {
  const { user, logout } = useAuth();

  return (
    <header className="app-header">
      <Link to="/" className="brand" aria-label="Jobilee home">
        <span className="brand-mark" aria-hidden="true" />
        <strong>Jobilee</strong>
      </Link>
      <div className="header-right">
        {children}
        <Link to="/settings" className="header-link">
          Resume
        </Link>
        <span className="muted hide-narrow">{user?.email}</span>
        <button type="button" className="ghost" onClick={logout}>
          Sign out
        </button>
      </div>
    </header>
  );
}
