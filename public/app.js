(() => {
  // Thin client — all chain math on Deno RPC engine (/api/snapshot)
  const FALLBACK = {
    pair: "0x3dea4be5615974f31624404ef288ba3b36dfeb83",
    token: "0xeaf7aC0FdF150CDD89340fB762D83848De6A7b83",
    defaultWallet: "0x1E1afF9d9E387D69b89839E477e63f24e5Ec12C5",
    explorerBase: "https://stablescan.xyz",
    bridgeUrl:
      "https://stargate.finance/?srcChain=plasma&srcToken=0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb&dstChain=stable&dstToken=0x779Ded0c9e1022225f8E0630b35a9b54bE713736",
    dyorUrl:
      "https://dyorswap.org/launchinfo/?id=0xeaf7aC0FdF150CDD89340fB762D83848De6A7b83&chainId=988",
    tradeBotUrl:
      "https://t.me/based_eth_bot?start=r_Leviathanzx_b_0xeaf7ac0fdf150cdd89340fb762d83848de6a7b83",
    chainId: 988,
    pollMs: 5000,
    chartBase: "https://basedbot.app/embed/token/stable/",
  };
  const LS_ACTIVE = "fefer.active";
  const LS_BOOK = "fefer.bookmarks";
  const MAX_BOOK = 10;
  let lastPrice = null;
  let basePrice = null;
  let flashTimer = 0;
  let chartReady = false;
  let chartSrc = "";
  let pollMs = FALLBACK.pollMs;
  let timer = 0;
  let inflight = null;
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
      if (j.ok) return { ...FALLBACK, ...j };
    } catch {}
    return { ...FALLBACK, mode: "offline" };
  }

  /** 1 HTTP → price + bag (server RPC engine) */
  async function fetchSnapshot(w) {
    const r = await fetch("/api/snapshot?wallet=" + encodeURIComponent(w), { cache: "no-store" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || "snapshot");
    return j;
  }

  function setStatus(ok, msg) {
    const el = $("st");
    if (!el) return;
    let cls = "pill ";
    if (ok === true) cls += "ok";
    else if (ok === false) cls += "err";
    else cls += "loading";
    el.className = cls;
    const txt = el.querySelector(".pill-txt");
    if (txt) {
      txt.textContent = msg;
    } else {
      el.innerHTML = '<i class="dot" aria-hidden="true"></i><span class="pill-txt">' + msg + "</span>";
      el.className = cls;
    }
    if (!el.querySelector(".dot")) {
      el.innerHTML = '<i class="dot" aria-hidden="true"></i><span class="pill-txt">' + msg + "</span>";
      el.className = cls;
    }
  }

  async function copyText(text, el) {
    if (!text || text === "—") return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } catch {}
      ta.remove();
    }
    if (!el) return;
    el.classList.add("copied");
    const prev = el.textContent;
    if (el.id === "copy") el.textContent = "Copied";
    clearTimeout(el._t);
    el._t = setTimeout(() => {
      el.classList.remove("copied");
      if (el.id === "copy") el.textContent = "Copy";
      else if (el.id === "addr" || el.id === "pairCode") el.textContent = prev;
    }, 1200);
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
    const tg = cfg.tradeBotUrl || FALLBACK.tradeBotUrl;
    const el = $("tgTrade");
    if (el) el.href = tg;
    $("pairCode").textContent = "pool " + pair;
    $("chain").textContent = String(cfg.chainId || 988);
    $("mode").textContent = "server";
    const holders = $("stripHolders");
    if (holders) holders.href = base + "/token/" + token + "#holders";
  }

  function chartUrl(addr) {
    const base = (cfg && cfg.chartBase) || FALLBACK.chartBase;
    const token = ((cfg && cfg.token) || FALLBACK.token).toLowerCase();
    const w = valid(addr)
      ? addr.toLowerCase()
      : ((cfg && cfg.defaultWallet) || FALLBACK.defaultWallet).toLowerCase();
    return base + token + "?interval=5&wallets=" + encodeURIComponent(w);
  }

  function syncChart(force) {
    const frame = $("feferChart");
    const open = $("chartOpen");
    if (!frame) return;
    const src = chartUrl(wallet);
    if (open) open.href = src;
    if (!chartReady) return;
    if (!force && chartSrc === src) return;
    chartSrc = src;
    const shell = $("chartShell");
    if (shell) shell.classList.remove("ready");
    frame.onload = () => {
      if (shell) shell.classList.add("ready");
    };
    if (!frame.dataset.warmed) {
      frame.dataset.warmed = "1";
      try {
        const l = document.createElement("link");
        l.rel = "preconnect";
        l.href = "https://basedbot.app";
        l.crossOrigin = "";
        if (!document.querySelector('link[href="https://basedbot.app"]')) {
          document.head.appendChild(l);
        }
      } catch {}
    }
    frame.src = src;
  }

  function armChartLazy() {
    const frame = $("feferChart");
    const shell = $("chartShell");
    if (!frame || chartReady) return;
    const boot = () => {
      if (chartReady) return;
      chartReady = true;
      syncChart(true);
    };
    if ("IntersectionObserver" in window) {
      const io = new IntersectionObserver(
        (ents) => {
          if (ents.some((e) => e.isIntersecting)) {
            io.disconnect();
            boot();
          }
        },
        { rootMargin: "220px 0px" },
      );
      io.observe(shell || frame);
    } else if ("requestIdleCallback" in window) {
      requestIdleCallback(boot, { timeout: 2000 });
    } else {
      setTimeout(boot, 900);
    }
    setTimeout(() => {
      if (shell && chartReady && !shell.classList.contains("ready")) {
        shell.classList.add("ready");
      }
    }, 8000);
  }

  function bindWalletUI() {
    const base = (cfg.explorerBase || FALLBACK.explorerBase).replace(/\/$/, "");
    $("exWallet").href = base + "/address/" + wallet;
    $("addr").textContent = wallet;
    $("wallet").value = wallet;
    renderChips();
    syncChart(false);
  }

  function renderChips() {
    const el = $("chips");
    el.innerHTML = "";
    if (!books.length) {
      el.innerHTML = '<span class="muted tiny">No saved wallets yet · Check bag then ★</span>';
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
    tick(true).catch(console.error);
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

  function paintDelta(price) {
    const el = $("delta");
    if (!el) return;
    if (basePrice == null || !Number.isFinite(basePrice) || basePrice === 0) {
      el.textContent = "since open · —";
      el.className = "delta flat";
      return;
    }
    const pct = ((price - basePrice) / basePrice) * 100;
    if (!Number.isFinite(pct) || Math.abs(pct) < 1e-9) {
      el.textContent = "since open · 0.00%";
      el.className = "delta flat";
      return;
    }
    const sign = pct > 0 ? "+" : "";
    el.textContent = "since open · " + sign + pct.toFixed(2) + "%";
    el.className = "delta " + (pct > 0.0005 ? "up" : pct < -0.0005 ? "down" : "flat");
  }

  function flashPrice(dir) {
    const el = $("price");
    if (!el) return;
    el.classList.remove("flash-up", "flash-down");
    void el.offsetWidth;
    el.classList.add(dir === "up" ? "flash-up" : "flash-down");
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => el.classList.remove("flash-up", "flash-down"), 700);
  }

  function paintPrice(d) {
    if (basePrice == null && Number.isFinite(d.price)) basePrice = d.price;
    if (lastPrice != null && Number.isFinite(d.price) && d.price !== lastPrice) {
      flashPrice(d.price > lastPrice ? "up" : "down");
    }
    lastPrice = d.price;
    $("price").textContent = fmt(d.price, 8);
    $("inv").textContent = fmt(d.inverse ?? 1 / d.price, 2) + " FEFER per 1 USDT";
    $("r0").textContent = fmt(d.reserveQuote, 2);
    $("r1").textContent = fmt(d.reserveToken, 2);
    $("fdv").textContent = fmt(d.fdv, 2);
    $("liq").textContent = fmt(d.liqApprox, 2);
    const sf = $("stripFdv");
    const sl = $("stripLiq");
    const sr = $("stripR0");
    if (sf) sf.textContent = fmt(d.fdv, 2);
    if (sl) sl.textContent = fmt(d.liqApprox, 2);
    if (sr) sr.textContent = fmt(d.reserveQuote, 2);
    $("block").textContent = "updated · #" + d.block;
    paintDelta(d.price);
  }

  function paintHold(d) {
    $("fefer").textContent = fmt(d.fefer, 4);
    $("value").textContent = fmt(d.value, 4);
    $("pct").textContent = fmt(d.pctSupply, 6) + "% of supply";
    $("wgusdt").textContent = fmt(d.wgusdt, 4);
    $("native").textContent = fmt(d.native, 6);
    $("hBlock").textContent = "#" + d.block;
    if (d.explorer) $("exWallet").href = d.explorer;
    const bar = $("pctBar");
    if (bar) {
      const p = Number(d.pctSupply) || 0;
      const w = Math.min(100, Math.max(p > 0 ? 1.5 : 0, p * 40));
      bar.style.width = w + "%";
    }
  }

  function schedule() {
    clearTimeout(timer);
    if (document.hidden) return;
    timer = setTimeout(() => tick(false).catch(console.error), pollMs);
  }

  async function tick(force) {
    if (inflight && !force) return inflight;
    const run = (async () => {
      try {
        if (!cfg) {
          cfg = await loadConfig();
          books = loadBookmarks();
          wallet = resolveWallet(cfg);
          pollMs = Number(cfg.pollMs) || FALLBACK.pollMs;
          setActive(wallet);
          bindStaticLinks();
          bindWalletUI();
          armChartLazy();
        }
        if (document.hidden && !force) return;
        setStatus(null, "updating…");
        const snap = await fetchSnapshot(wallet);
        paintPrice(snap.price);
        paintHold(snap.holding);
        $("age").textContent = new Date().toLocaleTimeString();
        if (snap.engine && snap.engine.host) {
          $("mode").textContent = "rpc·" + snap.engine.host;
        } else {
          $("mode").textContent = "server";
        }
        setStatus(true, "live");
      } catch (e) {
        setStatus(false, "offline");
        console.error(e);
      } finally {
        inflight = null;
        schedule();
      }
    })();
    inflight = run;
    return run;
  }

  $("form").addEventListener("submit", (e) => {
    e.preventDefault();
    const v = $("wallet").value.trim();
    const err = $("werr");
    if (!valid(v)) {
      err.hidden = false;
      err.textContent = "That doesn’t look like a wallet. Need 0x + 40 characters.";
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
      err.textContent = "That doesn’t look like a wallet. Need 0x + 40 characters.";
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

  $("copy").addEventListener("click", () => copyText(wallet, $("copy")));
  $("addr").addEventListener("click", () => copyText(wallet, $("addr")));
  $("pairCode").addEventListener("click", () => {
    const pair = (cfg && cfg.pair) || FALLBACK.pair;
    copyText(pair, $("pairCode"));
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) tick(false).catch(console.error);
    else clearTimeout(timer);
  });

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    });
  }

  tick(true);
})();