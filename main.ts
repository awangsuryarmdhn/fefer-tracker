/** FEFER tracker — Deno.serve: RPC engine (batch/failover/cache) + API + static + PWA */
const RPCS = (Deno.env.get("RPC_URLS") ?? Deno.env.get("RPC_URL") ?? "https://rpc.stable.xyz")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const PAIR = (Deno.env.get("PAIR") ?? "0x3dea4be5615974f31624404ef288ba3b36dfeb83").toLowerCase();
const TOKEN = (Deno.env.get("TOKEN") ?? "0xeaf7aC0FdF150CDD89340fB762D83848De6A7b83").toLowerCase();
const QUOTE = (Deno.env.get("QUOTE_TOKEN") ?? "0x817997ca8394e26cce3de3a076a4889b27dbf9de").toLowerCase();
const TOKEN_DEC = Number(Deno.env.get("TOKEN_DECIMALS") ?? "18");
const QUOTE_DEC = Number(Deno.env.get("QUOTE_DECIMALS") ?? "18");
const CHAIN_ID = Number(Deno.env.get("CHAIN_ID") ?? "988");
const DEFAULT_WALLET = Deno.env.get("DEFAULT_WALLET") ?? "0x1E1afF9d9E387D69b89839E477e63f24e5Ec12C5";
const EXPLORER = (Deno.env.get("EXPLORER_BASE") ?? "https://stablescan.xyz").replace(/\/$/, "");
const BRIDGE_URL = Deno.env.get("BRIDGE_URL") ??
  "https://stargate.finance/?srcChain=plasma&srcToken=0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb&dstChain=stable&dstToken=0x779Ded0c9e1022225f8E0630b35a9b54bE713736";
const DYOR_URL = Deno.env.get("DYOR_URL") ??
  `https://dyorswap.org/launchinfo/?id=${TOKEN}&chainId=${CHAIN_ID}`;
const TRADE_BOT_URL = Deno.env.get("TRADE_BOT_URL") ??
  `https://t.me/based_eth_bot?start=r_Leviathanzx_b_${TOKEN}`;
const PORT = Number(Deno.env.get("PORT") ?? "8000");
const SUPPLY = 1e9;
const PUBLIC = new URL("./public/", import.meta.url);
const PRICE_MS = Number(Deno.env.get("PRICE_CACHE_MS") ?? "3500");
const HOLD_MS = Number(Deno.env.get("HOLD_CACHE_MS") ?? "3000");
const RPC_TIMEOUT = Number(Deno.env.get("RPC_TIMEOUT_MS") ?? "8000");

// mem = per-isolate fast path. KV = shared price only (Deploy multi-isolate).
// hold stays mem — per-wallet KV writes burn ops, not worth it.
let priceCache: { at: number; data: PriceData } | null = null;
const holdCache = new Map<string, { at: number; data: HoldData }>();
let rpcCursor = 0;
let lastRpcHost = "";
const USE_KV = (Deno.env.get("USE_KV") ?? "1") !== "0";
const KV_PRICE_KEY = ["fefer", "price", PAIR] as const;
let kv: Deno.Kv | null = null;
let kvTried = false;

async function openKv(): Promise<Deno.Kv | null> {
  if (!USE_KV) return null;
  if (kvTried) return kv;
  kvTried = true;
  try {
    // Deploy: auto when DB assigned. Local: works with openKv() or omit.
    kv = await Deno.openKv();
  } catch {
    kv = null;
  }
  return kv;
}

type PriceData = {
  ok: true;
  price: number;
  inverse: number;
  reserveQuote: number;
  reserveToken: number;
  fdv: number;
  liqApprox: number;
  block: number;
  token: string;
  quote: string;
  pair: string;
  chainId: number;
  ts: number;
};

type HoldData = {
  ok: true;
  wallet: string;
  fefer: number;
  wgusdt: number;
  native: number;
  price: number;
  value: number;
  pctSupply: number;
  block: number;
  explorer: string;
  tokenExplorer: string;
  pairExplorer: string;
};

type RpcCall = { method: string; params?: unknown[] };

function padAddr(a: string) {
  return a.slice(2).toLowerCase().padStart(64, "0");
}

function fromHex(hex: string, dec: number) {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  return Number(BigInt("0x" + (h || "0"))) / 10 ** dec;
}

function isWallet(w: string) {
  return /^0x[0-9a-f]{40}$/.test(w);
}

