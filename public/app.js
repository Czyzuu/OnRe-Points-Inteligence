const state = { page: 0, size: 25, totalPoints: 0 };
const $ = (id) => document.getElementById(id);
const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 2 });
const integer = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });
const pct = new Intl.NumberFormat("en", { style: "percent", maximumFractionDigits: 3 });
const fmt = (n) => integer.format(Number(n));
const short = (n) => compact.format(Number(n));
const dateLabel = (date) => new Date(`${date}T00:00:00`).toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" });

const sourceNames = {
  wallet: "Wallet holdings", permissionlessBoost: "Permissionless boost",
  onyc: "ONyc", usdg: "USDG", usdc: "USDC", usds: "USDS",
  onycJitosol: "ONyc–JitoSOL", usdgOnyc: "USDG–ONyc", yt: "Yield token",
  lp: "Liquidity position", senior: "Senior tranche", junior: "Junior tranche",
  onycUsdc: "ONyc–USDC", referralBonus: "Referral bonus",
  carrotLending: "Carrot lending", exponentVault: "Exponent vault"
};
const titleCase = (key) => sourceNames[key] || key.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("-", " ").replace(/^./, (letter) => letter.toUpperCase());

function pointSources(breakdown, parents = []) {
  if (!breakdown || typeof breakdown !== "object") return [];
  return Object.entries(breakdown).flatMap(([key, value]) => {
    if (value && typeof value === "object") return pointSources(value, [...parents, titleCase(key)]);
    const points = Number(value);
    return Number.isFinite(points) && points > 0 ? [{ label: [...parents, titleCase(key)].join(" · "), points }] : [];
  }).sort((a, b) => b.points - a.points);
}

function renderPointSources(breakdown, totalPoints) {
  const sources = pointSources(breakdown);
  if (!sources.length) return `<section class="points-sources empty"><h3>POINTS SOURCES</h3><p>No source breakdown is available for this wallet.</p></section>`;
  return `<section class="points-sources"><h3>POINTS SOURCES <span>${sources.length} ACTIVE</span></h3><div class="source-list">${sources.map(({ label, points }) => `<div class="source-row"><span title="${label}">${label}</span><i><b style="width:${Math.max(1, points / totalPoints * 100)}%"></b></i><strong>${fmt(points)}</strong><small>${pct.format(points / totalPoints)}</small></div>`).join("")}</div></section>`;
}

async function request(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error((await response.json()).error || "Unable to load data");
  return response.json();
}

function showError(error) {
  $("error").textContent = error.message;
  $("error").hidden = false;
}

function renderSummary({ overview, growth, percentileBands }) {
  const points = overview.points;
  state.totalPoints = Number(points.totalPointsIssued);
  const first = growth[0];
  const firstIsAggregate = Number(first.dailyTotalGrowth) === Number(first.totalPointsIssued);
  const dailyGrowth = firstIsAggregate ? growth.slice(1) : growth;
  const latest = dailyGrowth[dailyGrowth.length - 1];
  const values = dailyGrowth.map((d) => Number(d.dailyTotalGrowth));
  $("total-points").textContent = fmt(points.totalPointsIssued);
  $("wallet-count").textContent = fmt(points.walletCount);
  $("avg-points").textContent = short(state.totalPoints / points.walletCount);
  $("as-of").textContent = dateLabel(points.asOfDate).toUpperCase();
  $("today-growth").textContent = `${latest.dailyTotalGrowth >= 0 ? "+" : ""}${short(latest.dailyTotalGrowth)}`;
  $("latest-growth").textContent = `${latest.dailyTotalGrowth >= 0 ? "+" : ""}${short(latest.dailyTotalGrowth)}`;
  $("latest-date").textContent = dateLabel(latest.date).toUpperCase();
  $("growth-average").textContent = short(values.reduce((a, b) => a + b, 0) / values.length);
  $("growth-peak").textContent = short(Math.max(...values));
  $("prehistory-total").textContent = firstIsAggregate ? short(first.totalPointsIssued) : "—";
  $("chart-start").textContent = dateLabel(dailyGrowth[0].date).toUpperCase();
  $("chart-end").textContent = dateLabel(latest.date).toUpperCase();

  const max = Math.max(...values.map(Math.abs));
  $("chart").innerHTML = dailyGrowth.map((d) => {
    const value = Number(d.dailyTotalGrowth);
    const height = Math.max(3, Math.abs(value) / max * 100);
    return `<div class="bar ${value < 0 ? "negative" : ""}" style="height:${height}%" data-value="${value >= 0 ? "+" : ""}${short(value)}" aria-label="${d.date}: ${fmt(value)} points"></div>`;
  }).join("");

  $("bands").innerHTML = percentileBands.map((band) => `<article class="band"><span>TOP ${band.percentile}%</span><strong>${fmt(band.rank)}</strong><small>wallets · ranks 1–${fmt(band.rank)}</small><span class="cutoff">CUTOFF POINTS<b>${band.thresholdPoints == null ? "—" : fmt(band.thresholdPoints)}</b></span></article>`).join("");
}

