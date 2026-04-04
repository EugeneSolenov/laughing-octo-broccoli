from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.models import NotificationType, ReportStatus, TweetStatus, UserRole


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    email: EmailStr
    bio: str | None = None
    avatar_url: str | None = None
    email_verified: bool
    notifications_enabled: bool
    email_notifications_enabled: bool
    discoverable: bool
    role: UserRole
    is_banned: bool
    created_at: datetime


class UserPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    bio: str | None = None
    avatar_url: str | None = None
    role: UserRole
    is_following: bool = False


class UserProfileRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    bio: str | None = None
    avatar_url: str | None = None
    role: UserRole
    is_following: bool = False
    is_muted: bool = False
    is_self: bool = False
    created_at: datetime


class RegisterRequest(BaseModel):
    username: str = Field(min_length=3, max_length=30, pattern=r"^[A-Za-z0-9_]+$")
    email: EmailStr
    password: str = Field(min_length=8, max_length=72)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=72)


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=8, max_length=72)
    new_password: str = Field(min_length=8, max_length=72)


class PasswordResetRequest(BaseModel):
    email: EmailStr


class PasswordResetConfirmRequest(BaseModel):
    token: str = Field(min_length=16)
    password: str = Field(min_length=8, max_length=72)


class TokenActionRequest(BaseModel):
    token: str = Field(min_length=16)


class AuthResponse(BaseModel):
    user: UserRead
    detail: str


class GenericDetailResponse(BaseModel):
    detail: str
    debug_token: str | None = None


class CsrfTokenResponse(BaseModel):
    csrf_token: str
    detail: str


class VoiceTweetRead(BaseModel):
    id: int
    audio_url: str
    caption: str | None
    transcription_text: str | None
    status: TweetStatus
    mime_type: str
    error_message: str | None
    likes_count: int = 0
    reposts_count: int = 0
    reply_count: int = 0
    liked_by_viewer: bool = False
    reposted_by_viewer: bool = False
    created_at: datetime
    parent_tweet_id: int | None = None
    user: UserPublic


class FeedCursor(BaseModel):
    created_at: datetime
    id: int


class FeedResponse(BaseModel):
    items: list[VoiceTweetRead]
    next_cursor: FeedCursor | None = None


class PostDetailResponse(BaseModel):
    tweet: VoiceTweetRead
    parent: VoiceTweetRead | None = None
    replies: list[VoiceTweetRead]


class TweetUpdateRequest(BaseModel):
    caption: str | None = Field(default=None, max_length=280)
    transcription_text: str | None = Field(default=None, max_length=5000)


class ProfileResponse(BaseModel):
    user: UserRead
    tweets: list[VoiceTweetRead]
    follower_count: int
    following_count: int
    blocked_count: int = 0
    muted_count: int = 0


class PublicProfileResponse(BaseModel):
    user: UserProfileRead
    tweets: list[VoiceTweetRead]
    follower_count: int
    following_count: int


class ProfileUpdateRequest(BaseModel):
    bio: str | None = Field(default=None, max_length=160)
    avatar_url: str | None = Field(default=None, max_length=512)


class SettingsPreferencesRead(BaseModel):
    notifications_enabled: bool
    email_notifications_enabled: bool
    discoverable: bool


class SettingsPreferencesUpdateRequest(BaseModel):
    notifications_enabled: bool | None = None
    email_notifications_enabled: bool | None = None
    discoverable: bool | None = None


class BanUserRequest(BaseModel):
    is_banned: bool = True


class FollowResponse(BaseModel):
    user_id: int
    is_following: bool
    follower_count: int


class UserRelationResponse(BaseModel):
    user_id: int
    active: bool
    detail: str


class ReportCreateRequest(BaseModel):
    tweet_id: int | None = Field(default=None, ge=1)
    target_user_id: int | None = Field(default=None, ge=1)
    reason: str = Field(min_length=3, max_length=100)
    details: str | None = Field(default=None, max_length=2000)


class ReportUpdateRequest(BaseModel):
    status: ReportStatus


class ReportRead(BaseModel):
    id: int
    reason: str
    details: str | None = None
    status: ReportStatus
    created_at: datetime
    reporter: UserPublic
    target_user: UserPublic | None = None
    tweet: VoiceTweetRead | None = None


class NotificationRead(BaseModel):
    id: int
    type: NotificationType
    is_read: bool
    created_at: datetime
    message: str
    actor: UserPublic | None = None
    tweet_id: int | None = None
    tweet_preview: str | None = None
    path: str | None = None


class NotificationListResponse(BaseModel):
    items: list[NotificationRead]
    unread_count: int


class NotificationReadResponse(BaseModel):
    unread_count: int
    detail: str


class AuthSessionRead(BaseModel):
    id: str
    user_agent: str | None = None
    ip_address: str | None = None
    created_at: datetime
    last_seen_at: datetime
    revoked_at: datetime | None = None
    current: bool = False


class SessionListResponse(BaseModel):
    items: list[AuthSessionRead]


class UserSearchResponse(BaseModel):
    items: list[UserPublic]


class AdminStats(BaseModel):
    total_users: int
    total_tweets: int
    processing_tweets: int
    banned_users: int
    open_reports: int


class SystemLoad(BaseModel):
    cpu_percent: float
    memory_percent: float
    memory_used_mb: float
    queue_depth: int
    whisper_model_size: str
    whisper_device: str


class AdminDashboardResponse(BaseModel):
    stats: AdminStats
    system_load: SystemLoad
    users: list[UserRead]
    tweets: list[VoiceTweetRead]
    reports: list[ReportRead]
