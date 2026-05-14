from __future__ import annotations

import os

import psutil
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.auth import AdminUser
from app.config import settings
from app.database import get_db
from app.models import Report, ReportStatus, TweetStatus, User, VoiceTweet
from app.schemas import AdminDashboardResponse, AdminStats, ReportUpdateRequest, SystemLoad
from app.serializers import serialize_report, serialize_tweet, serialize_user
from app.social import build_tweet_render_context
from app.transcription import get_queue_depth

router = APIRouter()

DEFAULT_USERS_LIMIT = 50
DEFAULT_USERS_OFFSET = 0
DEFAULT_TWEETS_LIMIT = 100
DEFAULT_TWEETS_OFFSET = 0
DEFAULT_REPORTS_LIMIT = 50
DEFAULT_REPORTS_OFFSET = 0


def _build_admin_dashboard(
    *,
    db: Session,
    users_limit: int = DEFAULT_USERS_LIMIT,
    users_offset: int = DEFAULT_USERS_OFFSET,
    tweets_limit: int = DEFAULT_TWEETS_LIMIT,
    tweets_offset: int = DEFAULT_TWEETS_OFFSET,
    reports_limit: int = DEFAULT_REPORTS_LIMIT,
    reports_offset: int = DEFAULT_REPORTS_OFFSET,
    user_q: str | None = None,
) -> AdminDashboardResponse:
    total_users = db.scalar(select(func.count()).select_from(User)) or 0
    total_tweets = db.scalar(select(func.count()).select_from(VoiceTweet)) or 0
    processing_tweets = (
        db.scalar(select(func.count()).select_from(VoiceTweet).where(VoiceTweet.status == TweetStatus.processing)) or 0
    )
    banned_users = db.scalar(select(func.count()).select_from(User).where(User.is_banned.is_(True))) or 0
    open_reports = db.scalar(select(func.count()).select_from(Report).where(Report.status == ReportStatus.open)) or 0

    users_statement = select(User).order_by(User.created_at.desc()).offset(users_offset).limit(users_limit)
    if user_q and user_q.strip():
        normalized_query = user_q.strip()
        users_statement = users_statement.where(
            (User.username.ilike(f"%{normalized_query}%")) | (User.email.ilike(f"%{normalized_query}%"))
        )
    users = db.scalars(users_statement).all()

    tweets = db.scalars(
        select(VoiceTweet)
        .options(selectinload(VoiceTweet.user))
        .where(VoiceTweet.parent_tweet_id.is_(None))
        .order_by(VoiceTweet.created_at.desc())
        .offset(tweets_offset)
        .limit(tweets_limit)
    ).all()
    reports = db.scalars(
        select(Report)
        .options(
            selectinload(Report.reporter),
            selectinload(Report.target_user),
            selectinload(Report.tweet).selectinload(VoiceTweet.user),
        )
        .order_by(Report.created_at.desc())
        .offset(reports_offset)
        .limit(reports_limit)
    ).all()

    process = psutil.Process(os.getpid())
    system_load = SystemLoad(
        cpu_percent=round(psutil.cpu_percent(interval=0.1), 1),
        memory_percent=round(psutil.virtual_memory().percent, 1),
        memory_used_mb=round(process.memory_info().rss / (1024 * 1024), 1),
        queue_depth=get_queue_depth(),
        whisper_model_size=settings.whisper_model_size,
        whisper_device=settings.whisper_device,
    )
    tweet_context = build_tweet_render_context(
        db,
        tweet_ids=[tweet.id for tweet in tweets] + [report.tweet.id for report in reports if report.tweet],
        author_ids=[tweet.user_id for tweet in tweets] + [report.tweet.user_id for report in reports if report.tweet],
        viewer_id=None,
    )

    return AdminDashboardResponse(
        stats=AdminStats(
            total_users=total_users,
            total_tweets=total_tweets,
            processing_tweets=processing_tweets,
            banned_users=banned_users,
            open_reports=open_reports,
        ),
        system_load=system_load,
        users=[serialize_user(user) for user in users],
        tweets=[serialize_tweet(tweet, context=tweet_context) for tweet in tweets],
        reports=[serialize_report(report, tweet_context=tweet_context) for report in reports],
    )


@router.get("/admin/dashboard", response_model=AdminDashboardResponse)
def get_admin_dashboard(
    _: AdminUser,
    users_limit: int = Query(default=DEFAULT_USERS_LIMIT, ge=1, le=200),
    users_offset: int = Query(default=DEFAULT_USERS_OFFSET, ge=0),
    tweets_limit: int = Query(default=DEFAULT_TWEETS_LIMIT, ge=1, le=200),
    tweets_offset: int = Query(default=DEFAULT_TWEETS_OFFSET, ge=0),
    reports_limit: int = Query(default=DEFAULT_REPORTS_LIMIT, ge=1, le=200),
    reports_offset: int = Query(default=DEFAULT_REPORTS_OFFSET, ge=0),
    user_q: str | None = Query(default=None, min_length=1, max_length=120),
    db: Session = Depends(get_db),
) -> AdminDashboardResponse:
    return _build_admin_dashboard(
        db=db,
        users_limit=users_limit,
        users_offset=users_offset,
        tweets_limit=tweets_limit,
        tweets_offset=tweets_offset,
        reports_limit=reports_limit,
        reports_offset=reports_offset,
        user_q=user_q,
    )


@router.patch("/admin/reports/{report_id}", response_model=AdminDashboardResponse, include_in_schema=False)
def update_report_status(
    report_id: int,
    payload: ReportUpdateRequest,
    admin_user: AdminUser,
    db: Session = Depends(get_db),
) -> AdminDashboardResponse:
    report = db.get(Report, report_id)
    if report is None:
        raise HTTPException(status_code=404, detail="Report not found.")
    report.status = payload.status
    db.add(report)
    db.commit()
    return _build_admin_dashboard(db=db)