function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** JSON-RPC batch + multi-RPC rotate/failover + timeout */
async function rpcBatch(calls: RpcCall[]): Promise<string[]> {
  if (!RPCS.length) throw new Error("no RPC_URL");
  const body = calls.map((c, i) => ({
    jsonrpc: "2.0",
    id: i + 1,
    method: c.method,
    params: c.params ?? [],
  }));
  let lastErr: unknown;
  const n = RPCS.length;
  for (let t = 0; t < n; t++) {
    const url = RPCS[(rpcCursor + t) % n];
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), RPC_TIMEOUT);
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: ac.signal,
      });
      if (!r.ok) throw new Error(`RPC HTTP ${r.status}`);
      const j = await r.json();
      const arr = Array.isArray(j) ? j : [j];
      const byId = new Map(
        arr.map((x: { id: number; result?: string; error?: { message?: string } }) => [x.id, x]),
      );
      const out: string[] = [];
      for (let i = 0; i < calls.length; i++) {
        const row = byId.get(i + 1);
        if (!row) throw new Error("rpc missing id");
        if (row.error) throw new Error(row.error.message ?? "rpc error");
        out.push(row.result as string);
      }
      rpcCursor = (rpcCursor + t) % n;
      lastRpcHost = hostOf(url);
      return out;
    } catch (e) {
      lastErr = e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

function parseReserves(resHex: string, blockHex: string): PriceData {
  const body = resHex.startsWith("0x") ? resHex.slice(2) : resHex;
  const r0 = Number(BigInt("0x" + body.slice(0, 64))) / 10 ** QUOTE_DEC;
  const r1 = Number(BigInt("0x" + body.slice(64, 128))) / 10 ** TOKEN_DEC;
  if (!(r0 > 0 && r1 > 0)) throw new Error("bad reserves");
  const price = r0 / r1;
  return {
    ok: true,
    price,
    inverse: 1 / price,
    reserveQuote: r0,
    reserveToken: r1,
    fdv: SUPPLY * price,
    liqApprox: 2 * r0,
    block: parseInt(blockHex, 16),
    token: Deno.env.get("TOKEN_SYMBOL") ?? "FEFER",
    quote: Deno.env.get("QUOTE_SYMBOL") ?? "WgUSDT",
    pair: PAIR,
    chainId: CHAIN_ID,
    ts: Math.floor(Date.now() / 1000),
  };
}

async function fetchPrice(): Promise<PriceData> {
  const [resHex, blockHex] = await rpcBatch([
    { method: "eth_call", params: [{ to: PAIR, data: "0x0902f1ac" }, "latest"] },
    { method: "eth_blockNumber", params: [] },
  ]);
  return parseReserves(resHex, blockHex);
}

async function getPrice() {
  const now = Date.now();
  if (priceCache && now - priceCache.at < PRICE_MS) return priceCache.data;

  // shared across isolates (Deploy) — 1 key only, not per-wallet
  const store = await openKv();
  if (store) {
    try {
      const hit = await store.get<{ at: number; data: PriceData }>([...KV_PRICE_KEY]);
      if (hit.value && now - hit.value.at < PRICE_MS) {
        priceCache = hit.value;
        return hit.value.data;
      }
    } catch {
      /* fall through to RPC */
    }
  }

  const data = await fetchPrice();
  priceCache = { at: now, data };
  if (store) {
    // fire-and-forget; expire slightly after PRICE_MS
    store.set([...KV_PRICE_KEY], priceCache, { expireIn: PRICE_MS + 2000 }).catch(() => {});
  }
  return data;
}

async function fetchHolding(wallet: string): Promise<HoldData> {
  const w = wallet.toLowerCase();
  if (!isWallet(w)) throw new Error("invalid wallet");
  const balSel = "0x70a08231" + padAddr(w);
  const priceHot = !!(priceCache && Date.now() - priceCache.at < PRICE_MS);
  const calls: RpcCall[] = priceHot
    ? [
      { method: "eth_call", params: [{ to: TOKEN, data: balSel }, "latest"] },
      { method: "eth_call", params: [{ to: QUOTE, data: balSel }, "latest"] },
      { method: "eth_getBalance", params: [w, "latest"] },
    ]
    : [
      { method: "eth_call", params: [{ to: PAIR, data: "0x0902f1ac" }, "latest"] },
      { method: "eth_blockNumber", params: [] },
      { method: "eth_call", params: [{ to: TOKEN, data: balSel }, "latest"] },
      { method: "eth_call", params: [{ to: QUOTE, data: balSel }, "latest"] },
      { method: "eth_getBalance", params: [w, "latest"] },
    ];
  const res = await rpcBatch(calls);
  let price: PriceData;
  let feferHex: string;
  let wguHex: string;
  let natHex: string;
  if (priceHot) {
    price = priceCache!.data;
    feferHex = res[0];
    wguHex = res[1];
    natHex = res[2];
  } else {
    price = parseReserves(res[0], res[1]);
    const at = Date.now();
    priceCache = { at, data: price };
    const store = await openKv();
    if (store) {
      store.set([...KV_PRICE_KEY], priceCache, { expireIn: PRICE_MS + 2000 }).catch(() => {});
    }
    feferHex = res[2];
    wguHex = res[3];
    natHex = res[4];
  }
  const fefer = fromHex(feferHex, TOKEN_DEC);
  const wgusdt = fromHex(wguHex, QUOTE_DEC);
  const native = fromHex(natHex, 18);
  return {
    ok: true,
    wallet: w,
    fefer,
    wgusdt,
    native,
    price: price.price,
    value: fefer * price.price,
    pctSupply: (fefer / SUPPLY) * 100,
    block: price.block,
    explorer: `${EXPLORER}/address/${w}`,
    tokenExplorer: `${EXPLORER}/token/${TOKEN}`,
    pairExplorer: `${EXPLORER}/address/${PAIR}`,
  };
}

async function getHolding(wallet: string) {
  const w = wallet.toLowerCase();
  const now = Date.now();
  const hit = holdCache.get(w);
  if (hit && now - hit.at < HOLD_MS) return hit.data;
  const data = await fetchHolding(w);
  holdCache.set(w, { at: now, data });
  if (holdCache.size > 64) {
    const first = holdCache.keys().next().value;
    if (first) holdCache.delete(first);
  }
  return data;
}

/** One payload for UI — client = 1 HTTP */
async function getSnapshot(wallet: string) {
  const hold = await getHolding(wallet);
  const price = priceCache?.data ?? await getPrice();
  return {
    ok: true as const,
    price,
    holding: hold,
    engine: {
      host: lastRpcHost || null,
      rpcs: RPCS.length,
      priceCacheMs: PRICE_MS,
      holdCacheMs: HOLD_MS,
      kv: USE_KV,
    },
  };
}

function cors(extra: HeadersInit = {}) {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "content-type",
    ...extra,
  };
}

