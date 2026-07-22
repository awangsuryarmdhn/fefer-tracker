# FEFER tracker

Live **FEFER** price + **custom holding wallet** on chain **988**.

- RPC: `https://rpc.stable.xyz`
- Token: `0xeaf7aC0FdF150CDD89340fB762D83848De6A7b83`
- Pair: `0x3dea4be5615974f31624404ef288ba3b36dfeb83` (FEFER / WgUSDT)
- Default wallet: `0x1E1afF9d9E387D69b89839E477e63f24e5Ec12C5`
- Explorer: `https://stablescan.xyz`

Read-only. No private keys. Not financial advice.

## Quick start

```bash
cp .env.example .env
deno task start
# http://localhost:8000
# http://localhost:8000/holding.html?wallet=0x…
```

### API

| Path | |
|---|---|
| `GET /health` | liveness |
| `GET /api/config` | public config for UI |
| `GET /api/price` | live price from pair reserves |
| `GET /api/holding?wallet=0x…` | balances + value |

### Static-only (GitHub Pages)

Serve `public/` — browser hits RPC directly (CORS `*`). Custom wallet via form / `?wallet=` / localStorage.

## Push to GitHub (manual)

```bash
git init
git branch -M main
git add .
git commit -m "feat: FEFER price + holding tracker"
git remote add origin https://github.com/YOUR_USER/fefer-tracker.git
git push -u origin main
```

Do **not** push this zip as the site — push **source files**.

## Deno Deploy via GitHub

1. https://console.deno.com → **New project** → **GitHub** → pick repo  
2. Entrypoint: **`main.ts`** (repo root)  
3. Env vars = keys from `.env.example`  
4. Optional CI: repo secrets `DENO_PROJECT` (+ `DENO_DEPLOY_TOKEN` if not using OIDC) → workflow `.github/workflows/deploy.yml`

Docs: https://docs.deno.com/deploy/manual/ci_github/

Classic Deploy tokens (`ddp_`) are dead — use **console.deno.com**.

## Custom wallet

| | |
|---|---|
| Form | paste `0x…` → Track (saved in localStorage) |
| Query | `holding.html?wallet=0x…` |
| Env default | `DEFAULT_WALLET` |

Explorer links use `EXPLORER_BASE`.
