(() => {
  const FALLBACK = {
    rpc: "https://rpc.stable.xyz",
    pair: "0x3dea4be5615974f31624404ef288ba3b36dfeb83",
    token: "0xeaf7aC0FdF150CDD89340fB762D83848De6A7b83",
    quote: "0x817997ca8394e26cce3de3a076a4889b27dbf9de",
    defaultWallet: "0x1E1afF9d9E387D69b89839E477e63f24e5Ec12C5",
    explorerBase: "https://stablescan.xyz",
    chainId: 988,
    supply: 1e9,
  };
  const LS_KEY = "fefer.wallet";
  const $ = (id) => document.getElementById(id);

  function fmt(n, d = 4) {
    if (n == null || !Number.isFinite(n)) return "—";
    if (Math.abs(n) >= 1e6) return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
    if (Math.abs(n) >= 1) return n.toLocaleString(undefined, { maximumFractionDigits: d });
    return n.toFixed(Math.min(d + 2, 8));
  }

  function valid(a) {
    return /^0x[a-fA-F0-9]{40}$/.test(a || "");
  }

  function currentWallet(cfg) {
    const q = new URLSearchParams(location.search).get("wallet");
    if (valid(q)) return q;
    try {
      const s = localStorage.getItem(LS_KEY);
      if (valid(s)) return s;
    } catch {}
    return cfg.defaultWallet || FALLBACK.defaultWallet;
  }

  async function loadConfig() {
    try {
      const r = await fetch("/api/config", { cache: "no-store" });
      if (!r.ok) throw 0;
      const j = await r.json();
      if (j.ok) return { ...FALLBACK, ...j, mode: "api" };
    } catch {}
    return { ...FALLBACK, mode: "rpc" };
  }

  async function rpc(url, method, params) {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    if (!r.ok) throw new Error("RPC " + r.status);
    const j = await r.json();
    if (j.error) throw new Error(j.error.message || "rpc error");
    return j.result;
  }

  function balData(wallet) {
    return "0x70a08231" + wallet.slice(2).toLowerCase().padStart(64, "0");
  }

  async function fetchHolding(cfg, wallet) {
    if (cfg.mode === "api") {
      const r = await fetch("/api/holding?wallet=" + encodeURIComponent(wallet), { cache: "no-store" });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "api");
      return j;
    }
    const [resHex, blockHex, feferHex, wguHex, natHex] = await Promise.all([
      rpc(cfg.rpc, "eth_call", [{ to: cfg.pair, data: "0x0902f1ac" }, "latest"]),
      rpc(cfg.rpc, "eth_blockNumber", []),
      rpc(cfg.rpc, "eth_call", [{ to: cfg.token, data: balData(wallet) }, "latest"]),
      rpc(cfg.rpc, "eth_call", [{ to: cfg.quote, data: balData(wallet) }, "latest"]),
      rpc(cfg.rpc, "eth_getBalance", [wallet, "latest"]),
    ]);
    const body = resHex.slice(2);
    const r0 = parseInt(body.slice(0, 64), 16) / 1e18;
    const r1 = parseInt(body.slice(64, 128), 16) / 1e18;
    const price = r0 / r1;
    const fefer = parseInt(feferHex, 16) / 1e18;
    const wgusdt = parseInt(wguHex, 16) / 1e18;
    const native = parseInt(natHex, 16) / 1e18;
    const base = (cfg.explorerBase || FALLBACK.explorerBase).replace(/\/$/, "");
    return {
      ok: true, wallet, fefer, wgusdt, native, price,
      value: fefer * price, pctSupply: (fefer / (cfg.supply || 1e9)) * 100,
      block: parseInt(blockHex, 16),
      explorer: base + "/address/" + wallet,
    };
  }

  function setStatus(ok, msg) {
    const el = $("st");
    el.textContent = msg;
    el.className = "pill " + (ok ? "ok" : "err");
  }

  let cfg, wallet;

  function bindExplorer() {
    const base = (cfg.explorerBase || FALLBACK.explorerBase).replace(/\/$/, "");
    $("exWallet").href = base + "/address/" + wallet;
    $("exToken").href = base + "/token/" + (cfg.token || FALLBACK.token);
    $("exPair").href = base + "/address/" + (cfg.pair || FALLBACK.pair);
    $("addr").textContent = wallet;
    $("wallet").value = wallet;
  }

  async function tick() {
    try {
      if (!cfg) {
        cfg = await loadConfig();
        wallet = currentWallet(cfg);
        $("mode").textContent = cfg.mode === "api" ? "Deno API" : "browser RPC";
        $("chain").textContent = String(cfg.chainId || 988);
        bindExplorer();
      }
      setStatus(true, "loading");
      const d = await fetchHolding(cfg, wallet);
      $("fefer").textContent = fmt(d.fefer, 4);
      $("value").textContent = "value " + fmt(d.value, 4) + " WgUSDT";
      $("pct").textContent = fmt(d.pctSupply, 6) + "% supply";
      $("price").textContent = fmt(d.price, 8);
      $("wgusdt").textContent = fmt(d.wgusdt, 4);
      $("native").textContent = fmt(d.native, 6);
      $("block").textContent = String(d.block);
      $("age").textContent = new Date().toLocaleTimeString();
      if (d.explorer) $("exWallet").href = d.explorer;
      setStatus(true, "live");
    } catch (e) {
      setStatus(false, "err");
      console.error(e);
    }
  }

  $("form").addEventListener("submit", (e) => {
    e.preventDefault();
    const v = $("wallet").value.trim();
    const err = $("werr");
    if (!valid(v)) {
      err.hidden = false;
      err.textContent = "Address invalid. Format: 0x + 40 hex.";
      return;
    }
    err.hidden = true;
    wallet = v;
    try { localStorage.setItem(LS_KEY, v); } catch {}
    const u = new URL(location.href);
    u.searchParams.set("wallet", v);
    history.replaceState(null, "", u);
    bindExplorer();
    tick();
  });

  $("reset").addEventListener("click", () => {
    const d = (cfg && cfg.defaultWallet) || FALLBACK.defaultWallet;
    wallet = d;
    try { localStorage.removeItem(LS_KEY); } catch {}
    const u = new URL(location.href);
    u.searchParams.delete("wallet");
    history.replaceState(null, "", u);
    bindExplorer();
    tick();
  });

  tick();
  setInterval(tick, 5000);
})();
