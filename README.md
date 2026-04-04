# Voice Twitter

Full-stack "Voice Twitter" clone with FastAPI, PostgreSQL, Celery, Redis, React, Tailwind CSS, Framer Motion, JWT auth via HttpOnly cookies, CSRF protection, realtime SSE updates, and Faster-Whisper transcription.

## Stack

- Backend: FastAPI, SQLAlchemy, PostgreSQL
- Queue: Celery + Redis + Flower
- Local AI: `faster-whisper`
- Frontend: React, Tailwind CSS, Framer Motion, WaveSurfer.js
- Auth: JWT access + refresh tokens in HttpOnly cookies + double-submit CSRF
- Realtime: Redis Pub/Sub + Server-Sent Events

## Project Structure

```text
Voice/
|-- backend/
|   |-- .env.example
|   |-- requirements.txt
|   `-- app/
|       |-- auth.py
|       |-- celery_app.py
|       |-- config.py
|       |-- database.py
|       |-- main.py
|       |-- models.py
|       |-- schemas.py
|       |-- transcription.py
|       `-- routers/
|           |-- admin.py
|           |-- auth.py
|           |-- tweets.py
|           `-- users.py
|-- frontend/
|   |-- .env.example
|   |-- package.json
|   `-- src/
|       |-- App.js
|       |-- api/client.js
|       |-- components/
|       `-- context/
|-- uploads/
|-- Dockerfile
`-- docker-compose.yml
```

## Highlights

- Production startup rejects the default JWT secret and rejects local file storage in `production`.
- CSRF protection is enabled for cookie-authenticated write requests with `X-CSRF-Token`.
- Rate limits are enabled in FastAPI and reinforced in Nginx for auth and upload routes.
- Database schema is managed through Alembic migrations instead of `create_all()`.
- Audio uploads are validated by size and by `ffprobe` duration before transcription.
- The worker retries failed transcription jobs and publishes realtime status updates.
- Feed and profile screens now refresh through SSE instead of 5-second polling loops.
- Likes, reposts, follow/unfollow, notifications, editable profile bio/avatar, and PWA assets are implemented.
- A default admin account is bootstrapped automatically:
  - Email: `admin@voice-tweet.com`
  - Username: `admin`
  - Password comes from `ADMIN_PASSWORD`

## Backend Environment

Copy [backend/.env.example](C:/Users/Admin/Desktop/Voice/backend/.env.example) to `backend/.env`.

Key variables:

```dotenv
APP_NAME=Voice Twitter
ENVIRONMENT=development
DEBUG=true

DATABASE_URL=postgresql+psycopg://voice:voice@localhost:5432/voice_twitter
REDIS_URL=redis://localhost:6379/0

FRONTEND_ORIGIN=http://localhost:5173
BACKEND_ORIGIN=http://localhost:8000

SECRET_KEY=replace-with-a-long-random-secret-key-at-least-32-characters
COOKIE_SECURE=false

UPLOADS_DIR=../uploads
MAX_UPLOAD_BYTES=10485760

WHISPER_MODEL_SIZE=base
WHISPER_DEVICE=cpu
WHISPER_COMPUTE_TYPE=int8
WHISPER_LANGUAGE=
WHISPER_BEAM_SIZE=5
WHISPER_VAD_FILTER=true
WHISPER_MODEL_DIR=../.cache/whisper

ADMIN_EMAIL=admin@voice-tweet.com
ADMIN_USERNAME=admin
ADMIN_PASSWORD=ChangeMeAdmin123!
```

Notes:

- `WHISPER_LANGUAGE=` empty means auto-detect.
- The first transcription downloads the model weights locally into `WHISPER_MODEL_DIR`.
- Change `ADMIN_PASSWORD` before exposing the app anywhere real.

## Frontend Environment

Copy [frontend/.env.example](C:/Users/Admin/Desktop/Voice/frontend/.env.example) to `frontend/.env`.

```dotenv
VITE_API_BASE_URL=http://localhost:8000/api
VITE_BACKEND_ORIGIN=http://localhost:8000
```

## Local Run Without Docker

1. Create a virtual environment.

```powershell
python -m venv .venv
.venv\Scripts\activate
```

2. Install backend dependencies.

```powershell
pip install -r backend\requirements.txt
```

3. Start PostgreSQL and Redis.

4. Run the API.

```powershell
uvicorn app.main:app --reload --app-dir backend
```

5. Run the Celery worker.

```powershell
celery -A app.celery_app.celery_app worker --loglevel=info --pool=solo --workdir backend
```

6. Install frontend dependencies and start Vite.

```powershell
cd frontend
npm install
npm run dev
```

## Docker Compose Run

1. Create `backend/.env` from the example.
2. Start the stack.

```powershell
docker compose up --build
```

Services:

- `db`: PostgreSQL
- `redis`: Redis
- `api`: FastAPI application
- `worker`: Celery worker with `ffmpeg` and Faster-Whisper
- `flower`: Celery monitoring UI
- `frontend`: Nginx reverse proxy serving the production frontend bundle and proxying `/api`

The app will be available at:

- Frontend + API proxy: `http://localhost:${FRONTEND_PORT}`
- Flower: `http://localhost:${FLOWER_PORT}`

## Roles

- Guest:
  - `GET /api/tweets/feed`
  - `GET /api/events/stream`
  - `POST /api/auth/register`
  - `POST /api/auth/login`
- User:
  - `GET /api/profile`
  - `PATCH /api/profile`
  - `GET /api/notifications`
  - `POST /api/notifications/read-all`
  - `POST /api/tweets/create`
  - `POST /api/tweets/{id}/like`
  - `DELETE /api/tweets/{id}/like`
  - `POST /api/tweets/{id}/repost`
  - `DELETE /api/tweets/{id}/repost`
  - `POST /api/users/{id}/follow`
  - `DELETE /api/users/{id}/follow`
  - `DELETE /api/tweets/{id}` only for own tweets
- Admin:
  - `GET /api/admin/dashboard`
  - `DELETE /api/tweets/{id}` for any tweet
  - `PATCH /api/users/{id}/ban`

## API Notes

- Storage supports `local` for development and `s3` for production-compatible object storage.
- Public S3 media links are returned as presigned URLs.
- Accepted MIME types are `audio/ogg`, `audio/webm`, and `audio/wav`.
- Upload size is limited to 10 MB.
- Audio duration is limited by `MAX_AUDIO_SECONDS` and checked with `ffprobe`.
- Feed pagination is cursor-based with `cursor_created_at` + `cursor_id`.
- Feed search uses PostgreSQL full-text search plus fallback `ILIKE`.
- Tweet status flow:
  - `processing`
  - `completed`
  - `error`

## Security Notes

- Access and refresh tokens are stored in HttpOnly cookies.
- CSRF protection is enforced on non-GET cookie-authenticated requests.
- Refresh logic is implemented through `/api/auth/refresh`.
- Production refuses to start with the default `SECRET_KEY`.
- Production refuses to use local disk uploads.
- CORS allows only the configured frontend origin.
- FastAPI and Nginx rate limit auth and upload endpoints.
- Delete access is restricted to the owner or an admin.

## Verification

- Frontend production build:

```powershell
npm run build --prefix frontend
```

- Backend syntax can be checked with:

```powershell
py -3 -m compileall backend\app
```
"# laughing-octo-broccoli" 
