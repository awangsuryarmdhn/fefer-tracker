/** FEFER tracker — Deno.serve: static + /api/price + /api/holding */
const RPC = Deno.env.get("RPC_URL") ?? "https://rpc.stable.xyz";
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
const PORT = Number(Deno.env.get("PORT") ?? "8000");
const SUPPLY = 1e9;
const PUBLIC = new URL("./public/", import.meta.url);

// ponytail: in-mem cache; shared store if multi-isolate cold starts hurt
let priceCache: { at: number; data: Awaited<ReturnType<typeof fetchPrice>> } | null = null;
const CACHE_MS = 4000;

async function rpc(method: string, params: unknown[] = []) {
  const r = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!r.ok) throw new Error(`RPC HTTP ${r.status}`);
  const j = await r.json();
  if (j.error) throw new Error(j.error.message ?? "rpc error");
  return j.result as string;
}

function padAddr(a: string) {
  return a.slice(2).toLowerCase().padStart(64, "0");
}

function fromHex(hex: string, dec: number) {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  return Number(BigInt("0x" + (h || "0"))) / 10 ** dec;
}

async function fetchPrice() {
  const [resHex, blockHex] = await Promise.all([
    rpc("eth_call", [{ to: PAIR, data: "0x0902f1ac" }, "latest"]),
    rpc("eth_blockNumber", []),
  ]);
  const body = resHex.startsWith("0x") ? resHex.slice(2) : resHex;
  const r0 = Number(BigInt("0x" + body.slice(0, 64))) / 10 ** QUOTE_DEC;
  const r1 = Number(BigInt("0x" + body.slice(64, 128))) / 10 ** TOKEN_DEC;
  if (!(r0 > 0 && r1 > 0)) throw new Error("bad reserves");
  const price = r0 / r1;
  return {
    ok: true as const,
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

async function getPrice() {
  const now = Date.now();
  if (priceCache && now - priceCache.at < CACHE_MS) return priceCache.data;
  const data = await fetchPrice();
  priceCache = { at: now, data };
  return data;
}

async function getHolding(wallet: string) {
  const w = wallet.toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(w)) throw new Error("invalid wallet");
  const balSel = "0x70a08231" + padAddr(w);
  const [price, feferHex, wguHex, natHex] = await Promise.all([
    getPrice(),
    rpc("eth_call", [{ to: TOKEN, data: balSel }, "latest"]),
    rpc("eth_call", [{ to: QUOTE, data: balSel }, "latest"]),
    rpc("eth_getBalance", [w, "latest"]),
  ]);
  const fefer = fromHex(feferHex, TOKEN_DEC);
  const wgusdt = fromHex(wguHex, QUOTE_DEC);
  const native = fromHex(natHex, 18);
  return {
    ok: true as const,
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

function cors(extra: HeadersInit = {}) {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, OPTIONS",
    "cache-control": "no-store",
    ...extra,
  };
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: cors({ "content-type": "application/json; charset=utf-8" }),
  });
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

async function staticFile(pathname: string) {
  let path = pathname === "/" ? "/index.html" : pathname;
  if (path.includes("..")) return new Response("bad path", { status: 400 });
  const file = new URL("." + path, PUBLIC);
  try {
    const data = await Deno.readFile(file);
    const ext = path.slice(path.lastIndexOf("."));
    return new Response(data, {
      headers: cors({ "content-type": MIME[ext] ?? "application/octet-stream" }),
    });
  } catch {
    return new Response("not found", { status: 404 });
  }
}

// Deploy: platform binds HTTP (omit port). Local: listen PORT.
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
      });
    }
    if (pathname === "/api/config") {
      return json({
        ok: true,
        rpc: RPC,
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
        supply: SUPPLY,
      });
    }
    if (pathname === "/api/price") return json(await getPrice());
    if (pathname === "/api/holding" || pathname.startsWith("/api/holding/")) {
      const fromPath = pathname.replace(/^\/api\/holding\/?/, "");
      const q = url.searchParams.get("wallet") || fromPath || DEFAULT_WALLET;
      return json(await getHolding(q));
    }
    return await staticFile(pathname);
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});

if (!ON_DEPLOY) console.log(`FEFER tracker http://127.0.0.1:${PORT}`);
