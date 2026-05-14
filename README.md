# VALO Champions — `valotournament.in`

End-to-end web platform for running 8-team Valorant tournaments. Players sign up, build a roster, pay an entry fee via UPI, and get a custom-lobby code (party ID) on their dashboard 30 minutes before kickoff. Admin clears payment verifications and crowns the winner. Deployed on EKS in `ap-south-1`.

Live: <https://www.valotournament.in>

---

## Tech stack at a glance

| Layer | Language / Runtime | Framework / Key libraries |
|---|---|---|
| **Frontend** | **Vanilla JavaScript (ES2017+)**, HTML5, CSS3 | No build step, no framework. `qrcode` library on backend (not client); QR is delivered as a PNG data URL. |
| **Frontend server** | nginx (`nginxinc/nginx-unprivileged:1.27-alpine`) | Static file serving + security headers (CSP, HSTS, X-Frame-Options, etc.) |
| **Backend** | **Node.js 20 (CommonJS)** | `express` v5, `pg`, `jsonwebtoken`, `qrcode`, `helmet`, `cors`, `express-rate-limit`, `dotenv` |
| **Database** | **PostgreSQL** | Schema migrations are run inline at startup (`ensure*Table()` helpers per route — no migration tool). |
| **Infrastructure** | Docker, Kubernetes (EKS) | ECR for images, nginx-ingress, cert-manager + Let's Encrypt for TLS, Hostinger for DNS, AWS NLB. |
| **Payments** | UPI (direct, no payment gateway) | Server-generates `upi://pay?...` QR; user submits UTR; admin verifies against bank statement. |

The frontend is intentionally framework-less so it can be hosted anywhere without a build pipeline — the `.html`, `.js`, `.css` files are served as-is.

---

## Repo layout

```
.
├── README.md                  # this file
├── SECURITY.md                # security review notes
├── .gitignore
├── Backend/
│   ├── index.js               # app entrypoint, CORS, helmet, rate limits, route mounts
│   ├── db.js                  # pg.Pool factory
│   ├── package.json           # Node deps
│   ├── Dockerfile             # multi-stage build, runs as `node` user, tini PID 1
│   ├── deployment.yaml        # K8s Deployment (readOnlyRootFilesystem, securityContext)
│   ├── service.yaml           # ClusterIP svc on :80 → container :3000
│   ├── ingress.yaml           # api.valotournament.in → val-backend-svc
│   ├── secret.yaml            # Sample secret manifest (replace placeholders before kubectl apply)
│   ├── pg.yaml / pg-svc.yaml  # Postgres pod + service (in-cluster)
│   ├── networkpolicy.yaml     # Default-deny + per-app allows (currently not applied in cluster)
│   ├── middleware/
│   │   └── auth.js            # verifyJwt, requireAdmin, requireSelfOrAdmin
│   ├── routes/
│   │   ├── auth.js            # POST /auth/register, /auth/login (username + phone + password)
│   │   ├── team.js            # team create / list-mine / list-all (admin)
│   │   ├── player.js          # roster CRUD with team-ownership guard
│   │   ├── payment.js         # UPI QR + UTR + admin verify/revoke
│   │   ├── tournament.js      # bracket fetch, public lookup
│   │   ├── matches.js         # match-level reads
│   │   └── admin.js           # admin overview, /users, /payments[/pending], match controls, set party_id
│   └── services/
│       └── matchmaking.js     # legacy seeding helper
└── Frontend/
    ├── index.html             # single page; views toggled by class (no router)
    ├── app.js                 # all logic — IIFE, ~2k lines, no framework
    ├── config.js              # public-only window.APP_CONFIG (apiBaseUrl, adminUsername)
    ├── styles.css             # mirror-red theme with CSS custom properties
    ├── nginx.conf             # listens on 8080 (unprivileged image), CSP + cache rules
    ├── Dockerfile             # static-asset image
    ├── deployment.yaml        # 2 replicas, readOnlyRootFilesystem, /var/cache/nginx writable
    ├── service.yaml           # ClusterIP svc on :80 → container :8080
    └── ingress.yaml           # www.valotournament.in → val-frontend-svc (+ /api → val-backend-svc)
```

---

## Architecture

```
                                Internet
                                   │
                       Hostinger DNS  (api., www., →)
                                   │
                                   ▼
                  AWS NLB  ◄──  ingress-nginx-controller
                                   │
        ┌──────────────────────────┼──────────────────────────┐
        │                          │                          │
        ▼                          ▼                          ▼
  www.valotournament.in     api.valotournament.in      (TLS via cert-manager
   → val-frontend-svc        → val-backend-svc          + Let's Encrypt)
   → :8080 nginx pods        → :3000 node pods
   (static HTML/JS/CSS)      (Express app, JWT auth)
                                   │
                                   ▼
                          postgres (ClusterIP svc)
                          → Postgres 16 pod
                            (matches, teams, users,
                             players, payments,
                             tournaments)
```

