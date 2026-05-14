import { Activity, Ban, CheckCheck, Cpu, Flag, HardDrive, RefreshCw, Search, Shield, Trash2, Users } from "lucide-react";
import { useEffect, useState } from "react";

import { ApiError, apiFetch } from "../api/client";

const DATE_FORMAT = new Intl.DateTimeFormat("ru-RU", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

const DATE_TIME_FORMAT = new Intl.DateTimeFormat("ru-RU", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function MetricCard({ icon: Icon, label, value }) {
  return (
    <div className="m3-card m3-stat-card">
      <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--md-sys-color-on-surface-variant)" }}>
        <Icon size={16} style={{ color: "var(--md-sys-color-primary)" }} />
        <span style={{ fontSize: 13, fontWeight: 500 }}>{label}</span>
      </div>
      <strong>{value}</strong>
    </div>
  );
}

export default function AdminDashboard() {
  const [dashboard, setDashboard] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [reportBusyId, setReportBusyId] = useState(null);
  const [userQuery, setUserQuery] = useState("");

  const loadDashboard = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (userQuery.trim()) {
        params.set("user_q", userQuery.trim());
      }
      const queryString = params.toString();
      const data = await apiFetch(queryString ? `/admin/dashboard?${queryString}` : "/admin/dashboard");
      setDashboard(data);
      setError("");
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : "Не удалось загрузить панель администратора.");
    } finally {
      setLoading(false);
    }
  };

  const toggleBan = async (userId, isBanned) => {
    await apiFetch(`/users/${userId}/ban`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_banned: !isBanned }),
    });

    await loadDashboard();
  };

  const deleteTweet = async (tweetId) => {
    await apiFetch(`/tweets/${tweetId}`, { method: "DELETE" });
    await loadDashboard();
  };

  const resolveReport = async (reportId) => {
    try {
      setReportBusyId(reportId);
      const updatedDashboard = await apiFetch(`/admin/reports/${reportId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "resolved" }),
      });
      setDashboard(updatedDashboard);
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : "Не удалось обновить статус жалобы.");
    } finally {
      setReportBusyId(null);
    }
  };

  useEffect(() => {
    void loadDashboard();
  }, [userQuery]);

  return (
    <section>
      <header className="top-app-bar">
        <div className="top-app-bar__inner">
          <div>
            <p className="m3-section-label">Модерация</p>
            <h1 className="top-app-bar__title" style={{ fontSize: 22 }}>
              Панель администратора
            </h1>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <label htmlFor="admin-user-query" style={{ position: "relative", display: "block" }}>
              <Search
                size={16}
                style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", color: "var(--md-sys-color-on-surface-variant)" }}
              />
              <input
                className="m3-searchbar"
                id="admin-user-query"
                onChange={(event) => setUserQuery(event.target.value)}
                placeholder={"Поиск пользователей\u2026"}
                style={{ width: 220 }}
                type="search"
                value={userQuery}
              />
            </label>
            <button className="m3-button m3-button-outlined m3-interactive" onClick={() => void loadDashboard()} type="button">
              <RefreshCw size={16} style={loading ? { animation: "spin 1s linear infinite" } : undefined} />
              Обновить
            </button>
          </div>
        </div>
      </header>

      <div className="main-page-stack">
        {error ? <p className="m3-error">{error}</p> : null}

        {loading && !dashboard ? (
          <div className="m3-card" style={{ padding: 18 }}>
            <div className="m3-skeleton" style={{ height: 140 }} />
          </div>
        ) : null}

        {dashboard ? (
          <>
            <section className="m3-stat-grid">
              <MetricCard icon={Users} label="Пользователи" value={dashboard.stats.total_users} />
              <MetricCard icon={Shield} label="Заблокированы" value={dashboard.stats.banned_users} />
              <MetricCard icon={Activity} label="В обработке" value={dashboard.stats.processing_tweets} />
              <MetricCard icon={Trash2} label="Посты" value={dashboard.stats.total_tweets} />
            </section>

            <section className="m3-panel" style={{ padding: 20 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                <Cpu size={18} style={{ color: "var(--md-sys-color-primary)" }} />
                <div>
                  <h2 className="m3-title-medium" style={{ fontSize: 20 }}>
                    Нагрузка системы
                  </h2>
                  <p className="m3-body-small" style={{ marginTop: 4 }}>
                    Текущая нагрузка на воркер и память.
                  </p>
                </div>
              </div>

              <div className="m3-stat-grid">
                <MetricCard icon={Cpu} label="CPU %" value={dashboard.system_load.cpu_percent} />
                <MetricCard icon={HardDrive} label="Память %" value={dashboard.system_load.memory_percent} />
                <MetricCard icon={Activity} label="Очередь" value={dashboard.system_load.queue_depth} />
                <MetricCard icon={Shield} label="RAM МБ" value={dashboard.system_load.memory_used_mb} />
              </div>
            </section>

            <section className="m3-panel m3-table-card">
              <div style={{ padding: 18 }}>
                <h2 className="m3-title-medium" style={{ fontSize: 20 }}>
                  Пользователи
                </h2>
              </div>
              <table className="m3-table">
                <thead>
                  <tr>
                    <th>Пользователь</th>
                    <th>Роль</th>
                    <th>Статус</th>
                    <th>Создан</th>
                    <th>Действие</th>
                  </tr>
                </thead>
                <tbody>
                  {dashboard.users.map((user) => (
                    <tr key={user.id}>
                      <td>
                        <p className="m3-title-medium">{user.username}</p>
                        <p className="m3-body-small" style={{ marginTop: 4 }}>
                          {user.email}
                        </p>
                      </td>
                      <td style={{ textTransform: "capitalize" }}>{user.role}</td>
                      <td>{user.is_banned ? "Заблокирован" : "Активен"}</td>
                      <td className="m3-body-small">{DATE_FORMAT.format(new Date(user.created_at))}</td>
                      <td>
                        <button className="m3-button m3-button-outlined m3-interactive" onClick={() => void toggleBan(user.id, user.is_banned)} type="button">
                          <Ban size={14} />
                          {user.is_banned ? "Разблокировать" : "Заблокировать"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section className="m3-panel m3-table-card">
              <div style={{ padding: 18 }}>
                <h2 className="m3-title-medium" style={{ fontSize: 20 }}>
                  Посты
                </h2>
              </div>
              <table className="m3-table">
                <thead>
                  <tr>
                    <th>Автор</th>
                    <th>Статус</th>
                    <th>Транскрипция</th>
                    <th>Создан</th>
                    <th>Действие</th>
                  </tr>
                </thead>
                <tbody>
                  {dashboard.tweets.map((tweet) => (
                    <tr key={tweet.id}>
                      <td>{tweet.user.username}</td>
                      <td style={{ textTransform: "capitalize" }}>{tweet.status}</td>
                      <td className="m3-body-small">{tweet.transcription_text || tweet.error_message || "ИИ обрабатывает\u2026"}</td>
                      <td className="m3-body-small">{DATE_TIME_FORMAT.format(new Date(tweet.created_at))}</td>
                      <td>
                        <button className="m3-button m3-button-outlined m3-interactive m3-state-tertiary" onClick={() => void deleteTweet(tweet.id)} type="button">
                          <Trash2 size={14} />
                          Удалить
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section className="m3-panel" style={{ padding: 20 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                <Flag size={18} style={{ color: "var(--md-sys-color-primary)" }} />
                <div>
                  <h2 className="m3-title-medium" style={{ fontSize: 20 }}>
                    Очередь модерации
                  </h2>
                  <p className="m3-body-small" style={{ marginTop: 4 }}>
                    Просматривайте жалобы и закрывайте их прямо из очереди.
                  </p>
                </div>
              </div>

              {dashboard.reports.length ? (
                <div style={{ display: "grid", gap: 12 }}>
                  {dashboard.reports.map((report) => (
                    <div className="m3-card" key={report.id} style={{ padding: 16 }}>
                      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                            <p className="m3-title-medium">{report.reason}</p>
                            <span className="m3-chip m3-chip-filled" style={{ textTransform: "capitalize" }}>
                              {report.status}
                            </span>
                          </div>
                          <p className="m3-body-small" style={{ marginTop: 4 }}>
                            Отправил @{report.reporter.username.toLowerCase()}
                            {report.target_user ? ` \u00b7 Цель @${report.target_user.username.toLowerCase()}` : ""}
                          </p>
                          {report.details ? (
                            <p style={{ margin: "12px 0 0", fontSize: 14, lineHeight: 1.6 }}>{report.details}</p>
                          ) : null}
                          {report.tweet ? (
                            <div className="m3-card-tonal" style={{ marginTop: 12, padding: 14 }}>
                              <p className="m3-section-label">Предпросмотр записи</p>
                              <p style={{ margin: "8px 0 0", fontSize: 14, lineHeight: 1.6 }}>
                                {report.tweet.caption || report.tweet.transcription_text || report.tweet.error_message || "Только аудио"}
                              </p>
                            </div>
                          ) : null}
                        </div>

                        {report.status !== "resolved" ? (
                          <button className="m3-button m3-button-outlined m3-interactive" disabled={reportBusyId === report.id} onClick={() => void resolveReport(report.id)} type="button">
                            <CheckCheck size={14} />
                            {reportBusyId === report.id ? "Закрытие\u2026" : "Закрыть"}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="m3-card" style={{ padding: 16 }}>
                  <p className="m3-body-small">Сейчас в очереди нет жалоб.</p>
                </div>
              )}
            </section>
          </>
        ) : null}
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </section>
  );
}
