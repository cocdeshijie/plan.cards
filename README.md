# CreditCardTracker

A self-hosted credit card lifecycle management tool. Track card openings, closings, product changes, benefits, annual fee dates, and issuer application rules like Chase 5/24.

## Features

- **Card Lifecycle Tracking** — Open dates, close dates, product changes, annual fee dates
- **5/24 Counter** — Per-profile tracking with projected drop-off dates
- **Benefits & Credits Tracking** — Track statement credits, spend thresholds, and usage per period
- **Community Card Templates** — YAML-based templates for popular cards (Chase, Amex, Citi, Capital One, etc.)
- **Multiple Profiles** — Track cards for household members separately
- **Three Views** — List view, calendar view, and timeline view
- **Product Change Chains** — Full history of product changes with event tracking
- **Flexible Auth** — Open mode, single password, multi-user, or OAuth (Google, GitHub, etc.)
- **Docker Self-Hosted** — Simple deployment with Docker Compose

## Quick Start

```bash
git clone https://github.com/your-username/CreditCardTracker.git
cd CreditCardTracker

# Start the application
docker compose up -d
```

Open http://localhost:3000 and complete the setup wizard to configure your auth mode and create your admin account.

The app will be available at:
- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:8000
- **API Docs**: http://localhost:8000/docs

### Non-localhost Deployments

For deployments on a different host or behind a reverse proxy, set both `NEXT_PUBLIC_API_URL` and `ALLOWED_ORIGINS`:

```bash
NEXT_PUBLIC_API_URL=https://api.example.com ALLOWED_ORIGINS=https://example.com docker compose up -d
```

`ALLOWED_ORIGINS` must match the origin where the frontend is served (comma-separated for multiple origins).

A reverse proxy with TLS (e.g., Caddy, nginx, Traefik) is recommended for production use.

## Development

### Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements-dev.txt
uvicorn app.main:app --reload
```

### Frontend

```bash
cd frontend
bun install
bun run dev
```

### Tests

```bash
cd backend
CARD_TEMPLATES_DIR=../card_templates DATABASE_URL=sqlite:///test.db pytest tests/ -v
```

## Card Templates

Card templates are community-contributed YAML files in `card_templates/<issuer>/`. See [CONTRIBUTING.md](.github/CONTRIBUTING.md) for how to add or update templates.

Example template (`card_templates/chase/sapphire_preferred.yaml`):

```yaml
name: Chase Sapphire Preferred
issuer: Chase
network: Visa
annual_fee: 95
currency: USD

benefits:
  bonus_categories:
    - category: Travel
      multiplier: 5x
      portal_only: true
    - category: Dining
      multiplier: 3x

tags:
  - travel
  - transferable-points
```

## License

MIT