- All API calls from the browser go same-origin to `https://www.valotournament.in/api/...` — the frontend ingress merges a `/api → val-backend-svc` rule onto the same host so CORS preflight is avoided. The `api.valotournament.in` subdomain exists for direct API access from external tools / monitoring.
- The frontend nginx serves static assets only; no proxying. The browser hits `/api` directly.
- TLS certs are managed automatically by cert-manager (HTTP-01 challenge through ingress-nginx). Two certs: `www-valotournament-tls`, `api-valotournament-tls`.

---

## Features

### Auth (username + phone + password, no email)

- `POST /auth/register` — `{ username, phone, password, role? }`. Username 3-24 chars `[A-Za-z0-9_]`, phone is normalized to 10-digit Indian mobile (accepts `+91 / 91 / 0` prefixes), password ≥ 8 chars. Phone is unique. Admin role only granted if username matches `ADMIN_USERNAME` env.
- `POST /auth/login` — `{ username, password, role? }`. Returns JWT (`{ id, username, role }`) signed with `JWT_SECRET`, 1h expiry.
- Identity header is **`X-User-Username`** (legacy `X-User-Email` still accepted during cutover). The `owner_email` column on `teams` is a legacy name — it stores usernames in the new schema.
- Phone numbers are visible **only** in the admin panel (`/admin/users`). Never returned by player-facing endpoints.

### Team + roster

- A user can own up to 5 teams (`MAX_TEAMS_PER_OWNER`). Team requires name + agent_id.
- Up to 6 players per team. The 6th slot is intended as a standby — placeholders are allowed. Duplicate Riot IDs across teams are rejected by a uniqueness check on `valorant_name + valorant_tag`.

### Payment (UPI, no gateway)

The Razorpay flow was removed because the business category (real-money skill gaming) is restricted at most Indian PGs. Replaced with direct UPI:

1. Player picks tier (Amateur ₹250 / Pro ₹500) and clicks **Generate Payment QR**.
2. Backend generates a unique transaction reference `tr = "VL<hex>"`, stores a `pending` row in `payments`, and renders the QR (`upi://pay?pa=<VPA>&pn=...&am=250&tr=VLxxx&cu=INR`) **server-side as a PNG data URL**. No client-side QR library, no CDN.
3. Player scans with any UPI app, pays, copies the UTR (12-digit reference), pastes it back on the site.
4. **Manual verify** (default): payment lands in admin's **Pending Payment Verifications** queue. Admin cross-checks UTR against their bank app, clicks **Verify** → team slots into a waiting tournament.
5. **Auto-verify** (optional, via `AUTO_VERIFY_PAYMENTS=true`): trust-then-verify. UTR submission immediately slots the team. Admin can **Revoke** later from the All Payments table if the UTR doesn't match the bank statement. The revoke flow unwinds the team from a `waiting` tournament; tournaments in `running` state are left intact (manual handling).
6. **Testing bypass**: `PAYMENTS_DISABLED=true` skips the QR/UTR step entirely — team slotted immediately on order creation. Bypassed payments are tagged with `verified_by='bypass'` and `vpa='TEST_BYPASS'` for easy cleanup.

### Tournament bracket

- 8 teams per tournament; one tournament per (type, status='waiting') at a time.
- When the 8th team's payment is verified, matches auto-generate: 4 quarterfinals (round 1, positions 1-4), 2 semifinals (round 2), 1 final (round 3). Match times scheduled in 90-minute intervals starting 2h after the bracket fills (admin can re-schedule).
- Winner advancement: setting a QF winner auto-fills the corresponding SF slot. Same for SF → Final. Setting the Final winner closes the tournament (`status='completed'`, `winner_team_id`, `completed_at`).

### Party ID (Valorant custom-lobby code)

- Admin sets a per-match `party_id` from the match controls panel ~30 min before kickoff.
- Players see a red lobby-code badge with a Copy button on their team dashboard, but only for matches their team is in.
- Wrapped in `// [party_id feature …]` markers throughout the code so the feature is grep-able and easy to remove.

### Admin console

- Pending Payment Verifications queue.
- All Tournaments overview with per-match controls (schedule, start, set party ID, set winner).
- Unassigned Teams panel.
- All Payments history with Revoke button on verified rows.
- Stats cards (tournaments, teams, players, users).

### UI

- Mirror-red theme (chrome metallic gradient on primary buttons).
- Home page has a hero + "How It Works" (8-step flow) + "Tournament Schedule" (Friday cadence) + "Trust & Safety" panel.
- Single-page app — view switching by class toggle, no client-side router.

---

