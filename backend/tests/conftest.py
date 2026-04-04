from __future__ import annotations

from collections.abc import Iterator
import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

os.environ["DEBUG"] = "false"
os.environ["COOKIE_SECURE"] = "false"
os.environ["DATABASE_URL"] = "sqlite:///./pytest-bootstrap.sqlite3"
os.environ["UPLOADS_DIR"] = str((Path.cwd() / ".pytest-uploads").resolve())
os.environ["WHISPER_MODEL_DIR"] = str((Path.cwd() / ".pytest-whisper").resolve())

from app import database as database_module
from app import main as main_module
from app.database import Base


@pytest.fixture()
def db_engine(tmp_path: Path) -> Iterator:
    db_path = tmp_path / "test.sqlite3"
    engine = create_engine(
        f"sqlite:///{db_path}",
        connect_args={"check_same_thread": False},
        future=True,
    )
    testing_session_local = sessionmaker(
        bind=engine,
        autoflush=False,
        autocommit=False,
        expire_on_commit=False,
    )

    original_engine = database_module.engine
    original_session_local = database_module.SessionLocal
    original_main_engine = main_module.engine
    original_init_db = main_module.init_db

    database_module.engine = engine
    database_module.SessionLocal = testing_session_local
    main_module.engine = engine
    main_module.init_db = lambda: None

    Base.metadata.create_all(bind=engine)

    try:
        yield engine
    finally:
        Base.metadata.drop_all(bind=engine)
        database_module.engine = original_engine
        database_module.SessionLocal = original_session_local
        main_module.engine = original_main_engine
        main_module.init_db = original_init_db
        engine.dispose()


@pytest.fixture()
def db_session(db_engine) -> Iterator[Session]:
    session = database_module.SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture()
def client(db_engine) -> Iterator[TestClient]:
    with TestClient(main_module.app) as test_client:
        yield test_client


@pytest.fixture()
def csrf_token(client: TestClient) -> str:
    response = client.get("/api/auth/csrf")
    assert response.status_code == 200
    return response.json()["csrf_token"]