function json(data: unknown, status = 200, cache = "no-store") {
  return new Response(JSON.stringify(data), {
    status,
    headers: cors({
      "content-type": "application/json; charset=utf-8",
      "cache-control": cache,
    }),
  });
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
};

function cacheFor(path: string) {
  if (path === "/sw.js") return "no-cache";
  if (path.endsWith(".html") || path === "/" || path === "/index.html") return "no-cache";
  if (/\.(js|css|svg|png|webp|ico|webmanifest)$/.test(path)) {
    return "public, max-age=300, stale-while-revalidate=86400";
  }
  return "no-store";
}

async function staticFile(pathname: string) {
  let path = pathname === "/" ? "/index.html" : pathname;
  if (path.includes("..")) return new Response("bad path", { status: 400 });
  const file = new URL("." + path, PUBLIC);
  try {
    const data = await Deno.readFile(file);
    const ext = path.slice(path.lastIndexOf("."));
    return new Response(data, {
      headers: cors({
        "content-type": MIME[ext] ?? "application/octet-stream",
        "cache-control": cacheFor(path),
      }),
    });
  } catch {
    return new Response("not found", { status: 404 });
  }
}

const ON_DEPLOY = Boolean(Deno.env.get("DENO_DEPLOYMENT_ID"));
Deno.serve(ON_DEPLOY ? {} : { port: PORT }, async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  const url = new URL(req.url);
  const { pathname } = url;
  try {
    if (pathname === "/health") {
      return json({
        ok: true,
        service: "fefer-tracker",
        chainId: CHAIN_ID,
        token: TOKEN,
        pair: PAIR,
        explorer: EXPLORER,
        rpcs: RPCS.length,
        rpcHost: lastRpcHost || null,
        cache: { priceMs: PRICE_MS, holdMs: HOLD_MS, kv: USE_KV },
      });
    }
    if (pathname === "/api/config") {
      // no raw RPC to client — server is engine
      return json({
        ok: true,
        mode: "api",
        chainId: CHAIN_ID,
        pair: PAIR,
        token: TOKEN,
        quote: QUOTE,
        tokenSymbol: Deno.env.get("TOKEN_SYMBOL") ?? "FEFER",
        quoteSymbol: Deno.env.get("QUOTE_SYMBOL") ?? "WgUSDT",
        defaultWallet: DEFAULT_WALLET,
        explorerBase: EXPLORER,
        bridgeUrl: BRIDGE_URL,
        dyorUrl: DYOR_URL,
        tradeBotUrl: TRADE_BOT_URL,
        supply: SUPPLY,
        pollMs: 5000,
        chartBase: "https://basedbot.app/embed/token/stable/",
        engine: "server",
      }, 200, "public, max-age=60");
    }
    if (pathname === "/api/price") {
      return json(
        await getPrice(),
        200,
        `public, max-age=2, stale-while-revalidate=${Math.max(2, Math.floor(PRICE_MS / 1000))}`,
      );
    }
    if (pathname === "/api/snapshot") {
      const q = url.searchParams.get("wallet") || DEFAULT_WALLET;
      return json(
        await getSnapshot(q),
        200,
        `public, max-age=2, stale-while-revalidate=${Math.max(2, Math.floor(HOLD_MS / 1000))}`,
      );
    }
    if (pathname === "/api/holding" || pathname.startsWith("/api/holding/")) {
      const fromPath = pathname.replace(/^\/api\/holding\/?/, "");
      const q = url.searchParams.get("wallet") || fromPath || DEFAULT_WALLET;
      return json(
        await getHolding(q),
        200,
        `public, max-age=2, stale-while-revalidate=${Math.max(2, Math.floor(HOLD_MS / 1000))}`,
      );
    }
    return await staticFile(pathname);
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});

if (!ON_DEPLOY) {
  console.log(`FEFER tracker http://127.0.0.1:${PORT} · RPC×${RPCS.length}`);
}