# plan.cards

Self-hosted credit card lifecycle tracker. Keep tabs on every card you open, close, or product-change — plus benefits, annual fees, and issuer rules like Chase 5/24.

## Deploy

```bash
git clone https://github.com/cocdeshijie/plan.cards.git
cd plan.cards
docker compose up -d
```

Open **http://localhost:3000** (or your server's IP/hostname) and follow the setup wizard. Only port 3000 is published — the frontend proxies API requests to the backend over the internal Docker network, and the backend is never reachable from outside.

Set `HOST_PORT` to publish on a different port:

```bash
HOST_PORT=8080 docker compose up -d
```

### Behind a reverse proxy (Coolify, Caddy, nginx, Traefik)

`docker-compose.yaml` deliberately declares no host ports; the published port lives in `docker-compose.override.yml`, which a bare `docker compose up -d` merges in automatically. Platform deployments pass an explicit compose file, which suppresses that merge:

```bash
docker compose -f docker-compose.yaml up -d
```

Both containers then stay on the internal network with nothing bound to the host, and your proxy routes to the `frontend` service on port 3000. This is the right shape for Coolify — a fixed published port collides when several apps share a host.

> **Note for Coolify:** point the app at `docker-compose.yaml`. Coolify deploys with an explicit `-f`, so `docker-compose.override.yml` is ignored and no host port is bound.

## Backup

**Admin → Settings → Backup → Download backup.** This produces a complete, consistent snapshot of the database — every profile, plus users, auth mode, and OAuth configuration. It is safe to run while the app is in use.

To restore:

```bash
docker compose stop
docker run --rm -v plan-cards_db-data:/data -v "$PWD":/restore alpine \
  cp /restore/plan-cards-YYYYMMDD-HHMMSS.db /data/cards.db
docker compose start
```

> **Don't copy `cards.db` by hand while the stack is running.** The database uses WAL mode, so recent commits live in `cards.db-wal` until a checkpoint — `docker cp` of `cards.db` alone silently produces a backup that is missing your latest changes, and it looks fine until you restore it. Use the download button, or stop the stack first and copy `cards.db`, `cards.db-wal` and `cards.db-shm` together.

Note that `docker compose down -v` destroys the volume, which includes the database, the signing key, and the OAuth encryption key.

The JSON import/export in the profile menu is a separate, portable per-profile format — useful for moving cards between profiles or instances, but it is not a full backup.

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
