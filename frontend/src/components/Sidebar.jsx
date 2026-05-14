import { Bell, Compass, Home, LogIn, LogOut, Mic, Settings, Shield, User, UserPlus } from "lucide-react";
import { Link, useLocation } from "react-router-dom";

import BrandMark from "./BrandMark.jsx";

function NavItem({ active, className = "", hasBadge = false, icon: Icon, label, onClick, to }) {
  const content = (
    <span
      className={[
        "m3-nav-item",
        "m3-interactive",
        className,
        active ? "is-active" : "",
      ].join(" ").trim()}
      aria-current={active ? "page" : undefined}
    >
      <span className="m3-nav-item__icon">
        <Icon aria-hidden="true" size={20} strokeWidth={active ? 2.2 : 1.8} />
        {hasBadge ? <span className="m3-nav-item__badge" /> : null}
      </span>
      <span className="sidebar-nav-label">
        {label}
      </span>
    </span>
  );

  if (to) {
    return (
      <Link aria-label={label} className="sidebar-nav-link" title={label} to={to}>
        {content}
      </Link>
    );
  }

  return (
    <button aria-label={label} className="sidebar-nav-button" onClick={onClick} title={label} type="button">
      {content}
    </button>
  );
}

function UserSummary({ onLogout, user }) {
  if (!user) {
    return (
      <div className="sidebar-footer">
        <div className="m3-panel sidebar-guest-card">
          <div className="sidebar-guest-card__actions">
            <Link aria-label="Создать аккаунт" className="m3-icon-button m3-icon-button--filled m3-interactive" title="Создать аккаунт" to="/register">
              <UserPlus size={16} />
            </Link>
            <Link aria-label="Войти" className="m3-icon-button m3-icon-button--outlined m3-interactive" title="Войти" to="/login">
              <LogIn size={16} />
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="sidebar-footer">
      <div className="m3-panel sidebar-account-card">
        <Link aria-label="Открыть профиль" className="m3-interactive sidebar-account-card__summary" title={user.username} to="/profile">
          <div className="m3-avatar sidebar-account-card__avatar">
            {user.username.slice(0, 2).toUpperCase()}
          </div>
          <div className="sidebar-footer-copy sidebar-account-card__copy">
            <p className="m3-title-medium sidebar-account-card__name">
              {user.username}
            </p>
            <p className="m3-body-small sidebar-account-card__handle">
              @{user.username.toLowerCase()}
            </p>
          </div>
        </Link>
        <div className="sidebar-account-card__divider" />
        <div className="sidebar-account-card__actions">
          <Link aria-label="Настройки" className="m3-icon-button m3-icon-button--outlined m3-interactive" title="Настройки" to="/settings">
            <Settings size={16} />
          </Link>
          <button aria-label="Выйти" className="m3-icon-button m3-icon-button--outlined m3-interactive" onClick={onLogout} title="Выйти" type="button">
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Sidebar({
  isComposerActive = false,
  isNotificationsActive = false,
  isSearchActive = false,
  onCompose,
  onLogout,
  onOpenNotifications,
  onOpenSearch,
  unreadCount = 0,
  user,
}) {
  const { pathname } = useLocation();

  const items = [
    { key: "feed", label: "Главная", icon: Home, active: pathname === "/", to: "/" },
    {
      key: "discover",
      label: "Поиск",
      icon: Compass,
      active: pathname === "/search" || isSearchActive,
      to: "/search",
    },
    { key: "notifications", label: "Уведомления", icon: Bell, active: isNotificationsActive, hasBadge: unreadCount > 0, onClick: onOpenNotifications },
    { key: "profile", label: "Профиль", icon: User, active: pathname.startsWith("/profile"), to: user ? "/profile" : "/login" },
    {
      key: "admin",
      label: "Админ",
      icon: Shield,
      active: pathname === "/admin",
      to: "/admin",
      hidden: String(user?.role || "").toLowerCase() !== "admin",
    },
  ];

  return (
    <aside aria-label="Основная боковая панель" className="sidebar-shell">
      <div className="sidebar-shell__top">
        <Link aria-label="На главную Flutter" className="sidebar-brand m3-interactive" title="На главную Flutter" to="/">
          <BrandMark size={52} />
          <div className="sidebar-brand-copy">
            <p className="m3-section-label">Flutter</p>
            <p className="m3-title-medium sidebar-brand-copy__title">
              Аудио-социальная сеть
            </p>
          </div>
        </Link>

        <nav aria-label="Основная навигация" className="sidebar-nav">
          {items
            .filter((item) => !item.hidden)
            .map((item) => (
              <NavItem
                active={item.active}
                className={item.className}
                hasBadge={item.hasBadge}
                icon={item.icon}
                key={item.key}
                label={item.label}
                onClick={item.onClick}
                to={item.to}
              />
            ))}
        </nav>

        <div className="sidebar-compose-slot">
          <button
            aria-label="Записать пост"
            className={["sidebar-compose-button", "m3-interactive", isComposerActive ? "is-active" : ""].join(" ")}
            onClick={onCompose}
            title="Записать пост"
            type="button"
          >
            <Mic size={18} />
          </button>
        </div>
      </div>

      <UserSummary onLogout={onLogout} user={user} />
    </aside>
  );
}
