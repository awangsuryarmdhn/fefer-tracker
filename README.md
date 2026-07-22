# FEFER terminal

Public **read-only** FEFER tracker — live price + wallet watch on chain **988**.

- No wallet connect · paste any `0x…`
- Bookmarks in browser `localStorage` only (max 10)
- Price from pair reserves (on-chain, not an oracle)
- Links: Stablescan · DYOR · Stargate bridge

| | |
|---|---|
| RPC | `https://rpc.stable.xyz` |
| Token | `0xeaf7aC0FdF150CDD89340fB762D83848De6A7b83` |
| Pair | `0x3dea4be5615974f31624404ef288ba3b36dfeb83` (FEFER / WgUSDT) |
| Explorer | `https://stablescan.xyz` |
| DYOR | [launchinfo](https://dyorswap.org/launchinfo/?id=0xeaf7aC0FdF150CDD89340fB762D83848De6A7b83&chainId=988) |
| Bridge | [Stargate Plasma → Stable](https://stargate.finance/?srcChain=plasma&srcToken=0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb&dstChain=stable&dstToken=0x779Ded0c9e1022225f8E0630b35a9b54bE713736) |

Not financial advice. No private keys. Quote = WgUSDT on-chain (≠ USD oracle).

## Run (Deno)

```bash
cp .env.example .env
deno task start
# http://localhost:8000
# http://localhost:8000/?wallet=0x…
```

```bash
deno task dev   # watch
```

## API

| Path | |
|---|---|
| `GET /health` | liveness |
| `GET /api/config` | public config (explorer, bridge, dyor) |
| `GET /api/price` | live price from reserves (~4s cache) |
| `GET /api/holding?wallet=0x…` | balances + value |

Static fallback: serve `public/` alone — browser hits RPC direct if `/api/*` missing (CORS `*`).

## Client bookmarks

| Key | |
|---|---|
| `fefer.bookmarks` | list `{ address, label?, addedAt }` max 10 |
| `fefer.active` | last watched wallet |
| `?wallet=0x…` | shareable override |

UI: paste → **Track** · **★** save chip · chip **×** remove · **Default** reset.  
No server session. Clear site data → bookmarks gone.

## Deno Deploy

1. [console.deno.com](https://console.deno.com) → **New project** → GitHub → this repo  
2. Entrypoint: **`main.ts`** (repo root)  
3. Env = keys from `.env.example` (optional; defaults work)  
4. Or CLI: `deno task deploy` with `DENO_PROJECT` set  

Docs: https://docs.deno.com/deploy/manual/

## Stack

- Backend: `Deno.serve` only (no framework)
- Frontend: vanilla HTML/CSS/JS
- Data: public RPC + outbound links (no scrape)
- `holding.html` redirects → `/?wallet=`

```
main.ts          Deno.serve + API
public/
  index.html     terminal (price + watch)
  app.js
  styles.css
  holding.html   redirect