import { ArrowLeft, KeyRound, LoaderCircle, LogOut, ShieldCheck, Smartphone, UserRoundCog } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { ApiError, apiFetch } from "../api/client";
import { useAuth } from "../context/AuthContext.jsx";
import { useToast } from "../context/ToastContext.jsx";

function formatSessionDate(value) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export default function SettingsPage() {
  const navigate = useNavigate();
  const showToast = useToast();
  const { user } = useAuth();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [passwordForm, setPasswordForm] = useState({
    current_password: "",
    new_password: "",
  });
  const [preferences, setPreferences] = useState({
    discoverable: true,
    notifications_enabled: true,
  });
  const [sessions, setSessions] = useState([]);

  const loadSettings = useCallback(async () => {
    try {
      setError("");
      const [preferencesResult, sessionsResult] = await Promise.all([
        apiFetch("/settings/preferences"),
        apiFetch("/auth/sessions"),
      ]);
      setPreferences({
        discoverable: Boolean(preferencesResult.discoverable),
        notifications_enabled: Boolean(preferencesResult.notifications_enabled),
      });
      setSessions(sessionsResult.items || []);
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : "Unable to load settings.");
    }
  }, []);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const savePreferences = async () => {
    try {
      setBusy("preferences");
      await apiFetch("/settings/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(preferences),
      });
      showToast("Preferences saved.", "success");
    } catch (caughtError) {
      showToast(caughtError instanceof ApiError ? caughtError.message : "Unable to save preferences.", "info");
    } finally {
      setBusy("");
    }
  };

  const changePassword = async (event) => {
    event.preventDefault();

    try {
      setBusy("password");
      await apiFetch("/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(passwordForm),
      });
      setPasswordForm({ current_password: "", new_password: "" });
      showToast("Password updated.", "success");
    } catch (caughtError) {
      showToast(caughtError instanceof ApiError ? caughtError.message : "Unable to update password.", "info");
    } finally {
      setBusy("");
    }
  };

  const revokeSession = async (sessionId) => {
    try {
      setBusy(`session:${sessionId}`);
      await apiFetch(`/auth/sessions/${sessionId}`, { method: "DELETE" });
      setSessions((current) => current.filter((item) => item.id !== sessionId));
      showToast("Session revoked.", "success");
    } catch (caughtError) {
      showToast(caughtError instanceof ApiError ? caughtError.message : "Unable to revoke session.", "info");
    } finally {
      setBusy("");
    }
  };

  const logoutAll = async () => {
    try {
      setBusy("logout-all");
      await apiFetch("/auth/logout-all", { method: "POST" });
      navigate("/login", { replace: true });
    } catch (caughtError) {
      showToast(caughtError instanceof ApiError ? caughtError.message : "Unable to log out all devices.", "info");
    } finally {
      setBusy("");
    }
  };

  return (
    <section>
      <header className="sticky top-0 z-20 border-b border-x-border bg-black/80 backdrop-blur-md">
        <div className="flex items-center gap-4 px-4 py-3 phone:px-5">
          <button aria-label="Go back" className="x-icon-button h-9 w-9" onClick={() => navigate(-1)} type="button">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <p className="text-[20px] font-extrabold text-x-primary">Settings</p>
            <p className="text-[13px] text-x-secondary">Password, sessions, notifications, and privacy controls.</p>
          </div>
        </div>
      </header>

      <div className="space-y-5 px-4 py-5 phone:px-5">
        {error ? <p className="rounded-2xl border border-x-red/35 bg-x-red/10 px-4 py-3 text-[14px] text-red-100">{error}</p> : null}

        <section className="rounded-[24px] border border-x-border bg-[#111214] p-5">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-x-blue" />
            <h2 className="text-[22px] font-extrabold text-x-primary">Privacy</h2>
          </div>
          <div className="mt-4 space-y-4">
            <label className="flex items-start justify-between gap-4 rounded-[20px] border border-white/10 bg-black/30 px-4 py-4">
              <div>
                <p className="text-[15px] font-bold text-x-primary">Appear in people search</p>
                <p className="mt-1 text-[14px] leading-6 text-x-secondary">Let new listeners discover your profile from search and suggestions.</p>
              </div>
              <input
                checked={preferences.discoverable}
                className="mt-1 h-5 w-5 accent-[#1d9bf0]"
                onChange={(event) => setPreferences((current) => ({ ...current, discoverable: event.target.checked }))}
                type="checkbox"
              />
            </label>

            <label className="flex items-start justify-between gap-4 rounded-[20px] border border-white/10 bg-black/30 px-4 py-4">
              <div>
                <p className="text-[15px] font-bold text-x-primary">In-app notifications</p>
                <p className="mt-1 text-[14px] leading-6 text-x-secondary">Keep mentions, replies, follows, and audio updates flowing into your notification sheet.</p>
              </div>
              <input
                checked={preferences.notifications_enabled}
                className="mt-1 h-5 w-5 accent-[#1d9bf0]"
                onChange={(event) => setPreferences((current) => ({ ...current, notifications_enabled: event.target.checked }))}
                type="checkbox"
              />
            </label>
          </div>

          <div className="mt-4 flex justify-end">
            <button
              className="inline-flex items-center gap-2 rounded-full bg-x-blue px-5 py-2.5 text-[15px] font-bold text-white transition hover:bg-[#1a8cd8] disabled:cursor-not-allowed disabled:opacity-60"
              disabled={busy === "preferences"}
              onClick={() => void savePreferences()}
              type="button"
            >
              {busy === "preferences" ? <LoaderCircle className="h-[18px] w-[18px] animate-spin" /> : null}
              Save preferences
            </button>
          </div>
        </section>

        <section className="rounded-[24px] border border-x-border bg-[#111214] p-5">
          <div className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-x-blue" />
            <h2 className="text-[22px] font-extrabold text-x-primary">Password</h2>
          </div>
          <form className="mt-4 space-y-4" onSubmit={changePassword}>
            <label className="block">
              <span className="mb-2 block text-[14px] font-semibold text-x-primary">Current password</span>
              <input
                className="x-input rounded-[20px]"
                onChange={(event) => setPasswordForm((current) => ({ ...current, current_password: event.target.value }))}
                required
                type="password"
                value={passwordForm.current_password}
              />
            </label>
            <label className="block">
              <span className="mb-2 block text-[14px] font-semibold text-x-primary">New password</span>
              <input
                className="x-input rounded-[20px]"
                minLength={8}
                onChange={(event) => setPasswordForm((current) => ({ ...current, new_password: event.target.value }))}
                required
                type="password"
                value={passwordForm.new_password}
              />
            </label>
            <div className="flex justify-end">
              <button
                className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-[15px] font-bold text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={busy === "password"}
                type="submit"
              >
                {busy === "password" ? <LoaderCircle className="h-[18px] w-[18px] animate-spin" /> : null}
                Update password
              </button>
            </div>
          </form>
        </section>

        <section className="rounded-[24px] border border-x-border bg-[#111214] p-5">
          <div className="flex items-center gap-2">
            <Smartphone className="h-5 w-5 text-x-blue" />
            <h2 className="text-[22px] font-extrabold text-x-primary">Sessions</h2>
          </div>
          <p className="mt-2 text-[14px] leading-6 text-x-secondary">Review every signed-in device and revoke anything you no longer trust.</p>

          <div className="mt-4 space-y-3">
            {sessions.length ? (
              sessions.map((session) => (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-[20px] border border-white/10 bg-black/30 px-4 py-4" key={session.id}>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-[15px] font-bold text-x-primary">{session.user_agent || "Unknown device"}</p>
                      {session.current ? <span className="x-pill">Current</span> : null}
                    </div>
                    <p className="mt-1 text-[13px] text-x-secondary">Created {formatSessionDate(session.created_at)} • Last seen {formatSessionDate(session.last_seen_at)}</p>
                    {session.ip_address ? <p className="mt-1 text-[13px] text-x-secondary">IP {session.ip_address}</p> : null}
                  </div>
                  {!session.current ? (
                    <button
                      className="rounded-full border border-white/10 px-4 py-2 text-[14px] font-bold text-x-primary transition hover:bg-white/[0.04] disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={busy === `session:${session.id}`}
                      onClick={() => void revokeSession(session.id)}
                      type="button"
                    >
                      {busy === `session:${session.id}` ? "Revoking..." : "Revoke"}
                    </button>
                  ) : null}
                </div>
              ))
            ) : (
              <p className="rounded-[20px] border border-white/10 bg-black/30 px-4 py-4 text-[14px] text-x-secondary">No active sessions found.</p>
            )}
          </div>

          <div className="mt-4 flex justify-end">
            <button
              className="inline-flex items-center gap-2 rounded-full border border-x-red/35 bg-x-red/10 px-5 py-2.5 text-[15px] font-bold text-red-100 transition hover:bg-x-red/20 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={busy === "logout-all"}
              onClick={() => void logoutAll()}
              type="button"
            >
              {busy === "logout-all" ? <LoaderCircle className="h-[18px] w-[18px] animate-spin" /> : <LogOut className="h-[18px] w-[18px]" />}
              Log out all devices
            </button>
          </div>
        </section>

        <section className="rounded-[24px] border border-x-border bg-[#111214] p-5">
          <div className="flex items-center gap-2">
            <UserRoundCog className="h-5 w-5 text-x-blue" />
            <h2 className="text-[22px] font-extrabold text-x-primary">Account snapshot</h2>
          </div>
          <div className="mt-4 grid gap-3 phone:grid-cols-2">
            <div className="rounded-[20px] border border-white/10 bg-black/30 px-4 py-4">
              <p className="text-[13px] font-semibold uppercase tracking-[0.2em] text-x-secondary">Username</p>
              <p className="mt-2 text-[18px] font-bold text-x-primary">{user?.username}</p>
            </div>
            <div className="rounded-[20px] border border-white/10 bg-black/30 px-4 py-4">
              <p className="text-[13px] font-semibold uppercase tracking-[0.2em] text-x-secondary">Role</p>
              <p className="mt-2 text-[18px] font-bold capitalize text-x-primary">{user?.role}</p>
            </div>
          </div>
        </section>
      </div>
    </section>
  );
}
