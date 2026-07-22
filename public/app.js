(() => {
  const FALLBACK = {
    rpc: "https://rpc.stable.xyz",
    pair: "0x3dea4be5615974f31624404ef288ba3b36dfeb83",
    token: "0xeaf7aC0FdF150CDD89340fB762D83848De6A7b83",
    quote: "0x817997ca8394e26cce3de3a076a4889b27dbf9de",
    defaultWallet: "0x1E1afF9d9E387D69b89839E477e63f24e5Ec12C5",
    explorerBase: "https://stablescan.xyz",
    bridgeUrl:
      "https://stargate.finance/?srcChain=plasma&srcToken=0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb&dstChain=stable&dstToken=0x779Ded0c9e1022225f8E0630b35a9b54bE713736",
    dyorUrl:
      "https://dyorswap.org/launchinfo/?id=0xeaf7aC0FdF150CDD89340fB762D83848De6A7b83&chainId=988",
    chainId: 988,
    supply: 1e9,
  };
  const LS_ACTIVE = "fefer.active";
  const LS_BOOK = "fefer.bookmarks";
  const MAX_BOOK = 10;
  const hist = [];
  const $ = (id) => document.getElementById(id);

  function fmt(n, d = 6) {
    if (n == null || !Number.isFinite(n)) return "—";
    if (Math.abs(n) >= 1e6) return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
    if (Math.abs(n) >= 1) return n.toLocaleString(undefined, { maximumFractionDigits: Math.min(d, 4) });
    return n.toFixed(d);
  }

  function valid(a) {
    return /^0x[a-fA-F0-9]{40}$/.test(a || "");
  }

  function short(a) {
    return a ? a.slice(0, 6) + "…" + a.slice(-4) : "—";
  }

  function loadBookmarks() {
    try {
      const raw = JSON.parse(localStorage.getItem(LS_BOOK) || "[]");
      if (!Array.isArray(raw)) return [];
      return raw
        .filter((x) => x && valid(x.address))
        .map((x) => ({
          address: x.address.toLowerCase(),
          label: String(x.label || "").slice(0, 24),
          addedAt: x.addedAt || Date.now(),
        }))
        .slice(0, MAX_BOOK);
    } catch {
      return [];
    }
  }

  function saveBookmarks(list) {
    try {
      localStorage.setItem(LS_BOOK, JSON.stringify(list.slice(0, MAX_BOOK)));
    } catch {}
  }

  function setActive(addr) {
    try {
      localStorage.setItem(LS_ACTIVE, addr);
    } catch {}
  }

  function resolveWallet(cfg) {
    const q = new URLSearchParams(location.search).get("wallet");
    if (valid(q)) return q.toLowerCase();
    try {
      const s = localStorage.getItem(LS_ACTIVE);
      if (valid(s)) return s.toLowerCase();
    } catch {}
    // migrate old single-key
    try {
      const old = localStorage.getItem("fefer.wallet");
      if (valid(old)) {
        localStorage.removeItem("fefer.wallet");
        return old.toLowerCase();
      }
    } catch {}
    return (cfg.defaultWallet || FALLBACK.defaultWallet).toLowerCase();
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
    const r0 = Number(BigInt("0x" + body.slice(0, 64))) / 1e18;
    const r1 = Number(BigInt("0x" + body.slice(64, 128))) / 1e18;
    const price = r0 / r1;
    return {
      ok: true,
      price,
      inverse: 1 / price,
      reserveQuote: r0,
      reserveToken: r1,
      fdv: (cfg.supply || 1e9) * price,
      liqApprox: 2 * r0,
      block: parseInt(blockHex, 16),
    };
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
    const r0 = Number(BigInt("0x" + body.slice(0, 64))) / 1e18;
    const r1 = Number(BigInt("0x" + body.slice(64, 128))) / 1e18;
    const price = r0 / r1;
    const fefer = Number(BigInt(feferHex)) / 1e18;
    const wgusdt = Number(BigInt(wguHex)) / 1e18;
    const native = Number(BigInt(natHex)) / 1e18;
    const base = (cfg.explorerBase || FALLBACK.explorerBase).replace(/\/$/, "");
    return {
      ok: true,
      wallet,
      fefer,
      wgusdt,
      native,
      price,
      value: fefer * price,
      pctSupply: (fefer / (cfg.supply || 1e9)) * 100,
      block: parseInt(blockHex, 16),
      explorer: base + "/address/" + wallet,
    };
  }

  function draw() {
    const c = $("spark");
    if (!c || hist.length < 2) return;
    const ctx = c.getContext("2d");
    const w = c.width;
    const h = c.height;
    ctx.clearRect(0, 0, w, h);
    const min = Math.min(...hist);
    const max = Math.max(...hist);
    const span = max - min || 1;
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "rgba(244,180,196,.28)");
    g.addColorStop(0.45, "rgba(125,206,160,.22)");
    g.addColorStop(1, "rgba(125,206,160,0)");
    ctx.beginPath();
    hist.forEach((v, i) => {
      const x = (i / (hist.length - 1)) * (w - 4) + 2;
      const y = h - 6 - ((v - min) / span) * (h - 12);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = "#9ad9b6";
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.stroke();
    ctx.lineTo(w - 2, h);
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
  let wallet;
  let books = [];

  function bindStaticLinks() {
    const base = (cfg.explorerBase || FALLBACK.explorerBase).replace(/\/$/, "");
    const pair = cfg.pair || FALLBACK.pair;
    const token = cfg.token || FALLBACK.token;
    $("exPair").href = base + "/address/" + pair;
    $("exToken").href = base + "/token/" + token;
    $("dyor").href = cfg.dyorUrl || FALLBACK.dyorUrl;
    $("bridge").href = cfg.bridgeUrl || FALLBACK.bridgeUrl;
    $("pairCode").textContent = "pair " + pair;
    $("chain").textContent = String(cfg.chainId || 988);
    $("mode").textContent = cfg.mode === "api" ? "Deno API" : "browser RPC";
  }

  function bindWalletUI() {
    const base = (cfg.explorerBase || FALLBACK.explorerBase).replace(/\/$/, "");
    $("exWallet").href = base + "/address/" + wallet;
    $("addr").textContent = wallet;
    $("wallet").value = wallet;
    renderChips();
  }

  function renderChips() {
    const el = $("chips");
    el.innerHTML = "";
    if (!books.length) {
      el.innerHTML = '<span class="muted tiny">No bookmarks yet · Track then ★</span>';
      return;
    }
    books.forEach((b) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip-btn" + (b.address === wallet ? " on" : "");
      chip.title = b.address;
      chip.innerHTML =
        '<span class="chip-lab">' +
        (b.label || short(b.address)) +
        '</span><span class="chip-x" data-x="' +
        b.address +
        '" aria-label="remove">×</span>';
      chip.addEventListener("click", (e) => {
        const x = e.target.closest("[data-x]");
        if (x) {
          e.stopPropagation();
          books = books.filter((i) => i.address !== x.getAttribute("data-x"));
          saveBookmarks(books);
          renderChips();
          return;
        }
        selectWallet(b.address);
      });
      el.appendChild(chip);
    });
  }

  function selectWallet(addr) {
    if (!valid(addr)) return;
    wallet = addr.toLowerCase();
    setActive(wallet);
    const u = new URL(location.href);
    u.searchParams.set("wallet", wallet);
    history.replaceState(null, "", u);
    bindWalletUI();
    tickHold().catch(console.error);
  }

  function addBookmark(addr) {
    if (!valid(addr)) return false;
    const a = addr.toLowerCase();
    if (!books.some((b) => b.address === a)) {
      books.unshift({ address: a, label: "", addedAt: Date.now() });
      books = books.slice(0, MAX_BOOK);
      saveBookmarks(books);
    }
    renderChips();
    return true;
  }

  function paintPrice(d) {
    hist.push(d.price);
    if (hist.length > 90) hist.shift();
    $("price").textContent = fmt(d.price, 8);
    $("inv").textContent = fmt(d.inverse ?? 1 / d.price, 2) + " FEFER / WgUSDT";
    $("r0").textContent = fmt(d.reserveQuote, 2);
    $("r1").textContent = fmt(d.reserveToken, 2);
    $("fdv").textContent = fmt(d.fdv, 2);
    $("liq").textContent = fmt(d.liqApprox, 2);
    $("block").textContent = "block " + d.block;
    draw();
  }

  function paintHold(d) {
    $("fefer").textContent = fmt(d.fefer, 4);
    $("value").textContent = "value " + fmt(d.value, 4) + " WgUSDT";
    $("pct").textContent = fmt(d.pctSupply, 6) + "% supply";
    $("wgusdt").textContent = fmt(d.wgusdt, 4);
    $("native").textContent = fmt(d.native, 6);
    $("hBlock").textContent = String(d.block);
    if (d.explorer) $("exWallet").href = d.explorer;
  }

  async function tickPrice() {
    const d = await fetchPrice(cfg);
    paintPrice(d);
    return d;
  }

  async function tickHold() {
    if (!wallet) return;
    const d = await fetchHolding(cfg, wallet);
    paintHold(d);
    return d;
  }

  async function tick() {
    try {
      if (!cfg) {
        cfg = await loadConfig();
        books = loadBookmarks();
        wallet = resolveWallet(cfg);
        setActive(wallet);
        bindStaticLinks();
        bindWalletUI();
      }
      setStatus(true, "loading");
      await Promise.all([tickPrice(), tickHold()]);
      $("age").textContent = new Date().toLocaleTimeString();
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
    selectWallet(v);
  });

  $("add").addEventListener("click", () => {
    const v = ($("wallet").value.trim() || wallet || "").toLowerCase();
    const err = $("werr");
    if (!valid(v)) {
      err.hidden = false;
      err.textContent = "Address invalid. Format: 0x + 40 hex.";
      return;
    }
    err.hidden = true;
    selectWallet(v);
    addBookmark(v);
  });

  $("reset").addEventListener("click", () => {
    const d = (cfg && cfg.defaultWallet) || FALLBACK.defaultWallet;
    try {
      localStorage.removeItem(LS_ACTIVE);
    } catch {}
    const u = new URL(location.href);
    u.searchParams.delete("wallet");
    history.replaceState(null, "", u);
    selectWallet(d);
  });

  tick();
  setInterval(tick, 5000);
})();