# CreditCardTracker

## Project Overview
Docker self-hosted credit card lifecycle tracker. Tracks openings, closings, product changes, benefits, annual fee dates, and issuer application rules like Chase 5/24.

## Tech Stack
- **Frontend**: Next.js (App Router) + TypeScript + Tailwind CSS + shadcn/ui
- **Backend**: Python FastAPI + SQLite (SQLAlchemy)
- **Card Templates**: Community-contributed YAML files in `card_templates/`
- **Deployment**: Docker Compose

## Key Commands
- `docker compose up --build` — run the full stack
- Backend dev: `cd backend && pip install -r requirements-dev.txt && uvicorn app.main:app --reload`
- Frontend dev: `cd frontend && bun install && bun run dev`
- Backend tests: `cd backend && CARD_TEMPLATES_DIR=../card_templates DATABASE_URL=sqlite:///test.db RATE_LIMIT_ENABLED=false pytest tests/ -v`

## Project Structure
- `backend/app/` — FastAPI application
  - `routers/` — auth, cards, events, profiles, benefits, bonuses, templates, settings, setup, admin, oauth, users
  - `models/` — SQLAlchemy models (card, profile, user, oauth_provider, oauth_account, etc.)
  - `schemas/` — Pydantic request/response schemas
  - `services/` — Business logic (card_service, auth_service, oauth_service, etc.)
  - `utils/` — Timezone handling, period utilities
- `frontend/src/` — Next.js application (App Router, components, lib, hooks)
- `card_templates/<issuer>/<card>.yaml` — community YAML card templates

## Architecture Notes
- Card templates are YAML files loaded at backend startup, served via API
- Product changes update the card's `template_id` and create a `product_change` event
- 5/24 counts only personal cards opened in last 24 months per profile
- Auth: 4 modes (open → single_password → multi_user → multi_user_oauth), configured via setup wizard on first run. Modes can only be upgraded, never downgraded.
- OAuth state stored in DB (`oauth_states` table), not in-memory
- Rate limiting on auth endpoints via slowapi (disabled in tests via `RATE_LIMIT_ENABLED=false`)
- SQLite DB persisted via Docker volume at `/data/cards.db`
- Runtime API URL injection via `/__env.js` for non-localhost Docker deployments
