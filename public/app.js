(() => {
  const FALLBACK = {
    rpc: "https://rpc.stable.xyz",
    pair: "0x3dea4be5615974f31624404ef288ba3b36dfeb83",
    token: "0xeaf7aC0FdF150CDD89340fB762D83848De6A7b83",
    explorerBase: "https://stablescan.xyz",
    chainId: 988,
    supply: 1e9,
  };
  const hist = [];
  const $ = (id) => document.getElementById(id);

  function fmt(n, d = 6) {
    if (n == null || !Number.isFinite(n)) return "—";
    if (Math.abs(n) >= 1e6) return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
    if (Math.abs(n) >= 1) return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
    return n.toFixed(d);
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

  async function fetchPrice(cfg) {
    if (cfg.mode === "api") {
      const r = await fetch("/api/price", { cache: "no-store" });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "api");
      return j;
    }
    const resHex = await rpc(cfg.rpc, "eth_call", [{ to: cfg.pair, data: "0x0902f1ac" }, "latest"]);
    const blockHex = await rpc(cfg.rpc, "eth_blockNumber", []);
    const body = resHex.slice(2);
    const r0 = parseInt(body.slice(0, 64), 16) / 1e18;
    const r1 = parseInt(body.slice(64, 128), 16) / 1e18;
    const price = r0 / r1;
    return {
      ok: true, price, inverse: 1 / price, reserveQuote: r0, reserveToken: r1,
      fdv: cfg.supply * price, liqApprox: 2 * r0, block: parseInt(blockHex, 16),
    };
  }

  function draw() {
    const c = $("spark");
    if (!c || hist.length < 2) return;
    const ctx = c.getContext("2d");
    const w = c.width, h = c.height;
    ctx.clearRect(0, 0, w, h);
    const min = Math.min(...hist), max = Math.max(...hist);
    const span = max - min || 1;
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "rgba(125,206,160,.35)");
    g.addColorStop(1, "rgba(125,206,160,0)");
    ctx.beginPath();
    hist.forEach((v, i) => {
      const x = (i / (hist.length - 1)) * (w - 4) + 2;
      const y = h - 6 - ((v - min) / span) * (h - 12);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = "#7dcea0";
    ctx.lineWidth = 2;
    ctx.stroke();
    const lastX = w - 2;
    ctx.lineTo(lastX, h);
    ctx.lineTo(2, h);
    ctx.closePath();
    ctx.fillStyle = g;
    ctx.fill();
  }

  function setStatus(ok, msg) {
    const el = $("st");
    el.textContent = msg;
    el.className = "pill " + (ok ? "ok" : "err");
  }

  let cfg;
  async function tick() {
    try {
      if (!cfg) {
        cfg = await loadConfig();
        $("mode").textContent = cfg.mode === "api" ? "Deno API" : "browser RPC";
        $("chain").textContent = String(cfg.chainId || 988);
        const base = (cfg.explorerBase || FALLBACK.explorerBase).replace(/\/$/, "");
        $("exPair").href = base + "/address/" + (cfg.pair || FALLBACK.pair);
        $("exToken").href = base + "/token/" + (cfg.token || FALLBACK.token);
      }
      setStatus(true, "loading");
      const d = await fetchPrice(cfg);
      hist.push(d.price);
      if (hist.length > 90) hist.shift();
      $("price").textContent = fmt(d.price, 8);
      $("inv").textContent = fmt(d.inverse ?? 1 / d.price, 2) + " FEFER / WgUSDT";
      $("r0").textContent = fmt(d.reserveQuote, 2);
      $("r1").textContent = fmt(d.reserveToken, 2);
      $("fdv").textContent = fmt(d.fdv, 2);
      $("liq").textContent = fmt(d.liqApprox, 2);
      $("block").textContent = String(d.block);
      $("age").textContent = new Date().toLocaleTimeString();
      setStatus(true, "live");
      draw();
    } catch (e) {
      setStatus(false, "err");
      console.error(e);
    }
  }

  tick();
  setInterval(tick, 5000);
})();
