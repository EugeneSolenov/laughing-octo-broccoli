import { ArrowLeft, Feather, Search, Shield } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { ApiError, apiFetch, getMediaUrl } from "../api/client";
import { useAuth } from "../context/AuthContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import PostCard from "./PostCard.jsx";
import SafetyMenu from "./SafetyMenu.jsx";

export function usePublicProfileHighlights(profile) {
  return useMemo(() => {
    if (!profile?.tweets?.length) {
      return [];
    }

    return profile.tweets.slice(0, 3).map((tweet, index) => ({
      title: tweet.caption || tweet.transcription_text?.split("\n")[0] || `${tweet.user.username} posted audio`,
      meta: index === 0 ? "Creator clip" : "Recent post",
      count: `${tweet.reply_count || 0} replies`,
    }));
  }, [profile?.tweets]);
}

export default function PublicProfilePage({ onOpenComposer, onOpenSearch }) {
  const { user } = useAuth();
  const { profileId } = useParams();
  const navigate = useNavigate();
  const showToast = useToast();
  const [followBusy, setFollowBusy] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(null);

  const loadProfile = useCallback(async () => {
    try {
      setLoading(true);
      const data = await apiFetch(`/users/${profileId}`);
      setProfile(data);
      setError("");
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : "Unable to load this profile.");
    } finally {
      setLoading(false);
    }
  }, [profileId]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  useEffect(() => {
    if (profile?.user?.is_self) {
      navigate("/profile", { replace: true });
    }
  }, [navigate, profile?.user?.is_self]);

  const toggleFollow = async () => {
    if (!user || !profile) {
      showToast("Sign in to follow creators.", "info");
      return;
    }

    const nextFollowing = !profile.user.is_following;
    try {
      setFollowBusy(true);
      const result = await apiFetch(`/users/${profile.user.id}/follow`, {
        method: nextFollowing ? "POST" : "DELETE",
      });
      setProfile((current) =>
        current
          ? {
              ...current,
              user: {
                ...current.user,
                is_following: result.is_following,
              },
              follower_count: result.follower_count,
            }
          : current,
      );
    } catch (caughtError) {
      showToast(caughtError instanceof ApiError ? caughtError.message : "Unable to update follow state.", "info");
    } finally {
      setFollowBusy(false);
    }
  };

  const avatarUrl = profile?.user?.avatar_url ? getMediaUrl(profile.user.avatar_url) : "";

  return (
    <section>
      <header className="sticky top-0 z-20 border-b border-x-border bg-black/80 backdrop-blur-md">
        <div className="flex items-center justify-between px-4 py-3 phone:px-5">
          <div className="flex items-center gap-4">
            <button aria-label="Go back" className="x-icon-button h-9 w-9" onClick={() => navigate(-1)} type="button">
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div>
              <p className="text-[20px] font-extrabold text-x-primary">{profile?.user?.username || "Profile"}</p>
              <p className="text-[13px] text-x-secondary">{profile?.tweets?.length || 0} posts</p>
            </div>
          </div>
          <div className="flex items-center gap-2 tablet:hidden">
            <button aria-label="Open search" className="x-icon-button h-10 w-10" onClick={onOpenSearch} type="button">
              <Search className="h-5 w-5" />
            </button>
            {user ? (
              <button aria-label="Create a voice post" className="x-icon-button h-10 w-10" onClick={onOpenComposer} type="button">
                <Feather className="h-5 w-5" />
              </button>
            ) : null}
          </div>
        </div>
      </header>

      <div className="h-40 border-b border-x-border bg-[radial-gradient(circle_at_top,_rgba(41,142,255,0.4),_transparent_60%),linear-gradient(180deg,_#17181d_0%,_#090a0d_100%)]" />

      <div className="border-b border-x-border px-4 pb-5 phone:px-5">
        <div className="flex items-end justify-between gap-4">
          {avatarUrl ? (
            <img alt={profile?.user?.username || "Profile avatar"} className="-mt-16 h-28 w-28 rounded-full border-4 border-black object-cover" src={avatarUrl} />
          ) : (
            <div className="-mt-16 flex h-28 w-28 items-center justify-center rounded-full border-4 border-black bg-[#1d9bf0]/15 text-[34px] font-extrabold text-x-blue">
              {profile?.user?.username?.slice(0, 2).toUpperCase() || "VA"}
            </div>
          )}
          {profile?.user ? (
            <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
              {user ? (
                <button
                  className={[
                    "rounded-full px-4 py-2 text-[15px] font-bold transition disabled:cursor-not-allowed disabled:opacity-60",
                    profile.user.is_following ? "border border-white/10 text-x-primary hover:bg-x-hover" : "bg-white text-black hover:bg-white/90",
                  ].join(" ")}
                  disabled={followBusy}
                  onClick={() => void toggleFollow()}
                  type="button"
                >
                  {followBusy ? "..." : profile.user.is_following ? "Following" : "Follow"}
                </button>
              ) : null}
              <SafetyMenu onActionComplete={() => void loadProfile()} targetUserId={profile.user.id} targetUsername={profile.user.username} />
            </div>
          ) : null}
        </div>

        <div className="mt-4">
          <div className="flex items-center gap-2">
            <p className="text-[20px] font-extrabold text-x-primary">{profile?.user?.username}</p>
            {String(profile?.user?.role || "").toLowerCase() === "admin" ? <Shield className="h-[18px] w-[18px] text-x-blue" /> : null}
          </div>
          <p className="mt-1 text-[15px] text-x-secondary">@{(profile?.user?.username || "").toLowerCase()}</p>
          <p className="mt-4 max-w-xl text-[15px] leading-6 text-x-primary">{profile?.user?.bio || "Audio-first creator profile."}</p>
          <p className="mt-3 text-[14px] text-x-secondary">
            Joined {new Date(profile?.user?.created_at || Date.now()).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
          </p>
          <div className="mt-4 flex flex-wrap gap-5 text-[15px]">
            <p>
              <span className="font-bold text-x-primary">{profile?.following_count || 0}</span>{" "}
              <span className="text-x-secondary">Following</span>
            </p>
            <p>
              <span className="font-bold text-x-primary">{profile?.follower_count || 0}</span>{" "}
              <span className="text-x-secondary">Followers</span>
            </p>
          </div>
        </div>
      </div>

      {error ? <p className="mx-4 mt-4 rounded-2xl border border-x-red/35 bg-x-red/10 px-4 py-3 text-[14px] text-red-100 phone:mx-5">{error}</p> : null}

      {loading && !profile ? (
        <div className="px-4 py-8 phone:px-5">
          <div className="rounded-[24px] border border-x-border bg-[#111214] p-6 text-[15px] text-x-secondary">Loading profile...</div>
        </div>
      ) : profile?.tweets?.length ? (
        profile.tweets.map((tweet) => (
          <PostCard
            currentUser={user}
            key={tweet.id}
            onRefreshRequested={() => void loadProfile()}
            tweet={tweet}
          />
        ))
      ) : (
        <div className="px-4 py-10 phone:px-5">
          <div className="rounded-[24px] border border-x-border bg-[#111214] p-6">
            <p className="text-[24px] font-extrabold text-x-primary">No public posts yet</p>
            <p className="mt-2 text-[15px] leading-6 text-x-secondary">When this profile publishes a voice post, it will show up here.</p>
          </div>
        </div>
      )}
    </section>
  );
}