async function loadLeaderboard() {
  const tbody = $("leaderboard-body");
  tbody.innerHTML = `<tr><td colspan="4">Loading leaderboard…</td></tr>`;
  try {
    const data = await request(`/api/leaderboard?page=${state.page}&size=${state.size}`);
    state.page = data.number;
    tbody.innerHTML = data.content.map((row) => `<tr><td class="rank">#${fmt(row.rank)}</td><td><span class="wallet" title="${row.address}">${row.address}</span></td><td class="right points">${fmt(row.totalPoints)}</td><td class="right share">${pct.format(Number(row.totalPoints) / state.totalPoints)}</td></tr>`).join("");
    const first = state.page * state.size + 1;
    const last = first + data.numberOfElements - 1;
    $("page-range").textContent = `${fmt(first)}–${fmt(last)} OF ${fmt(data.totalElements)} WALLETS`;
    $("page-label").textContent = `PAGE ${fmt(state.page + 1)} / ${fmt(data.totalPages)}`;
    $("prev").disabled = data.first;
    $("next").disabled = data.last;
  } catch (error) { showError(error); }
}

$("prev").addEventListener("click", () => { if (state.page > 0) { state.page--; loadLeaderboard(); } });
$("next").addEventListener("click", () => { state.page++; loadLeaderboard(); });
$("page-size").addEventListener("change", (event) => { state.size = Number(event.target.value); state.page = 0; loadLeaderboard(); });

$("wallet-search").addEventListener("submit", async (event) => {
  event.preventDefault();
  const address = $("wallet-input").value.trim();
  const result = $("wallet-result");
  if (!address) return;
  result.hidden = false;
  result.classList.remove("not-found");
  result.innerHTML = `<span class="search-loading">Looking up wallet…</span>`;
  try {
    const wallet = await request(`/api/wallet?address=${encodeURIComponent(address)}`);
    const walletCount = Number($("wallet-count").textContent.replaceAll(",", ""));
    const percentile = walletCount ? wallet.rank / walletCount * 100 : 0;
    result.innerHTML = `<div><span>WALLET</span><b class="wallet" title="${wallet.address}">${wallet.address}</b></div><div><span>RANK</span><strong>#${fmt(wallet.rank)}</strong></div><div><span>PERCENTILE</span><strong>TOP ${percentile < 0.01 ? "<0.01" : percentile.toFixed(2)}%</strong></div><div><span>TOTAL POINTS</span><strong>${fmt(wallet.totalPoints)}</strong></div><div><span>SHARE</span><strong>${pct.format(Number(wallet.totalPoints) / state.totalPoints)}</strong></div>${renderPointSources(wallet.pointsBreakdown, Number(wallet.totalPoints))}<button type="button" id="close-wallet" aria-label="Close wallet result">×</button>`;
    $("close-wallet").addEventListener("click", () => { result.hidden = true; });
  } catch (error) {
    result.classList.add("not-found");
    result.innerHTML = `<span>${error.message}</span>`;
  }
});

try {
  const summary = await request("/api/summary");
  renderSummary(summary);
  await loadLeaderboard();
} catch (error) { showError(error); }
