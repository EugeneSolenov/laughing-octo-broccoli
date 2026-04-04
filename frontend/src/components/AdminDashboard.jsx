import { Activity, Ban, CheckCheck, Cpu, Flag, HardDrive, RefreshCw, Search, Shield, Trash2, Users } from "lucide-react";
import { useEffect, useState } from "react";

import { ApiError, apiFetch } from "../api/client";

function MetricCard({ icon: Icon, label, value }) {
  return (
    <div className="rounded-2xl border border-x-border bg-[#111214] p-4">
      <div className="flex items-center gap-2 text-x-secondary">
        <Icon className="h-[18px] w-[18px] text-x-blue" />
        <span className="text-[13px] font-semibold">{label}</span>
      </div>
      <p className="mt-3 text-[32px] font-extrabold tracking-tight text-x-primary">{value}</p>
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
      setError(caughtError instanceof ApiError ? caughtError.message : "Unable to load the admin dashboard.");
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
      setError(caughtError instanceof ApiError ? caughtError.message : "Unable to update report status.");
    } finally {
      setReportBusyId(null);
    }
  };

  useEffect(() => {
    void loadDashboard();
  }, [userQuery]);

  if (loading && !dashboard) {
    return (
      <section>
        <header className="sticky top-0 z-10 border-b border-x-border bg-black/80 px-4 py-3 backdrop-blur-md phone:px-5">
          <p className="text-[20px] font-extrabold text-x-primary">Admin dashboard</p>
        </header>
        <div className="px-4 py-6 phone:px-5">
          <div className="rounded-2xl border border-x-border bg-[#111214] p-6">
            <p className="text-[15px] text-x-secondary">Loading dashboard...</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section>
      <header className="sticky top-0 z-10 border-b border-x-border bg-black/80 px-4 py-3 backdrop-blur-md phone:px-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[20px] font-extrabold text-x-primary">Admin dashboard</p>
            <p className="text-[13px] text-x-secondary">Manage people, posts, and the moderation queue.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-x-secondary" />
              <input
                className="x-input w-[220px] rounded-full py-2 pl-10"
                onChange={(event) => setUserQuery(event.target.value)}
                placeholder="Search users"
                type="search"
                value={userQuery}
              />
            </label>
            <button
              className="inline-flex items-center gap-2 rounded-full border border-x-border px-4 py-2 text-[15px] font-bold text-x-primary transition hover:bg-x-hover"
              onClick={() => void loadDashboard()}
              type="button"
            >
              <RefreshCw className={["h-[18px] w-[18px]", loading ? "animate-spin" : ""].join(" ")} />
              Refresh
            </button>
          </div>
        </div>
      </header>

      <div className="space-y-6 px-4 py-5 phone:px-5">
        {error ? <p className="rounded-2xl border border-x-red/35 bg-x-red/10 px-4 py-3 text-[14px] text-red-100">{error}</p> : null}

        {dashboard ? (
          <>
            <div className="grid gap-3 tablet:grid-cols-2">
              <MetricCard icon={Users} label="Users" value={dashboard.stats.total_users} />
              <MetricCard icon={Shield} label="Banned" value={dashboard.stats.banned_users} />
              <MetricCard icon={Activity} label="Processing" value={dashboard.stats.processing_tweets} />
              <MetricCard icon={Trash2} label="Posts" value={dashboard.stats.total_tweets} />
            </div>

            <section className="rounded-2xl border border-x-border bg-[#111214] p-4 phone:p-5">
              <div className="flex items-center gap-2">
                <Cpu className="h-[18px] w-[18px] text-x-blue" />
                <h2 className="text-[20px] font-extrabold text-x-primary">System load</h2>
              </div>
              <div className="mt-4 grid gap-3 tablet:grid-cols-2">
                <MetricCard icon={Cpu} label="CPU %" value={dashboard.system_load.cpu_percent} />
                <MetricCard icon={HardDrive} label="Memory %" value={dashboard.system_load.memory_percent} />
                <MetricCard icon={Activity} label="Queue depth" value={dashboard.system_load.queue_depth} />
                <MetricCard icon={Shield} label="RAM MB" value={dashboard.system_load.memory_used_mb} />
              </div>
            </section>

            <section className="overflow-hidden rounded-2xl border border-x-border bg-[#111214]">
              <div className="border-b border-x-border px-4 py-4 phone:px-5">
                <h2 className="text-[20px] font-extrabold text-x-primary">Users</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-left">
                  <thead className="text-[13px] text-x-secondary">
                    <tr>
                      <th className="px-4 py-3 font-semibold phone:px-5">User</th>
                      <th className="px-4 py-3 font-semibold">Role</th>
                      <th className="px-4 py-3 font-semibold">Status</th>
                      <th className="px-4 py-3 font-semibold">Created</th>
                      <th className="px-4 py-3 text-right font-semibold phone:px-5">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-x-border text-[15px]">
                    {dashboard.users.map((user) => (
                      <tr key={user.id} className="hover:bg-white/[0.02]">
                        <td className="px-4 py-4 phone:px-5">
                          <p className="font-bold text-x-primary">{user.username}</p>
                          <p className="text-[13px] text-x-secondary">{user.email}</p>
                        </td>
                        <td className="px-4 py-4 capitalize text-x-primary">{user.role}</td>
                        <td className="px-4 py-4 text-x-primary">{user.is_banned ? "Banned" : "Active"}</td>
                        <td className="px-4 py-4 text-x-secondary">{new Date(user.created_at).toLocaleDateString()}</td>
                        <td className="px-4 py-4 text-right phone:px-5">
                          <button
                            className="inline-flex items-center gap-2 rounded-full border border-x-border px-4 py-2 text-[14px] font-bold text-x-primary transition hover:bg-x-hover"
                            onClick={() => void toggleBan(user.id, user.is_banned)}
                            type="button"
                          >
                            <Ban className="h-4 w-4" />
                            {user.is_banned ? "Unban" : "Ban"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="overflow-hidden rounded-2xl border border-x-border bg-[#111214]">
              <div className="border-b border-x-border px-4 py-4 phone:px-5">
                <h2 className="text-[20px] font-extrabold text-x-primary">Posts</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-left">
                  <thead className="text-[13px] text-x-secondary">
                    <tr>
                      <th className="px-4 py-3 font-semibold phone:px-5">Author</th>
                      <th className="px-4 py-3 font-semibold">Status</th>
                      <th className="px-4 py-3 font-semibold">Transcript</th>
                      <th className="px-4 py-3 font-semibold">Created</th>
                      <th className="px-4 py-3 text-right font-semibold phone:px-5">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-x-border text-[15px]">
                    {dashboard.tweets.map((tweet) => (
                      <tr key={tweet.id} className="hover:bg-white/[0.02]">
                        <td className="px-4 py-4 font-bold text-x-primary phone:px-5">{tweet.user.username}</td>
                        <td className="px-4 py-4 capitalize text-x-primary">{tweet.status}</td>
                        <td className="max-w-sm px-4 py-4 text-x-secondary">
                          {tweet.transcription_text || tweet.error_message || "AI is thinking..."}
                        </td>
                        <td className="px-4 py-4 text-x-secondary">{new Date(tweet.created_at).toLocaleString()}</td>
                        <td className="px-4 py-4 text-right phone:px-5">
                          <button
                            className="inline-flex items-center gap-2 rounded-full border border-x-border px-4 py-2 text-[14px] font-bold text-x-primary transition hover:bg-x-hover"
                            onClick={() => void deleteTweet(tweet.id)}
                            type="button"
                          >
                            <Trash2 className="h-4 w-4" />
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="overflow-hidden rounded-2xl border border-x-border bg-[#111214]">
              <div className="border-b border-x-border px-4 py-4 phone:px-5">
                <div className="flex items-center gap-2">
                  <Flag className="h-[18px] w-[18px] text-x-blue" />
                  <h2 className="text-[20px] font-extrabold text-x-primary">Moderation queue</h2>
                </div>
              </div>
              <div className="divide-y divide-x-border">
                {dashboard.reports.length ? (
                  dashboard.reports.map((report) => (
                    <div className="px-4 py-4 phone:px-5" key={report.id}>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-[15px] font-bold text-x-primary">{report.reason}</p>
                            <span className="x-pill capitalize">{report.status}</span>
                          </div>
                          <p className="mt-1 text-[13px] text-x-secondary">
                            Reported by @{report.reporter.username.toLowerCase()}
                            {report.target_user ? ` • Target @${report.target_user.username.toLowerCase()}` : ""}
                          </p>
                          {report.details ? <p className="mt-3 text-[14px] leading-6 text-x-primary">{report.details}</p> : null}
                          {report.tweet ? (
                            <div className="mt-3 rounded-[18px] border border-white/10 bg-black/30 px-4 py-3">
                              <p className="text-[13px] text-x-secondary">Tweet preview</p>
                              <p className="mt-1 text-[14px] leading-6 text-x-primary">
                                {report.tweet.caption || report.tweet.transcription_text || report.tweet.error_message || "Audio-only post"}
                              </p>
                            </div>
                          ) : null}
                        </div>
                        {report.status !== "resolved" ? (
                          <button
                            className="inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-[14px] font-bold text-x-primary transition hover:bg-white/[0.04] disabled:cursor-not-allowed disabled:opacity-60"
                            disabled={reportBusyId === report.id}
                            onClick={() => void resolveReport(report.id)}
                            type="button"
                          >
                            <CheckCheck className="h-4 w-4" />
                            {reportBusyId === report.id ? "Resolving..." : "Resolve"}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="px-4 py-5 text-[14px] text-x-secondary phone:px-5">No reports in the queue right now.</div>
                )}
              </div>
            </section>
          </>
        ) : null}
      </div>
    </section>
  );
}
