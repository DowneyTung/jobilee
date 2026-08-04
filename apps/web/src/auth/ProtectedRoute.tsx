import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "./AuthProvider.tsx";

/**
 * Gate for authenticated pages. Waits for the session check to settle before
 * deciding — redirecting during `loading` would bounce a logged-in user to the
 * login screen on every refresh.
 */
export function ProtectedRoute() {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="centered" role="status" aria-live="polite">
        <span className="spinner" aria-hidden="true" />
        <p className="muted">Restoring your session…</p>
      </div>
    );
  }

  if (!user) {
    // Remember where they were headed so login can send them back.
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}
