import { CheckCircle2, Mic2, Search, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { ApiError, apiFetch } from "../api/client";

export default function OnboardingChecklist({ onOpenComposer, onOpenSearch, user }) {
  const [error, setError] = useState("");
  const [profile, setProfile] = useState(null);

  useEffect(() => {
    let cancelled = false;

    const loadProfile = async () => {
      try {
        const result = await apiFetch("/profile?limit=1");
        if (!cancelled) {
          setProfile(result);
          setError("");
        }
      } catch (caughtError) {
        if (!cancelled) {
          setError(caughtError instanceof ApiError ? caughtError.message : "Unable to load onboarding progress.");
        }
      }
    };

    if (user) {
      void loadProfile();
    }

    return () => {
      cancelled = true;
    };
  }, [user]);

  const tasks = [
    {
      id: "post",
      title: "Record your first post",
      done: Boolean(profile?.tweets?.length),
      icon: Mic2,
      actionLabel: "Record now",
      onAction: onOpenComposer,
    },
    {
      id: "follow",
      title: "Follow 3 voices",
      done: Number(profile?.following_count || 0) >= 3,
      icon: Search,
      actionLabel: "Find people",
      onAction: onOpenSearch,
    },
    {
      id: "profile",
      title: "Fill out your profile",
      done: Boolean(profile?.user?.bio?.trim()),
      icon: UserRound,
      actionLabel: "Edit profile",
      href: "/profile",
    },
  ];

  if (!user || !profile || tasks.every((task) => task.done)) {
    return null;
  }

  return (
    <section className="border-b border-x-border px-4 py-5 phone:px-5">
      <div className="overflow-hidden rounded-[28px] border border-white/10 bg-[radial-gradient(circle_at_top_left,_rgba(41,142,255,0.18),_transparent_30%),linear-gradient(180deg,_rgba(18,20,25,0.96),_rgba(10,11,14,0.98))] p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[12px] font-bold uppercase tracking-[0.28em] text-x-secondary">Onboarding</p>
            <h2 className="mt-3 text-[28px] font-extrabold leading-8 text-x-primary">Give your profile a real first run</h2>
            <p className="mt-2 max-w-xl text-[15px] leading-6 text-x-secondary">
              These three steps make the app feel complete fast: publish, discover people, and add context to your voice.
            </p>
          </div>
          <div className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-[14px] font-semibold text-x-primary">
            {tasks.filter((task) => task.done).length}/{tasks.length} done
          </div>
        </div>

        <div className="mt-5 grid gap-3">
          {tasks.map((task) => {
            const Icon = task.icon;
            return (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-[22px] border border-white/10 bg-black/25 px-4 py-4" key={task.id}>
                <div className="flex min-w-0 items-center gap-3">
                  <div className={["flex h-11 w-11 items-center justify-center rounded-full", task.done ? "bg-x-green/15 text-x-green" : "bg-[#1d9bf0]/15 text-x-blue"].join(" ")}>
                    {task.done ? <CheckCircle2 className="h-5 w-5" /> : <Icon className="h-5 w-5" />}
                  </div>
                  <div>
                    <p className="text-[15px] font-bold text-x-primary">{task.title}</p>
                    <p className="text-[13px] text-x-secondary">{task.done ? "Complete" : "Still waiting for you"}</p>
                  </div>
                </div>

                {task.done ? (
                  <span className="x-pill">Complete</span>
                ) : task.href ? (
                  <Link className="rounded-full border border-white/10 px-4 py-2 text-[14px] font-bold text-x-primary transition hover:bg-white/[0.04]" to={task.href}>
                    {task.actionLabel}
                  </Link>
                ) : (
                  <button
                    className="rounded-full border border-white/10 px-4 py-2 text-[14px] font-bold text-x-primary transition hover:bg-white/[0.04]"
                    onClick={task.onAction}
                    type="button"
                  >
                    {task.actionLabel}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {error ? <p className="mt-4 text-[13px] text-red-100">{error}</p> : null}
      </div>
    </section>
  );
}
