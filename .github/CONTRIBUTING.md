# Contributing to CreditCardTracker

## Adding or Updating Card Templates

Card templates live in `card_templates/<issuer>/<card_name>.yaml`. To contribute:

1. Fork the repository
2. Create or edit a YAML file in the appropriate issuer directory
3. Follow the template schema below
4. Submit a pull request

### Template Schema

```yaml
name: Full Card Name
issuer: Issuer Name
network: Visa | Mastercard | Amex
annual_fee: 95
currency: USD

benefits:
  credits:
    - name: Credit Name
      amount: 50
      frequency: annual | monthly
  bonus_categories:
    - category: Category Name
      multiplier: 3x
      portal_only: false  # optional
      cap: 25000          # optional, annual cap

notes: |
  Free-form notes about the card.

tags:
  - travel
  - cashback
```

### Naming Conventions

- **Issuer directory**: lowercase, underscores for spaces (e.g., `capital_one`)
- **Card file**: lowercase, underscores for spaces (e.g., `sapphire_preferred.yaml`)
- Use the card's most common/recognizable name

### Guidelines

- Keep data accurate and up-to-date
- List all major bonus categories
- Add relevant tags for discoverability
- Include credits that offset the annual fee

## Code Contributions

1. Fork the repo
2. Create a feature branch
3. Make your changes
4. Run tests: `cd backend && pytest` and `cd frontend && bun run build`
5. Submit a pull request

### Development Setup

```bash
# Backend
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload

# Frontend
cd frontend
bun install
bun run dev
```
