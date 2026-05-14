import { CheckCircle2, Mic2, Search, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { ApiError, apiFetch } from "../api/client";

export default function OnboardingChecklist({ onOpenComposer, onOpenSearch, user }) {
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) {
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const result = await apiFetch("/profile?limit=1");
        if (!cancelled) {
          setProfile(result);
          setError("");
        }
      } catch (caughtError) {
        if (!cancelled) {
          setError(caughtError instanceof ApiError ? caughtError.message : "Не удалось загрузить шаги onboarding.");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user]);

  const tasks = [
    {
      id: "post",
      title: "Запишите первый пост",
      detail: "Откройте запись и опубликуйте голосовую заметку.",
      done: Boolean(profile?.tweets?.length),
      icon: Mic2,
      actionLabel: "Записать",
      onAction: onOpenComposer,
    },
    {
      id: "follow",
      title: "Подпишитесь на трёх авторов",
      detail: "Используйте поиск, чтобы собрать свою ленту.",
      done: Number(profile?.following_count || 0) >= 3,
      icon: Search,
      actionLabel: "Найти людей",
      onAction: onOpenSearch,
    },
    {
      id: "profile",
      title: "Добавьте описание",
      detail: "Заполните публичный профиль в настройках аккаунта.",
      done: Boolean(profile?.user?.bio?.trim()),
      icon: UserRound,
      actionLabel: "Открыть настройки",
      href: "/settings",
    },
  ];

  if (!user || !profile || tasks.every((task) => task.done)) {
    return null;
  }

  const completedCount = tasks.filter((task) => task.done).length;

  return (
    <section className="m3-panel onboarding-card">
      <div className="onboarding-card__header">
        <div className="onboarding-card__header-copy">
          <p className="m3-section-label onboarding-card__eyebrow">Следующие шаги</p>
          <h2 className="m3-title-medium onboarding-card__title">
            Настройте свой голос
          </h2>
        </div>
        <span className="m3-chip m3-chip-filled onboarding-card__progress">
          {completedCount}/{tasks.length}
        </span>
      </div>

      <hr className="m3-divider" />

      <div className="onboarding-card__list">
        {tasks.map((task, index) => {
          const Icon = task.icon;
          return (
            <article
              className={[
                "onboarding-card__item",
                task.done ? "is-complete" : "",
                index < tasks.length - 1 ? "has-divider" : "",
              ].join(" ").trim()}
              key={task.id}
            >
              <div className="onboarding-card__item-main">
                <div className="onboarding-card__icon-wrap">
                  {task.done ? <CheckCircle2 size={18} /> : <Icon size={17} />}
                </div>

                <div className="onboarding-card__copy">
                  <div className="onboarding-card__item-header">
                    <p className="onboarding-card__item-title">{task.title}</p>
                    {task.done ? <span className="onboarding-card__status">Выполнено</span> : null}
                  </div>
                  <p className="onboarding-card__item-detail">{task.done ? "Готово." : task.detail}</p>
                </div>
              </div>

              {task.done ? null : task.href ? (
                <Link className="m3-button m3-button-outlined m3-interactive onboarding-card__action" to={task.href}>
                  {task.actionLabel}
                </Link>
              ) : (
                <button className="m3-button m3-button-outlined m3-interactive onboarding-card__action" onClick={task.onAction} type="button">
                  {task.actionLabel}
                </button>
              )}
            </article>
          );
        })}
      </div>

      {error ? (
        <div className="onboarding-card__error">
          <p className="m3-error">{error}</p>
        </div>
      ) : null}
    </section>
  );
}
