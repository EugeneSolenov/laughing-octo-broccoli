<h1 align="center">Flutter</h1>

<p align="center">
  Социальная веб-лента для голосовых публикаций с автоматической транскрибацией на русском языке.
</p>

<p align="center">
  <img alt="Python" src="https://img.shields.io/badge/Python-3.11-3776AB?style=for-the-badge&logo=python&logoColor=white">
  <img alt="FastAPI" src="https://img.shields.io/badge/FastAPI-Backend-009688?style=for-the-badge&logo=fastapi&logoColor=white">
  <img alt="React" src="https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react&logoColor=111111">
  <img alt="PostgreSQL" src="https://img.shields.io/badge/PostgreSQL-16-4169E1?style=for-the-badge&logo=postgresql&logoColor=white">
  <img alt="Docker" src="https://img.shields.io/badge/Docker-Compose-2496ED?style=for-the-badge&logo=docker&logoColor=white">
</p>

<p align="center">
  <a href="#быстрый-старт">Быстрый старт</a> ·
  <a href="#возможности">Возможности</a> ·
  <a href="#стек">Стек</a> ·
  <a href="#транскрибация">Транскрибация</a> ·
  <a href="#api">API</a> ·
  <a href="#проверка-и-тесты">Тесты</a>
</p>

> В коде местами ещё встречается старое рабочее название `Voice Twitter`: оно осталось в имени базы, frontend-пакета и части переменных. Актуальное название проекта для описания и отчёта — `Flutter`.

## Содержание