## API surface

Routes are mounted under both `/` and `/api` for ingress flexibility.

### Auth

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/auth/register` | none | Body `{ username, phone, password, role? }` |
| POST | `/auth/login` | none | Body `{ username, password, role? }` → `{ token, user }` |

### Teams + players

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/teams` | self or admin | Body `{ name, agent_id }`. `X-User-Username` header forced to token |
| GET | `/teams/mine` | self or admin | Returns teams owned by header username |
| GET | `/teams` | admin | All teams |
| POST | `/players` | team owner | Body `{ team_id, name, valorant_name, tag }` |
| GET | `/players` | admin | All players |
| GET | `/players/:teamId` | team owner | Roster for that team |

### Payments

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/payments/create-order` | team owner | Returns `{ order_id, tr, qr_data_url, vpa, amount, valid_until }` (or `{ bypassed: true, tournament_id, position }` when `PAYMENTS_DISABLED=true`) |
| POST | `/payments/submit-utr` | team owner | Body `{ order_id, utr, screenshot_data_url? }`. Auto-verifies if `AUTO_VERIFY_PAYMENTS=true` |
| GET | `/payments/status/:order_id` | team owner or admin | Polling endpoint |
| POST | `/payments/admin/verify` | admin | Manual verify + slot team |
| POST | `/payments/admin/reject` | admin | Reject pending submission |
| POST | `/payments/admin/revoke` | admin | Undo a verified payment (unwinds team from `waiting` tournaments) |

### Tournaments

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/tournaments/:id` | team owner of any team in tournament, or admin | Bracket, teams, matches, roster (own team only) |
| GET | `/tournaments/lookup/:type` | team owner | `?team_id=N` |

### Admin

| Method | Path | Notes |
|---|---|---|
| GET | `/admin/stats` | Aggregate counts |
| GET | `/admin/tournaments/overview` | All tournaments + teams + players + matches |
| GET | `/admin/teams/unassigned` | Teams not yet in a tournament |
| GET | `/admin/users` | All users with phone (admin-only exposure) |
| GET | `/admin/payments` | Full payment history |
| GET | `/admin/payments/pending` | Just the queue waiting for verification |
| POST | `/admin/match/schedule` | Body `{ match_id, scheduled_time }` |
| POST | `/admin/match/start` | Body `{ match_id }` |
| POST | `/admin/match/set-winner` | Body `{ match_id, winner_id }` — auto-advances winner |
| POST | `/admin/match/party-id` | Body `{ match_id, party_id }` |

---

## Database schema

Auto-migrated at startup by `ensure*` helpers — there's no separate migrations directory.

```
users          (id, username, phone, email[legacy], password_hash, password_salt, role, created_at)
                  unique: lower(username); unique: phone where not null
teams          (id, name, owner_email[= username], user_id, agent_id, tournament_id,
                  tournament_position, created_at)
players        (id, team_id, full_name, valorant_name, valorant_tag, created_at)
                  unique: (valorant_name, valorant_tag)
tournaments    (id, tournament_type[amateur|pro], status, max_teams, current_teams,
                  prize_pool, entry_fee, started_at, completed_at, winner_team_id, created_at)
matches        (id, tournament_id, team1_id, team2_id, winner_id, round, position,
                  match_status, status, is_scheduled, scheduled_time, party_id)
payments       (id, team_id, order_id, tr, amount, currency, status, tournament_type,
                  vpa, valid_until, submitted_utr, submitted_at, screenshot_data_url,
                  verified_at, verified_by, completed_at, rejection_reason)
                  unique: tr (where not null); unique: submitted_utr (where not null)
```

---

## Configuration (Secret + Env)

All sensitive config lives in the `val-backend-secrets` Kubernetes Secret. See `Backend/secret.yaml` for the template.

| Key | Purpose |
|---|---|
| `JWT_SECRET` | Signs JWT tokens. Generate with `openssl rand -base64 64`. |
| `ADMIN_USERNAME` | The single account allowed to register/log in as admin. |
| `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_PORT`, `DB_SSL` | Postgres connection. `DB_SSL=true` when moving to RDS. |
| `UPI_VPA` | The VPA money is collected to. **Public** — appears in every QR. |
| `UPI_NAME` | Receiver name shown in UPI apps. |
| `UPI_QR_VALID_MINUTES` | QR validity window (default 15). |
| `AUTO_VERIFY_PAYMENTS` | `"true"` for trust-then-verify; default `"false"` (manual admin verify). |
| `PAYMENTS_DISABLED` | `"true"` to bypass UPI entirely for testing — team slotted on order creation. |
| `FRONTEND_ORIGIN` | CORS allowlist. Comma-separated origins; no trailing slash. |

---

## Local development

Backend:

