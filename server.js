import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT || 4173);
const API = "https://rewards.api.onre.finance/api/v1";
const PUBLIC = fileURLToPath(new URL("./public", import.meta.url));
const CACHE_MS = 60_000;
const cache = new Map();

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml"
};

async function getJson(path) {
  const cached = cache.get(path);
  if (cached && Date.now() - cached.time < CACHE_MS) return cached.data;
  const response = await fetch(`${API}${path}`, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`OnRe API returned ${response.status}`);
  const data = await response.json();
  cache.set(path, { time: Date.now(), data });
  return data;
}

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === "/api/summary") {
      const [overview, growth] = await Promise.all([
        getJson("/analytics/overview"),
        getJson("/analytics/points/growth")
      ]);
      const walletCount = Number(overview.points.walletCount);
      const percentileBands = await Promise.all([1, 5, 10, 25, 50].map(async (percentile) => {
        const rank = Math.ceil(walletCount * percentile / 100);
        const result = await getJson(`/points/leaderboard?page=${rank - 1}&size=1`);
        return { percentile, rank, thresholdPoints: result.leaderboard.content[0]?.totalPoints ?? null };
      }));
      return json(res, 200, { overview, growth: growth.series, percentileBands });
    }

    if (url.pathname === "/api/leaderboard") {
      const page = Math.max(0, Number.parseInt(url.searchParams.get("page") || "0", 10));
      const allowedSizes = new Set([10, 25, 50, 100]);
      const requestedSize = Number.parseInt(url.searchParams.get("size") || "25", 10);
      const size = allowedSizes.has(requestedSize) ? requestedSize : 25;
      const data = await getJson(`/points/leaderboard?page=${page}&size=${size}`);
      return json(res, 200, data.leaderboard);
    }

    if (url.pathname === "/api/wallet") {
      const address = url.searchParams.get("address")?.trim() || "";
      if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
        return json(res, 400, { error: "Enter a valid Solana wallet address" });
      }
      try {
        return json(res, 200, await getJson(`/points/${address}`));
      } catch (error) {
        if (error.message.includes("404")) return json(res, 404, { error: "Wallet not found on the OnRe leaderboard" });
        throw error;
      }
    }

    const relative = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    const safePath = normalize(relative).replace(/^(\.\.(\/|\\|$))+/, "");
    const file = join(PUBLIC, safePath);
    if (!file.startsWith(PUBLIC)) return json(res, 403, { error: "Forbidden" });
    const content = await readFile(file);
    res.writeHead(200, { "content-type": types[extname(file)] || "application/octet-stream" });
    res.end(content);
  } catch (error) {
    if (error?.code === "ENOENT") return json(res, 404, { error: "Not found" });
    json(res, 502, { error: error.message || "Upstream request failed" });
  }
});

server.listen(PORT, () => console.log(`OnRe dashboard: http://localhost:${PORT}`));
