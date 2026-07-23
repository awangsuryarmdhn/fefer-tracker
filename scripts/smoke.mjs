import { readFileSync, existsSync } from "node:fs";

const h = readFileSync("public/index.html", "utf8");
const j = readFileSync("public/app.js", "utf8");
const ids = [...j.matchAll(/\$\("([^"]+)"\)/g)].map((m) => m[1]);
const uniq = [...new Set(ids)];
const miss = uniq.filter((id) => !h.includes(`id="${id}"`));
console.log("ids", uniq.length, "miss", miss);

const files = [
  "public/sw.js",
  "public/manifest.webmanifest",
  "public/icon.svg",
  "public/icon-maskable.svg",
  "public/app.js",
  "public/index.html",
  "public/styles.css",
  "main.ts",
];
for (const f of files) console.log(f, existsSync(f) ? "ok" : "MISSING");

console.log("manifest link", h.includes("manifest.webmanifest") ? "ok" : "MISS");
console.log("sw reg", j.includes("serviceWorker") ? "ok" : "MISS");
console.log("snapshot", j.includes("/api/snapshot") ? "ok" : "MISS");
console.log("no eth_ client", !j.includes("eth_") ? "ok" : "BAD");
console.log("no RPC_URL client", !j.includes("RPC_URL") && !j.includes("rpc.stable") ? "ok" : "check");

const main = readFileSync("main.ts", "utf8");
console.log("server snapshot", main.includes("/api/snapshot") ? "ok" : "MISS");
console.log("server batch", main.includes("rpcBatch") ? "ok" : "MISS");
console.log("mime webmanifest", main.includes(".webmanifest") ? "ok" : "MISS");
console.log("mime svg", main.includes(".svg") ? "ok" : "MISS");
console.log("sw no-cache", main.includes('path === "/sw.js"') ? "ok" : "MISS");

if (miss.length) process.exit(1);