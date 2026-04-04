from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import update, select
from sqlalchemy.orm import Session, selectinload

from app.auth import AuthenticatedUser
from app.database import get_db
from app.models import Notification, VoiceTweet
from app.schemas import NotificationListResponse, NotificationReadResponse
from app.serializers import serialize_notification
from app.social import count_unread_notifications

router = APIRouter()


@router.get("/notifications", response_model=NotificationListResponse)
def get_notifications(
    current_user: AuthenticatedUser,
    limit: int = Query(default=25, ge=1, le=100),
    db: Session = Depends(get_db),
) -> NotificationListResponse:
    notifications = db.scalars(
        select(Notification)
        .options(selectinload(Notification.actor), selectinload(Notification.tweet).selectinload(VoiceTweet.user))
        .where(Notification.user_id == current_user.id)
        .order_by(Notification.created_at.desc(), Notification.id.desc())
        .limit(limit)
    ).all()
    unread_count = count_unread_notifications(db, current_user.id)
    return NotificationListResponse(
        items=[serialize_notification(notification) for notification in notifications],
        unread_count=unread_count,
    )


@router.post("/notifications/{notification_id}/read", response_model=NotificationReadResponse)
def mark_notification_read(
    notification_id: int,
    current_user: AuthenticatedUser,
    db: Session = Depends(get_db),
) -> NotificationReadResponse:
    notification = db.scalar(
        select(Notification).where(Notification.id == notification_id, Notification.user_id == current_user.id)
    )
    if notification is None:
        raise HTTPException(status_code=404, detail="Notification not found.")
    if not notification.is_read:
        notification.is_read = True
        db.add(notification)
        db.commit()
    unread_count = count_unread_notifications(db, current_user.id)
    return NotificationReadResponse(unread_count=unread_count, detail="Notification marked as read.")


@router.post("/notifications/read-all", response_model=NotificationReadResponse)
def mark_notifications_read(
    current_user: AuthenticatedUser,
    db: Session = Depends(get_db),
) -> NotificationReadResponse:
    db.execute(
        update(Notification)
        .where(Notification.user_id == current_user.id, Notification.is_read.is_(False))
        .values(is_read=True)
    )
    db.commit()
    return NotificationReadResponse(unread_count=0, detail="Notifications marked as read.")
