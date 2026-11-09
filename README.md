# Bizzant — Your Business Assistant

Telegram-first business management assistant for small businesses. The Telegram bot is named **BizziUsBot**.

## Included
- Multi-business accounts with isolated tenant data
- Owner/admin/staff membership roles in PostgreSQL
- Business onboarding and business switching
- Customers, products/services, orders, appointments and payments
- Daily summary
- Telegram bot using long polling
- Optional HTTP health endpoint

## Deploy on Render
Create a **Background Worker** connected to this repository:
- Build: `npm install`
- Start: `npm start`

Environment variables:
- `BOT_TOKEN` — Telegram bot token (keep secret)
- `DATABASE_URL` — PostgreSQL connection string
- `DATABASE_SSL` — set `true` if your database requires SSL

Run the database migration once:
`npm run db:migrate`

For a separate health/API service, create a Render Web Service:
- Build: `npm install`
- Start: `npm run api`

## Local setup
Copy `.env.example` to `.env`, set the variables, run `npm install`, `npm run db:migrate`, then `npm start`.

Never commit `.env` or paste bot tokens into public chats.
