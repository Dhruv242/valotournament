# Security & deployment notes

What changed and what you need to do once before pushing the next deploy.

## 1. Rotate every secret that was previously in git

These values were committed (in `deployment.yaml`, `pg.yaml`, `payment.js`,
`auth.js`, and `db.js`). Treat them as compromised and replace them.

| Secret              | Where to rotate                                    |
| ------------------- | -------------------------------------------------- |
| `JWT_SECRET`        | `openssl rand -base64 64`                          |
| `DB_PASSWORD`       | Pick a new strong value; update Postgres user too  |
| `RAZORPAY_KEY_ID`   | Razorpay dashboard → API keys → Regenerate         |
| `RAZORPAY_KEY_SECRET` | Same place as above                              |
| `ADMIN_USERNAME`    | Optional — change if the previous value leaked     |

After generating new values, edit `Backend/secret.yaml` (do **not** commit
the populated version) and apply:

```bash
kubectl -n val apply -f Backend/secret.yaml
kubectl -n val rollout restart deployment/val-backend
```

For the Postgres password specifically: pods running before the rotation
will still hold the old credential cached. After updating the secret, delete
the postgres pod so it restarts and re-reads `POSTGRES_PASSWORD` (existing
data persists in the PVC — only the role's password changes if you `ALTER
USER … PASSWORD …` first).

## 2. Build and push the images

```bash
# Backend
cd Backend
docker build -t 219865458704.dkr.ecr.ap-south-1.amazonaws.com/devops-testing:val-backend-vN .
docker push  219865458704.dkr.ecr.ap-south-1.amazonaws.com/devops-testing:val-backend-vN

# Frontend
cd ../Frontend
docker build -t 219865458704.dkr.ecr.ap-south-1.amazonaws.com/devops-testing:val-frontend-vN .
docker push  219865458704.dkr.ecr.ap-south-1.amazonaws.com/devops-testing:val-frontend-vN
```

Update the `image:` field in each `deployment.yaml` to the new tag, then:

```bash
kubectl -n val apply -f Backend/secret.yaml
kubectl -n val apply -f Backend/pg.yaml
kubectl -n val apply -f Backend/pg-svc.yaml
kubectl -n val apply -f Backend/deployment.yaml
kubectl -n val apply -f Backend/service.yaml
kubectl -n val apply -f Frontend/deployment.yaml
kubectl -n val apply -f Frontend/service.yaml
kubectl -n val apply -f Backend/ingress.yaml
kubectl -n val apply -f Backend/networkpolicy.yaml   # last — locks east-west
```

## 3. Install new backend dependencies before building

```bash
cd Backend
npm install helmet express-rate-limit
```

These are listed in `package.json` already, but the lockfile may need a
refresh.

## 4. What changed on the application side

### Backend hardening

- **Helmet** sets sane HTTP security headers (`X-Frame-Options`,
  `X-Content-Type-Options`, etc.).
- **CORS** is now origin-restricted to `FRONTEND_ORIGIN` in production.
  Any other origin gets a 403.
- **Rate limits**: 20 login attempts / 15 min / IP, 200 requests / min / IP
  globally. Trust-proxy is set so the limiter sees the real client IP from
  the ingress.
- **Body size cap**: 32KB per request — stops oversized JSON DoS.
- **JWT middleware** (`middleware/auth.js`) enforces a verified Bearer
  token. Applied to:
  - `POST /teams`, `GET /teams/mine`
  - `POST /players`, `GET /players/:teamId`, `GET /players`
  - `POST /payments/create-order`, `POST /payments/verify-payment`
  - `/admin/*` (was already gated)
- **Ownership checks**: `team_id` in player/payment requests is now matched
  against the token's email — you can't add players to or pay for a team
  that isn't yours.
- **Server-decided amounts**: `POST /payments/create-order` ignores any
  `amount` from the client and looks it up by `tournament_type` server-side
  (amateur=250, pro=500). A client can't pay less by tampering with the
  body.
- **Order-ownership check** in `verify-payment`: the order being verified
  must belong to the team the signed-in user owns.
- **Timing-safe signature compare**: replaced `===` with
  `crypto.timingSafeEqual` for the Razorpay signature.
- **No hardcoded secret fallbacks**: `JWT_SECRET`, `DB_PASSWORD`,
  `RAZORPAY_KEY_*` must come from env. Boot aborts in production if any are
  missing.
- **`/admin/payments`** no longer returns `razorpay_signature`.

### Infrastructure hardening

- **K8s Secret** holds every sensitive env. `deployment.yaml` only
  references `valueFrom: secretKeyRef` — no plaintext in git.
- **`securityContext`** on backend, frontend, and Postgres:
  `runAsNonRoot`, `runAsUser`, `allowPrivilegeEscalation: false`, dropped
  capabilities, RuntimeDefault seccomp. Backend and frontend additionally
  use `readOnlyRootFilesystem` with explicit writable `emptyDir` mounts for
  `/tmp` and nginx caches.
- **`automountServiceAccountToken: false`** so app pods don't expose a
  cluster API token.
- **NetworkPolicy** (`networkpolicy.yaml`):
  - Postgres ingress is allowed only from `app=val-backend` pods on 5432.
  - Default-deny ingress in the namespace.
  - Explicit allow from `ingress-nginx` namespace to backend (3000) and
    frontend (8080).
- **Ingress** now rate-limits at the edge and forces requests through
  `/api/*` to reach the backend. The root path serves the frontend image.

### Frontend hardening

- Served by `nginxinc/nginx-unprivileged` (no root inside the container).
- Strict **Content Security Policy** scoped to:
  - own origin,
  - Razorpay (checkout iframe + scripts),
  - Google Fonts,
  - `media.valorant-api.com` for agent portraits.
- HSTS, X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy
  set as response headers.
- Cached static assets with hash-friendly TTLs.
- `apiBaseUrl` is now `/api` so all backend traffic is same-origin — no
  CORS preflight, simpler CSP.

## 5. Future hardening worth doing

These didn't fit this pass — log them somewhere visible.

- **Move secrets out of plaintext YAML** entirely with
  [sealed-secrets](https://sealed-secrets.netlify.app/) or
  [external-secrets](https://external-secrets.io/) wired to AWS Secrets
  Manager.
- **WAF**: put AWS WAF (or Cloudflare) in front of the ingress for
  managed-rule protection against common payloads.
- **Token in HttpOnly cookie** instead of localStorage. XSS would no longer
  be able to steal the JWT. Requires a CSRF protection mechanism if you go
  cookie-based.
- **Audit log table** for admin actions (start match, set winner,
  payment refunds).
- **Daily encrypted PG backup** to S3 + verified restore procedure.
- **Dependency auditing in CI**: `npm audit --omit=dev` gating builds.
