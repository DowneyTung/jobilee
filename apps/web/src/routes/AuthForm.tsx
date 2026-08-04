import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ApiError } from "../api/client.ts";
import { useAuth } from "../auth/AuthProvider.tsx";

interface Props {
  mode: "login" | "register";
}

/**
 * Login and register are the same form with different copy and a different
 * submit handler, so they share one component rather than drifting apart.
 */
export function AuthForm({ mode }: Props) {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isRegister = mode === "register";

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await (isRegister ? register({ email, password }) : login({ email, password }));
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from ?? "/", { replace: true });
    } catch (cause) {
      setError(
        cause instanceof ApiError ? cause.message : "Something went wrong. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="centered">
      <form className="card auth-card" onSubmit={handleSubmit} noValidate>
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <h1>Jobilee</h1>
        </div>
        <p className="muted">
          {isRegister
            ? "Create an account to start tracking applications."
            : "Sign in to your job pipeline."}
        </p>

        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
        />

        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          autoComplete={isRegister ? "new-password" : "current-password"}
          required
          minLength={isRegister ? 8 : undefined}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder={isRegister ? "at least 8 characters" : "••••••••"}
        />

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        <button type="submit" className="primary" disabled={submitting}>
          {submitting ? "Working…" : isRegister ? "Create account" : "Sign in"}
        </button>

        <p className="muted switch">
          {isRegister ? (
            <>
              Already have an account? <Link to="/login">Sign in</Link>
            </>
          ) : (
            <>
              New here? <Link to="/register">Create an account</Link>
            </>
          )}
        </p>
      </form>
    </div>
  );
}
