# plan.cards

Self-hosted credit card lifecycle tracker. Keep tabs on every card you open, close, or product-change — plus benefits, annual fees, and issuer rules like Chase 5/24.

## Deploy

```bash
git clone https://github.com/cocdeshijie/plan.cards.git
cd plan.cards
docker compose up -d
```

Open **http://localhost:3000** and follow the setup wizard to pick an auth mode and create your account.

### Non-localhost / reverse proxy

Set `NEXT_PUBLIC_API_URL` to the backend's public URL and `ALLOWED_ORIGINS` to the frontend's origin:

```bash
NEXT_PUBLIC_API_URL=https://api.example.com ALLOWED_ORIGINS=https://example.com docker compose up -d
```

A reverse proxy with TLS (Caddy, nginx, Traefik, etc.) is recommended for production.

## Features

- **Card lifecycle tracking** — open dates, close dates, product changes, annual fee dates
- **5/24 counter** — per-profile tracking with projected drop-off dates
- **Benefits & credits tracking** — statement credits, spend thresholds, and usage per reset period
- **Multiple profiles** — track cards for household members separately
- **Three views** — list, calendar, and timeline
- **Product change history** — full chain of product changes with event tracking
- **Import / export** — back up and restore your data as JSON
- **Flexible auth** — open access, single password, multi-user, or OAuth (Google, GitHub, etc.)
- **385+ community card templates** — pre-built YAML templates across 27+ issuers

## Card Templates

Templates live in `card_templates/<issuer>/<card_name>/` as YAML files with optional card images. They ship with the app — when you add a card, pick a template and its benefits, categories, and annual fee are pre-filled.

**Contributions are welcome.** If a card is missing or out of date, open a PR. See [CONTRIBUTING.md](.github/CONTRIBUTING.md) for guidelines and [TEMPLATE_REFERENCE.yaml](card_templates/TEMPLATE_REFERENCE.yaml) for the full schema.

Example (`card_templates/chase/sapphire_preferred/card.yaml`):

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
  credits:
    - name: Hotel Credit
      amount: 50
      frequency: annual
      reset_type: cardiversary

tags:
  - travel
  - transferable-points
```

## Development

### Backend

```bash
cd backend
python -m venv venv && source venv/bin/activate
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
CARD_TEMPLATES_DIR=../card_templates DATABASE_URL=sqlite:///test.db RATE_LIMIT_ENABLED=false pytest tests/ -v
```

## License

MIT
