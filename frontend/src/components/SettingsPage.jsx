import { ArrowLeft, Eye, EyeOff, KeyRound, LoaderCircle, LogOut, ShieldCheck, Smartphone, UserRoundCog } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { ApiError, apiFetch, getMediaUrl } from "../api/client";
import { useAuth } from "../context/AuthContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import ConfirmDialog from "./ConfirmDialog.jsx";

function formatSessionDate(value) {
  return new Intl.DateTimeFormat("ru-RU", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function SectionCard({ children, description, icon: Icon, title }) {
  return (
    <section className="m3-panel settings-section-card">
      <div className="settings-section-card__header">
        <div className="settings-section-card__icon">
          <Icon size={18} />
        </div>
        <div className="settings-section-card__copy">
          <h2 className="m3-title-medium" style={{ fontSize: 20 }}>
            {title}
          </h2>
          {description ? (
            <p className="m3-body-small" style={{ marginTop: 4 }}>
              {description}
            </p>
          ) : null}
        </div>
      </div>
      <div className="settings-section-card__body">{children}</div>
    </section>
  );
}

export default function SettingsPage() {
  const navigate = useNavigate();
  const showToast = useToast();
  const { clearSession, logoutEverywhere, updateProfile, user } = useAuth();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [profileForm, setProfileForm] = useState({
    avatar_url: "",
    bio: "",
  });
  const [savedProfileForm, setSavedProfileForm] = useState({
    avatar_url: "",
    bio: "",
  });
  const [passwordForm, setPasswordForm] = useState({
    current_password: "",
    new_password: "",
  });
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [preferences, setPreferences] = useState({
    discoverable: true,
    notifications_enabled: true,
  });
  const [savedPreferences, setSavedPreferences] = useState({
    discoverable: true,
    notifications_enabled: true,
  });
  const [confirmRequest, setConfirmRequest] = useState(null);
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
      setSavedPreferences({
        discoverable: Boolean(preferencesResult.discoverable),
        notifications_enabled: Boolean(preferencesResult.notifications_enabled),
      });
      setSessions(sessionsResult.items || []);
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : "Не удалось загрузить настройки.");
    }
  }, []);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    const nextProfileForm = {
      avatar_url: user?.avatar_url || "",
      bio: user?.bio || "",
    };
    setProfileForm(nextProfileForm);
    setSavedProfileForm(nextProfileForm);
  }, [user?.avatar_url, user?.bio]);

  const isProfileDirty = useMemo(
    () => profileForm.avatar_url.trim() !== savedProfileForm.avatar_url.trim() || profileForm.bio.trim() !== savedProfileForm.bio.trim(),
    [profileForm.avatar_url, profileForm.bio, savedProfileForm.avatar_url, savedProfileForm.bio],
  );
  const isPreferencesDirty = useMemo(
    () =>
      preferences.discoverable !== savedPreferences.discoverable ||
      preferences.notifications_enabled !== savedPreferences.notifications_enabled,
    [preferences.discoverable, preferences.notifications_enabled, savedPreferences.discoverable, savedPreferences.notifications_enabled],
  );

  const saveProfile = async () => {
    try {
      setBusy("profile");
      const nextProfileForm = {
        avatar_url: profileForm.avatar_url.trim() || null,
        bio: profileForm.bio.trim() || null,
      };
      await updateProfile(nextProfileForm);
      setSavedProfileForm({
        avatar_url: nextProfileForm.avatar_url || "",
        bio: nextProfileForm.bio || "",
      });
      showToast("Профиль обновлён.", "success");
    } catch (caughtError) {
      showToast(caughtError instanceof ApiError ? caughtError.message : "Не удалось сохранить профиль.", "info");
    } finally {
      setBusy("");
    }
  };

  const savePreferences = async () => {
    try {
      setBusy("preferences");
      await apiFetch("/settings/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(preferences),
      });
      setSavedPreferences(preferences);
      showToast("Настройки сохранены.", "success");
    } catch (caughtError) {
      showToast(caughtError instanceof ApiError ? caughtError.message : "Не удалось сохранить настройки.", "info");
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
      clearSession();
      showToast("Пароль обновлён. Войдите снова с новым паролем.", "success");
      navigate("/login", { replace: true });
    } catch (caughtError) {
      showToast(caughtError instanceof ApiError ? caughtError.message : "Не удалось обновить пароль.", "info");
    } finally {
      setBusy("");
    }
  };

  const revokeSession = async (sessionId) => {
    try {
      setBusy(`session:${sessionId}`);
      await apiFetch(`/auth/sessions/${sessionId}`, { method: "DELETE" });
      setSessions((current) => current.filter((item) => item.id !== sessionId));
      setConfirmRequest(null);
      showToast("Сессия завершена.", "success");
    } catch (caughtError) {
      showToast(caughtError instanceof ApiError ? caughtError.message : "Не удалось завершить сессию.", "info");
    } finally {
      setBusy("");
    }
  };

  const logoutAll = async () => {
    try {
      setBusy("logout-all");
      await logoutEverywhere();
      setConfirmRequest(null);
      navigate("/login", { replace: true });
    } catch (caughtError) {
      showToast(caughtError instanceof ApiError ? caughtError.message : "Не удалось выйти на всех устройствах.", "info");
    } finally {
      setBusy("");
    }
  };

  const profilePreviewUrl = profileForm.avatar_url.trim() ? getMediaUrl(profileForm.avatar_url.trim()) : "";
  const profileRole = String(user?.role || "user");

  return (
    <section>
      <header className="top-app-bar">
        <div className="top-app-bar__inner page-header-bar">
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button aria-label="Go back" className="m3-icon-button m3-icon-button--outlined m3-interactive" onClick={() => navigate(-1)} type="button">
              <ArrowLeft size={18} />
            </button>
            <div>
              <p className="m3-section-label">Аккаунт</p>
              <h1 className="top-app-bar__title" style={{ fontSize: 22 }}>
                Настройки
              </h1>
            </div>
          </div>
          <p className="m3-body-small page-header-bar__meta">Профиль, приватность и сессии</p>
        </div>
      </header>

      <div className="main-page-stack">
        {error ? <p className="m3-error">{error}</p> : null}

        <SectionCard description="Обновите профиль, который слушатели видят перед подпиской." icon={UserRoundCog} title="Профиль">
          <div className="m3-card settings-profile-card">
            {profilePreviewUrl ? (
              <img
                alt={user?.username || "Аватар профиля"}
                loading="lazy"
                src={profilePreviewUrl}
                style={{ width: 72, height: 72, borderRadius: "50%", objectFit: "cover", border: "1px solid var(--md-sys-color-outline)" }}
              />
            ) : (
              <div className="m3-avatar" style={{ width: 72, height: 72, fontSize: 22 }}>
                {(user?.username || "VA").slice(0, 2).toUpperCase()}
              </div>
            )}

            <div className="settings-profile-card__identity">
              <p className="m3-title-medium settings-profile-card__name">
                {user?.username}
              </p>
              <p className="m3-body-small settings-profile-card__handle">
                @{(user?.username || "").toLowerCase()} {"\u00b7"} {profileRole}
              </p>
              <p className="settings-profile-card__bio">
                {profileForm.bio.trim() || "Добавьте короткое описание, чтобы слушатели понимали, какие записи вы публикуете."}
              </p>
            </div>
          </div>

          <label style={{ display: "grid", gap: 8 }}>
            <span className="m3-title-medium" style={{ fontSize: 14 }}>
              Ссылка на аватар
            </span>
            <input
              autoComplete="off"
              className="m3-input"
              name="avatar_url"
              onChange={(event) => setProfileForm((current) => ({ ...current, avatar_url: event.target.value }))}
              placeholder="https://example.com/avatar.jpg"
              type="url"
              value={profileForm.avatar_url}
            />
          </label>

          <label style={{ display: "grid", gap: 8 }}>
            <span className="m3-title-medium" style={{ fontSize: 14 }}>
              Описание
            </span>
            <textarea
              className="m3-textarea"
              maxLength={160}
              name="bio"
              onChange={(event) => setProfileForm((current) => ({ ...current, bio: event.target.value }))}
              placeholder="Расскажите, что вы записываете и почему на вас стоит подписаться…"
              value={profileForm.bio}
            />
            <span className="m3-body-small settings-field-meta">{profileForm.bio.length}/160</span>
          </label>

          <div className="settings-action-row">
            <button className="m3-button m3-button-filled m3-fab m3-interactive" disabled={busy === "profile" || !isProfileDirty} onClick={() => void saveProfile()} type="button">
              {busy === "profile" ? <LoaderCircle size={16} style={{ animation: "spin 1s linear infinite" }} /> : null}
              {busy === "profile" ? "Сохранение\u2026" : isProfileDirty ? "Сохранить профиль" : "Профиль сохранён"}
            </button>
          </div>
        </SectionCard>

        <SectionCard description="Управляйте видимостью профиля и уведомлениями." icon={ShieldCheck} title="Приватность">
          <label className="m3-card settings-toggle-card">
            <div className="settings-toggle-card__copy">
              <p className="m3-title-medium">Показывать в поиске</p>
              <p className="m3-body-small" style={{ marginTop: 4 }}>
                Разрешить новым слушателям находить ваш профиль через поиск и рекомендации.
              </p>
            </div>
            <input
              checked={preferences.discoverable}
              className="m3-switch"
              onChange={(event) => setPreferences((current) => ({ ...current, discoverable: event.target.checked }))}
              type="checkbox"
            />
          </label>

          <label className="m3-card settings-toggle-card">
            <div className="settings-toggle-card__copy">
              <p className="m3-title-medium">Уведомления в приложении</p>
              <p className="m3-body-small" style={{ marginTop: 4 }}>
                Показывать ответы, подписки и обновления транскрипции в списке уведомлений.
              </p>
            </div>
            <input
              checked={preferences.notifications_enabled}
              className="m3-switch"
              onChange={(event) => setPreferences((current) => ({ ...current, notifications_enabled: event.target.checked }))}
              type="checkbox"
            />
          </label>

          <div className="settings-action-row">
            <button className="m3-button m3-button-filled m3-fab m3-interactive" disabled={busy === "preferences" || !isPreferencesDirty} onClick={() => void savePreferences()} type="button">
              {busy === "preferences" ? <LoaderCircle size={16} style={{ animation: "spin 1s linear infinite" }} /> : null}
              {isPreferencesDirty ? "Сохранить настройки" : "Настройки сохранены"}
            </button>
          </div>
        </SectionCard>

        <SectionCard description="Смените пароль, не выходя из текущей сессии." icon={KeyRound} title="Пароль">
          <form onSubmit={changePassword} style={{ display: "grid", gap: 14 }}>
            <input aria-hidden="true" autoComplete="username" className="sr-only" readOnly tabIndex={-1} type="text" value={user?.email || user?.username || ""} />
            <label style={{ display: "grid", gap: 8 }}>
              <span className="m3-title-medium" style={{ fontSize: 14 }}>
                Текущий пароль
              </span>
              <div className="password-field">
                <input
                  autoComplete="current-password"
                  className="m3-input password-field__input"
                  name="current_password"
                  onChange={(event) => setPasswordForm((current) => ({ ...current, current_password: event.target.value }))}
                  required
                  type={showCurrentPassword ? "text" : "password"}
                  value={passwordForm.current_password}
                />
                <button
                  aria-label={showCurrentPassword ? "Скрыть текущий пароль" : "Показать текущий пароль"}
                  aria-pressed={showCurrentPassword}
                  className="password-field__toggle m3-interactive m3-state-neutral"
                  onClick={() => setShowCurrentPassword((current) => !current)}
                  type="button"
                >
                  {showCurrentPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </label>
            <label style={{ display: "grid", gap: 8 }}>
              <span className="m3-title-medium" style={{ fontSize: 14 }}>
                Новый пароль
              </span>
              <div className="password-field">
                <input
                  autoComplete="new-password"
                  className="m3-input password-field__input"
                  minLength={8}
                  name="new_password"
                  onChange={(event) => setPasswordForm((current) => ({ ...current, new_password: event.target.value }))}
                  required
                  type={showNewPassword ? "text" : "password"}
                  value={passwordForm.new_password}
                />
                <button
                  aria-label={showNewPassword ? "Скрыть новый пароль" : "Показать новый пароль"}
                  aria-pressed={showNewPassword}
                  className="password-field__toggle m3-interactive m3-state-neutral"
                  onClick={() => setShowNewPassword((current) => !current)}
                  type="button"
                >
                  {showNewPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </label>
            <div className="settings-action-row">
              <button className="m3-button m3-button-filled m3-fab m3-interactive" disabled={busy === "password"} type="submit">
                {busy === "password" ? <LoaderCircle size={16} style={{ animation: "spin 1s linear infinite" }} /> : null}
                Обновить пароль
              </button>
            </div>
          </form>
        </SectionCard>

        <SectionCard description="Проверьте все активные устройства и завершите лишние сессии." icon={Smartphone} title="Сессии">
          {sessions.length ? (
            sessions.map((session) => (
              <div className="m3-card settings-session-card" key={session.id}>
                <div className="settings-session-card__copy">
                  <div className="settings-session-card__header">
                    <p className="m3-title-medium m3-break-anywhere">{session.user_agent || "Неизвестное устройство"}</p>
                    {session.current ? <span className="m3-chip m3-chip-filled">Текущая</span> : null}
                  </div>
                  <p className="m3-body-small" style={{ marginTop: 4 }}>
                    Создана {formatSessionDate(session.created_at)} {"\u00b7"} Последняя активность {formatSessionDate(session.last_seen_at)}
                  </p>
                  {session.ip_address ? (
                    <p className="m3-body-small" style={{ marginTop: 4 }}>
                      IP {session.ip_address}
                    </p>
                  ) : null}
                </div>

                {!session.current ? (
                  <button className="m3-button m3-button-outlined m3-interactive" disabled={busy === `session:${session.id}`} onClick={() => setConfirmRequest({ type: "session", session })} type="button">
                    {busy === `session:${session.id}` ? "Завершение\u2026" : "Завершить"}
                  </button>
                ) : null}
              </div>
            ))
          ) : (
            <div className="m3-card settings-empty-card">
              <p className="m3-title-medium">Дополнительных сессий нет</p>
              <p className="m3-body-small" style={{ marginTop: 4 }}>
                Когда вы войдёте на других устройствах, они появятся здесь, и вы сможете быстро завершить их сессии.
              </p>
            </div>
          )}

          <div className="settings-action-row">
            <button className="m3-button m3-button-outlined m3-interactive m3-state-tertiary" disabled={busy === "logout-all"} onClick={() => setConfirmRequest({ type: "logout-all" })} type="button">
              {busy === "logout-all" ? <LoaderCircle size={16} style={{ animation: "spin 1s linear infinite" }} /> : <LogOut size={16} />}
              Выйти на всех устройствах
            </button>
          </div>
        </SectionCard>
      </div>
      <ConfirmDialog
        busy={busy === "logout-all" || (confirmRequest?.type === "session" && busy === `session:${confirmRequest.session.id}`)}
        confirmLabel={confirmRequest?.type === "logout-all" ? "Выйти везде" : "Завершить"}
        description={
          confirmRequest?.type === "logout-all"
            ? "На остальных устройствах потребуется повторный вход."
            : "На выбранном устройстве понадобится повторный вход."
        }
        onCancel={() => setConfirmRequest(null)}
        onConfirm={() => {
          if (confirmRequest?.type === "logout-all") {
            void logoutAll();
            return;
          }
          if (confirmRequest?.type === "session") {
            void revokeSession(confirmRequest.session.id);
          }
        }}
        open={Boolean(confirmRequest)}
        title={confirmRequest?.type === "logout-all" ? "Выйти на всех устройствах?" : "Завершить эту сессию?"}
      />
    </section>
  );
}