```bash
cd Backend
npm install
cp .env.example .env   # fill in JWT_SECRET, DB_*, UPI_VPA at minimum
npm run dev            # NODE_ENV=development node index.js
```

Backend listens on `:3000`. Health probe at `/health`, readiness (with DB check) at `/ready`.

Frontend:

```bash
cd Frontend
python3 -m http.server 4173
# open http://localhost:4173
```

Edit `Frontend/config.js` so `apiBaseUrl` points at your local backend, e.g. `"http://localhost:3000"`.

---

## Deployment

Both images are built locally and pushed to ECR (`219865458704.dkr.ecr.ap-south-1.amazonaws.com/devops-testing`). Manifests are applied with `kubectl`.

```bash
# Backend
docker build -t 219865458704.dkr.ecr.ap-south-1.amazonaws.com/devops-testing:val-v1-<n> Backend/
docker push  219865458704.dkr.ecr.ap-south-1.amazonaws.com/devops-testing:val-v1-<n>
# bump image tag in Backend/deployment.yaml
kubectl -n val apply -f Backend/secret.yaml         # if secrets changed
kubectl     apply -f Backend/deployment.yaml
kubectl -n val rollout status deploy/val-backend

# Frontend
docker build -t 219865458704.dkr.ecr.ap-south-1.amazonaws.com/devops-testing:val-frontend-v<n> Frontend/
docker push  219865458704.dkr.ecr.ap-south-1.amazonaws.com/devops-testing:val-frontend-v<n>
# bump image tag in Frontend/deployment.yaml
kubectl     apply -f Frontend/deployment.yaml
kubectl -n val rollout status deploy/val-frontend
```

DNS in Hostinger (one-time):

```
CNAME  www   <aws-lb-hostname>.elb.ap-south-1.amazonaws.com.
CNAME  api   <aws-lb-hostname>.elb.ap-south-1.amazonaws.com.
```

cert-manager picks up the new ingress hostnames and provisions LE certs automatically. Verify with `kubectl -n val get certificate`.

---

## Operational runbook

### "I got 502 on the frontend"
nginx-ingress sees the upstream return an invalid header. Most likely cause: the `nginx.conf`'s CSP header contains leading whitespace (multi-line string literal). Keep CSP on a single line in `Frontend/nginx.conf`.

### "Login is returning 405 Not Allowed"
Login POST is hitting the frontend nginx instead of the backend. Means the frontend host's ingress doesn't have an `/api → val-backend-svc` rule. Fix: confirm `Frontend/ingress.yaml` has both `/api` and `/` paths.

### "Auto-migration failed with: cannot drop index users_email_key"
The old schema had `email TEXT NOT NULL UNIQUE` which is a UNIQUE constraint, not a plain index. Drop with `ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key;` then retry the request.

### "Player paid but I don't see them in the admin queue"
Check `PAYMENTS_DISABLED` — if true, payments are auto-slotted with no admin step. Otherwise check `AUTO_VERIFY_PAYMENTS` — if true, they're already slotted, look in **All Payments** not **Pending**.

### Clearing test data
```sql
TRUNCATE matches, payments, players, teams, tournaments RESTART IDENTITY CASCADE;
-- users + agents preserved
```

To purge bypass payments specifically (without truncating everything):
```sql
DELETE FROM payments WHERE verified_by = 'bypass';
```

---

## Removing optional features

Several features are wrapped in marker comments so they can be excised without affecting the rest. Grep for the marker, delete every block it surrounds.

| Feature | Grep marker |
|---|---|
| Party ID per match | `// [party_id feature` (Backend/routes/admin.js, Frontend/app.js, Frontend/styles.css) |
| Testing bypass | `// [PAYMENTS_DISABLED` (Backend/routes/payment.js, Frontend/app.js) |

For party_id, after removing the code blocks also run:
```sql
ALTER TABLE matches DROP COLUMN IF EXISTS party_id;
```

---

## What's intentionally NOT here

- **No payment gateway.** Razorpay was removed after the gaming-category rejection. UPI direct is the launch payment method; reintroducing a PG is a future task (Path 1 or Path 2 reframing).
- **No SMS / WhatsApp / email notifications.** The site is the source of truth — players check their dashboard. Party IDs appear 30 min before kickoff.
- **No automated TDS / GST handling.** Tournament prize amounts (₹1,000 / ₹2,000) are below the per-transaction TDS threshold but a TAN + Form 26Q workflow is mandatory at any meaningful annual aggregate. Talk to a CA before scaling.
- **No bot/CAPTCHA.** At hobby scale this is fine; consider Turnstile/reCAPTCHA before opening registration publicly.

---

## License & contact

No formal license set yet. Contact: <support@valotournament.in> (forwarder set up via Hostinger; falls back to `dhruvdk1234@gmail.com`).