- [О проекте](#о-проекте)
- [Возможности](#возможности)
- [Стек](#стек)
- [Структура](#структура)
- [Быстрый старт](#быстрый-старт)
- [Локальный запуск](#локальный-запуск)
- [Настройки окружения](#настройки-окружения)
- [Транскрибация](#транскрибация)
- [Постобработка текста](#постобработка-текста)
- [Роли](#роли)
- [API](#api)
- [База данных](#база-данных)
- [Безопасность](#безопасность)
- [Проверка и тесты](#проверка-и-тесты)
- [Частые проблемы](#частые-проблемы)
- [Материалы отчёта](#материалы-отчёта)

## О проекте

Flutter — full-stack приложение для публикации коротких голосовых записей. Пользователь записывает или загружает аудио, публикует его в ленту, получает текстовую расшифровку и взаимодействует с другими авторами через ответы, реакции, подписки и уведомления.

Главная идея проекта — сделать голосовые публикации удобными для чтения, поиска и обсуждения. Поэтому аудио хранится вместе с текстом транскрипции, а обработка выполняется асинхронно: публикация появляется сразу, а текст добавляется после завершения worker-задачи.

## Возможности

| Направление | Что реализовано |
| --- | --- |
| Аккаунты | Регистрация, вход, refresh-сессии, выход, смена пароля, email/password flow |
| Безопасность | HttpOnly cookie, JWT, CSRF, CORS, rate limits, production-валидация настроек |
| Публикации | Создание голосовых постов, ответы, удаление, редактирование текста, повтор транскрибации |
| Транскрибация | Faster-Whisper, русская модель, VAD, FFmpeg-нормализация, retry-логика |
| Постобработка | Автозамены, локальные правила, optional LLM-коррекция |
| Социальные функции | Лайки, репосты/дизлайки, подписки, блокировки, скрытие пользователей |
| Realtime | Server-Sent Events для обновления ленты, статуса транскрибации и уведомлений |
| Администрирование | Панель администратора, жалобы, бан пользователей, удаление спорных публикаций |
| Хранилище | Локальное хранилище для разработки и S3-совместимый режим для production |
| Отчётность | DOCX-отчёт, PlantUML-диаграммы, HTML/CSS-версии схем |

## Стек

| Слой | Технологии |
| --- | --- |
| Backend | Python 3.11, FastAPI, SQLAlchemy, Alembic, Pydantic Settings |
| База данных | PostgreSQL 16 |
| Очереди | Celery, Redis |
| Realtime | Redis Pub/Sub, Server-Sent Events |
| Аудио | FFmpeg, ffprobe, Faster-Whisper, VAD |
| Frontend | React 18, Vite, React Router, Tailwind CSS, Framer Motion |
| Медиа-интерфейс | WaveSurfer.js, Lucide icons |
| Контейнеризация | Docker, Docker Compose, Nginx |
| Качество кода | Pytest, Vitest, Ruff, Mypy |
| Наблюдаемость | Sentry при наличии DSN |

## Структура

```text
Voice/
|-- backend/
|   |-- alembic/              # миграции базы данных
|   |-- app/
|   |   |-- auth.py           # JWT, cookie, сессии
|   |   |-- celery_app.py     # экспорт Celery-приложения
|   |   |-- config.py         # настройки из backend/.env
|   |   |-- database.py       # БД и bootstrap администратора
|   |   |-- events.py         # realtime-события
|   |   |-- main.py           # FastAPI app
|   |   |-- media.py          # проверка и нормализация аудио
|   |   |-- models.py         # SQLAlchemy-модели
|   |   |-- postprocess.py    # правила и LLM-постобработка
|   |   |-- replacements.py   # автозамены транскрипции
|   |   |-- storage.py        # local/S3-хранилище
|   |   |-- transcription.py  # Celery + Faster-Whisper
|   |   `-- routers/
|   |       |-- admin.py
|   |       |-- auth.py
|   |       |-- events.py
|   |       |-- notifications.py
|   |       |-- tweets.py
|   |       `-- users.py
|   `-- requirements.txt
|-- frontend/
|   |-- Dockerfile
|   |-- nginx.conf
|   |-- package.json
|   `-- src/
|       |-- App.jsx
|       |-- api/client.js
|       |-- components/
|       |-- context/
|       `-- utils/
|-- report/                  # отчёт, диаграммы, шаблоны
|-- uploads/                 # локальные загруженные файлы
|-- docker-compose.yml
|-- Dockerfile
|-- pyproject.toml
`-- README.md
```

## Быстрый старт

Нужны Docker и Docker Compose.

```powershell
Copy-Item .env.example .env
Copy-Item backend\.env.example backend\.env
docker compose up --build
```

После запуска:

| Что | Адрес |
| --- | --- |
| Приложение | `http://localhost:5173` |
| API через frontend proxy | `http://localhost:5173/api` |
| Health check | `http://localhost:5173/api/health` |
| Ready check | `http://localhost:5173/api/ready` |

> `api` внутри Docker Compose не проброшен наружу отдельным портом. Снаружи запросы идут через Nginx во frontend-контейнере.

### Flower

Flower запускается отдельным ops-профилем:

```powershell
docker compose --profile ops up --build
```

По умолчанию интерфейс Celery будет доступен на `http://localhost:5555`.

## Локальный запуск

Для запуска без Docker нужны PostgreSQL, Redis, FFmpeg и Python 3.11.

### Backend

```powershell
python -m venv .venv
.venv\Scripts\activate
pip install -r backend\requirements.txt
Copy-Item backend\.env.example backend\.env
```

Примените миграции:

```powershell
cd backend
alembic -c alembic.ini upgrade head
cd ..
```

Запустите API:

```powershell
uvicorn app.main:app --reload --app-dir backend
```

Запустите worker во втором терминале:

```powershell
celery -A app.celery_app:celery_app worker --loglevel=info --pool=solo --workdir backend
```

### Frontend

```powershell
cd frontend
npm install
npm run dev
```

Для локального Vite-режима используйте:

```dotenv
VITE_API_BASE_URL=http://localhost:8000/api
VITE_BACKEND_ORIGIN=http://localhost:8000
```

Для Docker/production-сборки:

```dotenv
VITE_API_BASE_URL=/api
VITE_BACKEND_ORIGIN=
```

## Настройки окружения

<details>
<summary><strong>Корневой .env</strong></summary>

Корневой `.env` читает `docker-compose.yml`.

```dotenv
POSTGRES_DB=voice_twitter
POSTGRES_USER=voice
POSTGRES_PASSWORD=replace-with-a-strong-postgres-password
FRONTEND_PORT=5173
FLOWER_PORT=5555
```

</details>

<details>
<summary><strong>Backend .env</strong></summary>

Основные группы настроек лежат в `backend/app/config.py`.

| Группа | Переменные |
| --- | --- |
| Приложение | `APP_NAME`, `ENVIRONMENT`, `DEBUG`, `BACKEND_ORIGIN`, `FRONTEND_ORIGIN` |
| База и Redis | `DATABASE_URL`, `REDIS_URL` |
| Auth | `SECRET_KEY`, `JWT_ALGORITHM`, `ACCESS_TOKEN_EXPIRE_MINUTES`, `REFRESH_TOKEN_EXPIRE_DAYS` |
| Cookie/CSRF | `ACCESS_COOKIE_NAME`, `REFRESH_COOKIE_NAME`, `CSRF_COOKIE_NAME`, `CSRF_HEADER_NAME`, `COOKIE_SECURE`, `COOKIE_SAMESITE`, `COOKIE_DOMAIN` |
| Загрузки | `UPLOADS_DIR`, `MAX_UPLOAD_BYTES`, `MAX_AUDIO_SECONDS` |
| Хранилище | `STORAGE_BACKEND`, `STORAGE_BUCKET`, `STORAGE_ENDPOINT_URL`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY` |
| Аудио | `AUDIO_ENHANCEMENT_ENABLED`, `AUDIO_HIGHPASS_HZ`, `AUDIO_LOWPASS_HZ`, `AUDIO_LOUDNORM_ENABLED` |
| Whisper | `WHISPER_MODEL_SIZE`, `WHISPER_LANGUAGE`, `WHISPER_BEAM_SIZE`, `WHISPER_VAD_FILTER` |
| Постобработка | `TRANSCRIPTION_REPLACEMENTS`, `TRANSCRIPTION_POSTPROCESS_*` |
| Админ | `ADMIN_EMAIL`, `ADMIN_USERNAME`, `ADMIN_PASSWORD` |

В production приложение откажется стартовать с дефолтным `SECRET_KEY`, insecure cookie и локальным файловым хранилищем.

</details>

## Транскрибация

Транскрибация выполняется асинхронно:

1. Пользователь отправляет аудио.
2. API сохраняет публикацию со статусом `processing`.
3. Celery worker нормализует аудио через FFmpeg.
4. Faster-Whisper распознаёт речь.
5. Текст проходит постобработку.
6. Публикация получает статус `completed` или `error`.
7. Frontend получает realtime-событие через SSE.

Рекомендуемые настройки текущего проекта:

```dotenv
WHISPER_MODEL_SIZE=dvislobokov/faster-whisper-large-v3-turbo-russian
WHISPER_DEVICE=cpu
WHISPER_COMPUTE_TYPE=int8
WHISPER_LANGUAGE=ru
WHISPER_BEAM_SIZE=7
WHISPER_BEST_OF=3
WHISPER_VAD_FILTER=true
WHISPER_CONDITION_ON_PREVIOUS_TEXT=false
WHISPER_INITIAL_PROMPT=
WHISPER_HOTWORDS=
WHISPER_MODEL_DIR=../.cache/whisper
```

Важные детали:

- русская fine-tuned модель выбрана ради качества на русской речи;
- `WHISPER_LANGUAGE=ru` снижает риск ошибочного автоопределения языка;
- `WHISPER_BEAM_SIZE=7` улучшает качество, но увеличивает время обработки;
- `WHISPER_INITIAL_PROMPT` и `WHISPER_HOTWORDS` намеренно пустые для этой модели;
- первый запуск скачивает веса модели в `.cache/whisper` или Docker volume `whisper_cache`.

## Постобработка текста

После Whisper текст может пройти правила, автозамены и LLM-этап.

```dotenv
TRANSCRIPTION_POSTPROCESS_ENABLED=true
TRANSCRIPTION_POSTPROCESS_MODE=rules+llm
TRANSCRIPTION_POSTPROCESS_LLM_REQUIRED=false
TRANSCRIPTION_POSTPROCESS_LLM_API_KEY=
TRANSCRIPTION_POSTPROCESS_LLM_BASE_URL=https://api.openai.com/v1
TRANSCRIPTION_POSTPROCESS_LLM_MODEL=
```

| Режим | Что делает |
| --- | --- |
| `rules` | Только локальные правила |
| `llm` | Только LLM-коррекция |
| `rules+llm` | Сначала правила, затем LLM |
| `llm+rules` | Сначала LLM, затем финальная нормализация |

Если `TRANSCRIPTION_POSTPROCESS_LLM_REQUIRED=false`, отсутствие API-ключа или модели не ломает транскрибацию.

Формат автозамен:

```dotenv
TRANSCRIPTION_REPLACEMENTS=ошибочный текст=правильный текст;ещё ошибка=исправление
TRANSCRIPTION_POSTPROCESS_REPLACEMENTS=превед=привет;щас=сейчас
```

## Роли

| Роль | Возможности |
| --- | --- |
| Гость | Просмотр публичной ленты, профилей, поиск, регистрация, вход |
| Пользователь | Публикации, ответы, реакции, подписки, жалобы, профиль, уведомления, сессии |
| Администратор | Панель управления, жалобы, бан пользователей, удаление публикаций |

Администратор создаётся автоматически, если его ещё нет:

```dotenv
ADMIN_EMAIL=admin@voice-tweet.com
ADMIN_USERNAME=admin
ADMIN_PASSWORD=ChangeMeAdmin123!
```

Перед реальным показом проекта пароль администратора нужно заменить.

## API

<details>
<summary><strong>Служебные маршруты</strong></summary>

- `GET /api/health`
- `GET /api/ready`
- `GET /api/events/stream`

</details>

<details>
<summary><strong>Авторизация</strong></summary>

- `GET /api/auth/csrf`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `GET /api/auth/session`
- `GET /api/auth/sessions`
- `DELETE /api/auth/sessions/{session_id}`
- `POST /api/auth/logout`
- `POST /api/auth/logout-all`
- `POST /api/auth/change-password`
- `POST /api/auth/request-email-verification`
- `POST /api/auth/verify-email`
- `POST /api/auth/request-password-reset`
- `POST /api/auth/reset-password`

</details>

<details>
<summary><strong>Публикации</strong></summary>

- `GET /api/tweets/feed`
- `GET /api/tweets/{tweet_id}`
- `POST /api/tweets/create`
- `POST /api/tweets/{tweet_id}/reply`
- `PATCH /api/tweets/{tweet_id}`
- `POST /api/tweets/{tweet_id}/rerun-transcription`
- `DELETE /api/tweets/{tweet_id}`
- `POST /api/tweets/{tweet_id}/like`
- `DELETE /api/tweets/{tweet_id}/like`
- `POST /api/tweets/{tweet_id}/dislike`
- `DELETE /api/tweets/{tweet_id}/dislike`

</details>

<details>
<summary><strong>Пользователи, уведомления и админка</strong></summary>

- `GET /api/profile`
- `PATCH /api/profile`
- `POST /api/profile/avatar`
- `GET /api/settings/preferences`
- `PATCH /api/settings/preferences`
- `GET /api/users/search`
- `GET /api/users/suggestions`
- `GET /api/users/{user_id}`
- `POST /api/users/{user_id}/follow`
- `DELETE /api/users/{user_id}/follow`
- `POST /api/users/{user_id}/block`
- `DELETE /api/users/{user_id}/block`
- `POST /api/users/{user_id}/mute`
- `DELETE /api/users/{user_id}/mute`
- `POST /api/reports`
- `GET /api/notifications`
- `POST /api/notifications/{notification_id}/read`
- `POST /api/notifications/read-all`
- `GET /api/admin/dashboard`
- `PATCH /api/admin/reports/{report_id}`
- `PATCH /api/users/{user_id}/ban`

</details>

## База данных

| Таблица | Назначение |
| --- | --- |
| `users` | Аккаунты, роли, профиль и настройки |
| `voice_tweets` | Голосовые публикации, ответы, аудио, статус и текст |
| `notifications` | Уведомления о событиях |
| `auth_sessions` | Refresh-сессии пользователя |
| `reports` | Жалобы на пользователя или публикацию |
| `follows` | Подписки |
| `tweet_likes` | Положительные реакции |
| `tweet_reposts` | Репосты/дизлайки в текущей реализации |
| `user_blocks` | Блокировки |
| `user_mutes` | Скрытие пользователей |

Схемы и диаграммы находятся в `report/plantuml`.

Статусы публикации:

| Статус | Значение |
| --- | --- |
| `processing` | Аудио принято, транскрибация ещё идёт |
| `completed` | Текст успешно получен и сохранён |
| `error` | Обработка завершилась ошибкой |

## Безопасность

- Access и refresh token хранятся в HttpOnly cookie.
- Небезопасные методы защищены CSRF-токеном.
- CORS ограничен `FRONTEND_ORIGIN`.
- Production-режим запрещает дефолтный `SECRET_KEY`.
- Production-режим запрещает локальное файловое хранилище.
- Rate limits настроены для входа, регистрации, создания и удаления публикаций.
- Удаление чужих публикаций доступно только администратору.
- Блокировки и скрытие пользователей учитываются в ленте, профилях и доступе к публикациям.

## Проверка и тесты

| Область | Команда |
| --- | --- |
| Backend tests | `pytest` |
| Backend syntax | `py -3 -m compileall backend\app` |
| Ruff | `ruff check .` |
| Mypy | `mypy backend` |
| Frontend tests | `npm test --prefix frontend` |
| Frontend build | `npm run build --prefix frontend` |
| Docker config | `docker compose config` |

## Частые проблемы

<details>
<summary><strong>Первая транскрибация идёт долго</strong></summary>

Первый запуск скачивает модель Faster-Whisper. В Docker она сохраняется в volume `whisper_cache`, поэтому следующие запуски обычно быстрее.

</details>

<details>
<summary><strong>Frontend не видит backend</strong></summary>

Проверьте `VITE_API_BASE_URL`:

- Docker: `/api`;
- локальный Vite: `http://localhost:8000/api`.

Также проверьте `FRONTEND_ORIGIN` в `backend/.env`.

</details>

<details>
<summary><strong>Cookie не сохраняются локально</strong></summary>

Для локальной разработки:

```dotenv
COOKIE_SECURE=false
COOKIE_SAMESITE=lax
```

Для production при HTTPS нужно вернуть `COOKIE_SECURE=true`.

</details>

<details>
<summary><strong>LLM-постобработка не запускается</strong></summary>

Нужно указать:

```dotenv
TRANSCRIPTION_POSTPROCESS_LLM_API_KEY=...
TRANSCRIPTION_POSTPROCESS_LLM_MODEL=...
TRANSCRIPTION_POSTPROCESS_LLM_BASE_URL=https://api.openai.com/v1
```

Если `TRANSCRIPTION_POSTPROCESS_LLM_REQUIRED=false`, отсутствие этих переменных не считается ошибкой.

</details>

<details>
<summary><strong>Русская транскрибация стала хуже</strong></summary>

Проверьте, что не включены принудительные `WHISPER_INITIAL_PROMPT` и `WHISPER_HOTWORDS`. Для текущей русской модели они намеренно пустые.

</details>

