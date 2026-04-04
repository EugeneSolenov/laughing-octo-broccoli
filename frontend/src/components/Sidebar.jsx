import { Bell, Compass, Feather, Home, LogIn, LogOut, Settings, Shield, User, UserPlus } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";

function NavButton({ active, badgeCount = 0, icon: Icon, label, onClick }) {
  return (
    <button
      className={[
        "group flex w-full items-center justify-center rounded-full p-3 text-x-primary transition tablet:justify-start tablet:px-3 desktop:px-4",
        active ? "font-bold text-white" : "text-x-primary hover:bg-x-hover",
      ].join(" ")}
      onClick={onClick}
      type="button"
    >
      <span className={["relative flex h-12 w-12 items-center justify-center rounded-full transition", active ? "bg-x-hover" : "group-hover:bg-x-hover"].join(" ")}>
        <Icon className="h-7 w-7" fill={active ? "currentColor" : "none"} strokeWidth={active ? 2.4 : 2} />
        {badgeCount ? (
          <span className="absolute right-1 top-1 inline-flex min-w-[18px] items-center justify-center rounded-full bg-x-blue px-1.5 text-[11px] font-bold text-white">
            {badgeCount > 9 ? "9+" : badgeCount}
          </span>
        ) : null}
      </span>
      <span className="ml-4 hidden text-[20px] leading-6 desktop:block">{label}</span>
    </button>
  );
}

export default function Sidebar({ onCompose, onLogout, onOpenNotifications, onOpenSearch, unreadCount = 0, user }) {
  const location = useLocation();
  const navigate = useNavigate();
  const pathname = location.pathname;

  const items = [
    {
      key: "home",
      label: "Home",
      icon: Home,
      active: pathname === "/",
      onClick: () => navigate("/"),
      visible: true,
    },
    {
      key: "explore",
      label: "Explore",
      icon: Compass,
      active: false,
      onClick: onOpenSearch,
      visible: true,
    },
    {
      key: "notifications",
      label: "Notifications",
      icon: Bell,
      badgeCount: unreadCount,
      active: false,
      onClick: onOpenNotifications,
      visible: true,
    },
    {
      key: "profile",
      label: "Profile",
      icon: User,
      active: pathname.startsWith("/profile"),
      onClick: () => navigate(user ? "/profile" : "/login"),
      visible: true,
    },
    {
      key: "settings",
      label: "Settings",
      icon: Settings,
      active: pathname === "/settings",
      onClick: () => navigate(user ? "/settings" : "/login"),
      visible: Boolean(user),
    },
    {
      key: "admin",
      label: "Admin",
      icon: Shield,
      active: pathname === "/admin",
      onClick: () => navigate("/admin"),
      visible: String(user?.role || "").toLowerCase() === "admin",
    },
  ];

  return (
    <aside className="flex h-screen flex-col justify-between px-2 py-2 desktop:pr-3">
      <div className="space-y-1">
        <Link className="inline-flex h-14 w-14 items-center justify-center rounded-full text-x-primary transition hover:bg-x-hover" to="/">
          <span className="text-[24px] font-extrabold tracking-tight">VA</span>
        </Link>

        <nav className="mt-1 space-y-1">
          {items.filter((item) => item.visible).map((item) => (
            <NavButton active={item.active} badgeCount={item.badgeCount} icon={item.icon} key={item.key} label={item.label} onClick={item.onClick} />
          ))}
        </nav>

        <button
          className="mt-4 flex h-14 w-14 items-center justify-center rounded-full bg-x-blue text-white transition hover:bg-[#1a8cd8] tablet:w-full desktop:hidden"
          onClick={onCompose}
          type="button"
        >
          <Feather className="h-6 w-6" />
        </button>

        <button
          className="mt-4 hidden w-full items-center justify-center rounded-full bg-x-blue px-8 py-3.5 text-[17px] font-bold text-white transition hover:bg-[#1a8cd8] desktop:flex"
          onClick={onCompose}
          type="button"
        >
          Post
        </button>
      </div>

      <div className="pb-2">
        {user ? (
          <div className="rounded-[20px] border border-transparent p-2 transition hover:bg-x-hover">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#1d9bf0]/15 text-[15px] font-bold text-x-blue">
                {user.username.slice(0, 2).toUpperCase()}
              </div>
              <div className="hidden min-w-0 flex-1 desktop:block">
                <p className="truncate text-[15px] font-bold text-x-primary">{user.username}</p>
                <p className="truncate text-[15px] text-x-secondary">@{user.username.toLowerCase()}</p>
              </div>
              <button
                className="x-icon-button hidden h-10 w-10 desktop:inline-flex"
                onClick={onLogout}
                title="Sign out"
                type="button"
              >
                <LogOut className="h-[18px] w-[18px]" />
              </button>
            </div>
          </div>
        ) : (
          <div className="rounded-[20px] border border-x-border bg-[#111214] p-4 desktop:p-5">
            <p className="text-[17px] font-extrabold text-x-primary">Join Voice Atlas</p>
            <p className="mt-1 text-[15px] leading-5 text-x-secondary">Sign in to post voice notes and unlock your profile.</p>
            <div className="mt-4 space-y-2">
              <Link
                className="flex items-center justify-center gap-2 rounded-full bg-x-blue px-4 py-2.5 text-[15px] font-bold text-white transition hover:bg-[#1a8cd8]"
                to="/register"
              >
                <UserPlus className="h-4 w-4" />
                Register
              </Link>
              <Link
                className="flex items-center justify-center gap-2 rounded-full border border-x-border px-4 py-2.5 text-[15px] font-bold text-x-primary transition hover:bg-x-hover"
                to="/login"
              >
                <LogIn className="h-4 w-4" />
                Login
              </Link>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
