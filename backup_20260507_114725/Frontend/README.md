# VALRIFT Champions Frontend

Static frontend for your hosted Valorant tournament backend at `https://val.dev.ap-south-1.metaecho.com`.

## Files

- `index.html`: main single-page app shell
- `styles.css`: premium Valorant/esports UI styling
- `app.js`: registration, Razorpay flow, and dashboard logic
- `config.js`: frontend configuration

## Setup

1. Edit `config.js` and replace `RAZORPAY_PUBLIC_KEY_HERE` with your Razorpay public key.
2. Serve this folder with any static server.

Example:

```bash
python3 -m http.server 4173
```

Then open `http://localhost:4173`.

## Current backend assumptions

- Gmail login: `POST /auth/login` with `{ email, username, password, role }`
- Team creation: `POST /teams`
- Player registration: `POST /players`
- Order creation: `POST /payments/create-order`
- Payment verify: `POST /payments/verify`
- Current tournament by type: `GET /tournaments/current/:type`
- Current teams by type: `GET /tournaments/teams/:type`
- Current matches by type: `GET /tournaments/matches/:type`
- Team-specific bracket: `GET /tournaments/by-team/:teamId`

## Backend limitation to address next

Your backend currently returns only the latest active tournament per type. If one tournament is `running` and a new `waiting` tournament is created for the same type, older teams may see the newer bracket instead of their own. The frontend uses the existing API, but the correct long-term fix is a backend endpoint that fetches the tournament by `team_id`.

## Auth backend update

The backend should deploy the updated `routes/auth.js`. It creates a `users` table on first login, requires `@gmail.com`, stores a salted password hash, and enforces a unique username. Set `ADMIN_USERNAME` to the same owner username used in `config.js`, and keep `JWT_SECRET` private.

## Knockout and MailHog

When the sixth paid team joins a tournament, the backend now creates a 6-team knockout bracket instead of round-robin matches. Match times are scheduled into Friday-Sunday windows between 6 PM and 12 AM, and fixture emails are sent through MailHog SMTP using `MAILHOG_HOST`, `MAILHOG_SMTP_PORT`, and `MAIL_FROM`.
