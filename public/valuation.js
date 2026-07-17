const $ = (id) => document.getElementById(id);
const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 2 });
const money = new Intl.NumberFormat("en", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const dateLabel = (date) => new Date(`${date}T00:00:00`).toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" });
let liveSupply = 0;

function pointPrice(value) {
  if (!Number.isFinite(value)) return "—";
  return value >= 0.01 ? money.format(value) : `$${value.toFixed(8)}`;
}

function value(id) { return Math.max(0, Number($(id).value) || 0); }

function calculate() {
  const valuation = value("valuation") * 1_000_000;
  const allocation = value("allocation") / 100;
  const holding = value("holding");
  const days = value("days");
  const dailyRate = value("daily-rate");
  const added = days * dailyRate;
  const supply = liveSupply + added;
  const pool = valuation * allocation;
  const perPoint = supply ? pool / supply : 0;
  $("point-value").textContent = pointPrice(perPoint);
  $("value-per-million").textContent = `${money.format(perPoint * 1_000_000)} per 1M points`;
  $("projected-supply").textContent = compact.format(supply);
  $("dilution-impact").textContent = added ? `${(added / liveSupply * 100).toFixed(1)}% above live supply` : "No future dilution applied";
  $("reward-pool").textContent = money.format(pool);
  $("holding-value").textContent = money.format(perPoint * holding);
  $("added-supply").textContent = compact.format(added);

  const valuations = [200, 400, 600, 1000];
  const allocations = [0.5, 1, 2];
  $("scenario-body").innerHTML = valuations.map((v) => `<tr><td class="points">$${v}M</td>${allocations.map((a) => `<td class="right share">${pointPrice(v * 1_000_000 * (a / 100) / supply)}</td>`).join("")}</tr>`).join("");
}

try {
  const response = await fetch("/api/summary");
  if (!response.ok) throw new Error("Unable to load live OnRe data");
  const { overview, growth } = await response.json();
  liveSupply = Number(overview.points.totalPointsIssued);
  const actualDaily = growth.slice(1).map((d) => Number(d.dailyTotalGrowth));
  const recent = actualDaily.slice(-7);
  $("daily-rate").value = Math.round(recent.reduce((a, b) => a + b, 0) / recent.length);
  $("as-of").textContent = dateLabel(overview.points.asOfDate).toUpperCase();
  $("live-supply").textContent = compact.format(liveSupply);
  $("supply-multiple").textContent = `${(liveSupply / 65_000_000_000).toFixed(2)}× the March estimate`;
  $("thesis-live").textContent = compact.format(liveSupply);
  $("thesis-growth").textContent = `${((liveSupply / 65_000_000_000 - 1) * 100).toFixed(1)}% above the 65B estimate`;
  $("thesis-now").textContent = pointPrice(4_000_000 / liveSupply);
  ["valuation", "allocation", "holding", "days", "daily-rate"].forEach((id) => $(id).addEventListener("input", calculate));
  calculate();
} catch (error) {
  $("error").textContent = error.message;
  $("error").hidden = false;
}
