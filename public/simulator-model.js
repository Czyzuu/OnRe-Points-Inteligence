export const COHORTS = [
  [1, 99, "1–99"], [100, 499, "100–499"], [500, 999, "500–999"],
  [1000, 1999, "1,000–1,999"], [2000, 4999, "2,000–4,999"],
  [5000, 9999, "5,000–9,999"], [10000, Infinity, "10,000+"]
];

export function parseCsv(text) {
  const rows = []; let row = []; let cell = ""; let quoted = false;
  text = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"' && quoted && text[i + 1] === '"') { cell += '"'; i++; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { row.push(cell); cell = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); if (row.some(Boolean)) rows.push(row); row = []; cell = "";
    } else cell += char;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const headers = rows.shift();
  return rows.map((values) => Object.fromEntries(headers.map((header, i) => [header, values[i] ?? ""]))).map((row) => ({
    rank: Number(row.rank), walletAddress: row.wallet_address, totalPoints: Number(row.total_points),
    percentile: Number(row.percentile), networkShare: Number(row.network_share), topSource: row.top_source,
    topSourcePoints: row.top_source_points === "" ? null : Number(row.top_source_points), exportedAt: row.exported_at
  })).sort((a, b) => a.rank - b.rank);
}

export const quantile = (values, q) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b); const index = (sorted.length - 1) * q;
  const lower = Math.floor(index); const fraction = index - lower;
  return sorted[lower] + (sorted[lower + 1] === undefined ? 0 : fraction * (sorted[lower + 1] - sorted[lower]));
};
export const mean = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
export const trimmedMean = (values, trim = .1) => {
  const sorted = [...values].sort((a, b) => a - b); const cut = Math.floor(sorted.length * trim);
  return mean(sorted.slice(cut, Math.max(cut + 1, sorted.length - cut)));
};
export const cohortForRank = (rank) => COHORTS.find(([min, max]) => rank >= min && rank <= max) || COHORTS.at(-1);

const creditDay = (row) => {
  const date = new Date(row.exportedAt);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / 86_400_000;
};

export function buildMultiSnapshotVelocityModel(snapshots, winsorLow = .01, winsorHigh = .99) {
  const ordered = [...snapshots].filter((rows) => rows.length).sort((a, b) => new Date(a[0].exportedAt) - new Date(b[0].exportedAt));
  if (ordered.length < 2) throw new Error("At least two leaderboard snapshots are required");
  const earlier = ordered[0]; const later = ordered.at(-1);
  const earlierDate = new Date(earlier[0].exportedAt); const laterDate = new Date(later[0].exportedAt);
  const actualElapsedDays = (laterDate - earlierDate) / 86_400_000;
  const elapsedDays = Math.max(1, creditDay(later[0]) - creditDay(earlier[0]));
  const history = new Map();
  ordered.forEach((rows) => rows.forEach((row) => {
    if (!history.has(row.walletAddress)) history.set(row.walletAddress, []);
    history.get(row.walletAddress).push(row);
  }));
  const laterAddresses = new Set(later.map((row) => row.walletAddress));
  const matched = later.filter((row) => history.get(row.walletAddress).length >= 2).map((current) => {
    const observations = history.get(current.walletAddress); const previous = observations[0]; const slopes = [];
    for (let i = 0; i < observations.length - 1; i++) for (let j = i + 1; j < observations.length; j++) {
      const days = creditDay(observations[j]) - creditDay(observations[i]);
      if (days > 0) slopes.push((observations[j].totalPoints - observations[i].totalPoints) / days);
    }
    const rawPointDelta = current.totalPoints - previous.totalPoints; const rawDailyVelocity = quantile(slopes, .5);
    return { ...current, earlierRank: previous.rank, currentRank: current.rank, earlierPoints: previous.totalPoints,
      currentPoints: current.totalPoints, rawPointDelta, rawDailyVelocity, cleanDailyVelocity: Math.max(0, rawDailyVelocity),
      rankDelta: previous.rank - current.rank, observationCount: observations.length };
  });
  const clean = matched.map((row) => row.cleanDailyVelocity); const low = quantile(clean, winsorLow); const high = quantile(clean, winsorHigh);
  matched.forEach((row) => { row.walletVelocity = Math.min(high, Math.max(low, row.cleanDailyVelocity)); });
  const groups = new Map();
  for (const wallet of matched) {
    const label = cohortForRank(wallet.currentRank)[2];
    for (const key of [`rank:${label}`, `source:${wallet.topSource}`]) {
      if (!groups.has(key)) groups.set(key, []); groups.get(key).push(wallet.walletVelocity);
    }
  }
  const stats = (values) => ({ count: values.length, active: values.filter((v) => v > 0).length, median: quantile(values, .5),
    mean: mean(values), trimmedMean: trimmedMean(values), p25: quantile(values, .25), p75: quantile(values, .75), p90: quantile(values, .9) });
  const groupStats = new Map([...groups].map(([key, values]) => [key, stats(values)]));
  const cohortStats = COHORTS.map(([, , label]) => ({ label, ...(groupStats.get(`rank:${label}`) || stats([])) }));
  const matchedMap = new Map(matched.map((row) => [row.walletAddress, row]));
  const wallets = later.map((row) => {
    const known = matchedMap.get(row.walletAddress); if (known) return known;
    const source = groupStats.get(`source:${row.topSource}`); const cohort = groupStats.get(`rank:${cohortForRank(row.rank)[2]}`);
    return { ...row, currentRank: row.rank, currentPoints: row.totalPoints, rawDailyVelocity: null,
      cleanDailyVelocity: null, walletVelocity: source?.median ?? cohort?.median ?? 0, isNew: true };
  });
  const priorAddresses = new Set(ordered.slice(0, -1).flatMap((rows) => rows.map((row) => row.walletAddress)));
  return { wallets, matched, cohortStats, groupStats, elapsedDays, actualElapsedDays, low, high, snapshotCount: ordered.length,
    velocityMethod: ordered.length > 2 ? "Theil–Sen multi-snapshot trend" : "Two-snapshot daily delta",
    diagnostics: { earlier: earlier.length, later: later.length, matched: matched.length, newWallets: later.length - matched.length,
      missing: [...priorAddresses].filter((address) => !laterAddresses.has(address)).length, positive: matched.filter((w) => w.rawDailyVelocity > 0).length,
      zero: matched.filter((w) => w.rawDailyVelocity === 0).length, negative: matched.filter((w) => w.rawDailyVelocity < 0).length,
      rawMedian: quantile(matched.map((w) => w.rawDailyVelocity), .5), winsorMedian: quantile(matched.map((w) => w.walletVelocity), .5) } };
}

export function buildVelocityModel(earlier, later, winsorLow = .01, winsorHigh = .99) {
  return buildMultiSnapshotVelocityModel([earlier, later], winsorLow, winsorHigh);
}

const singleStrategyDailyPoints = (strategy, investment, input) => {
  const price = Number(input.onycPrice) || 1;
  if (strategy === "hold") return investment / price * input.holdMultiplier;
  if (strategy === "supply") return investment / price * input.supplyMultiplier;
  if (strategy === "lp") return investment / price * input.lpMultiplier * input.qualifyingShare;
  if (strategy === "loop") return investment / price * input.leverage * input.loopMultiplier;
  if (strategy === "yt") return investment / price * input.ytPerOnyc * input.ytMultiplier;
  if (strategy === "ratex") return investment / price * input.ratexMultiplier;
  if (strategy === "vault") return investment / price * input.vaultMultiplier;
  if (strategy === "junior") return investment / price * input.juniorMultiplier;
  if (strategy === "senior") return investment / price * input.seniorMultiplier;
  return Number(input.customDailyPoints) || 0;
};

export const strategyDailyPoints = (strategy, input) => {
  const investment = Number(input.investmentUsd) || 0;
  if (strategy !== "mix") return singleStrategyDailyPoints(strategy, investment, input);
  const allocations = input.mixAllocations || {}; const allocationTotal = Object.values(allocations).reduce((sum, value) => sum + (Number(value) || 0), 0);
  if (!allocationTotal) return 0;
  const scale = investment / allocationTotal;
  return Object.entries(allocations).reduce((sum, [mixedStrategy, amount]) => sum + singleStrategyDailyPoints(mixedStrategy, (Number(amount) || 0) * scale, input), 0);
};

export function walletVelocity(wallet, mode, statistic, model) {
  if (mode === "wallet") return wallet.walletVelocity;
  const source = model.groupStats.get(`source:${wallet.topSource}`);
  const stat = statistic === "trimmed" ? "trimmedMean" : statistic;
  const centers = [50, 300, 750, 1500, 3500, 7500, 15000];
  let upper = centers.findIndex((center) => wallet.currentRank <= center); if (upper < 0) upper = centers.length - 1;
  const lower = Math.max(0, upper - 1); const lowValue = model.cohortStats[lower][stat]; const highValue = model.cohortStats[upper][stat];
  const span = centers[upper] - centers[lower]; const weight = span ? Math.max(0, Math.min(1, (wallet.currentRank - centers[lower]) / span)) : 0;
  const rankEstimate = lowValue + (highValue - lowValue) * weight;
  return source ? (source[stat] + rankEstimate) / 2 : rankEstimate || wallet.walletVelocity;
}

export function rankAt(points, day, model, options, moving = true) {
  let above = 0;
  for (const wallet of model.wallets) {
    const velocity = moving ? walletVelocity(wallet, options.mode, options.statistic, model) * options.competitorMultiplier : 0;
    if (wallet.currentPoints + velocity * day >= points) above++;
  }
  return above + 1;
}

export function pointThresholdAtRank(rank, day, model, options) {
  const points = model.wallets.map((wallet) => wallet.currentPoints + walletVelocity(wallet, options.mode, options.statistic, model) * options.competitorMultiplier * day).sort((a, b) => b - a);
  return points[Math.max(0, Math.min(points.length - 1, rank - 1))];
}

export function simulate(model, inputs, options) {
  const dailyPoints = strategyDailyPoints(inputs.strategy, inputs); const duration = Number(inputs.days);
  const startingPoints = Number(inputs.currentPoints) || 0; const trajectory = [];
  const steps = duration <= 90 ? duration : 90;
  for (let i = 0; i <= steps; i++) {
    const day = duration * i / steps; const userPoints = startingPoints + dailyPoints * day;
    trajectory.push({ day, userPoints, projectedRank: rankAt(userPoints, day, model, options), staticRank: rankAt(userPoints, day, model, options, false) });
  }
  const startRank = rankAt(startingPoints, 0, model, options); const final = trajectory.at(-1);
  return { dailyPoints, startRank, finalRank: final.projectedRank, finalPoints: final.userPoints,
    positionsGained: Math.max(0, startRank - final.projectedRank), percentile: final.projectedRank / model.wallets.length * 100, trajectory };
}

export function targetInvestment(model, inputs, options, targetRank, maximum = 10_000_000) {
  let low = 0; let high = 100;
  const projected = (investment) => simulate(model, { ...inputs, investmentUsd: investment }, options).finalRank;
  while (high < maximum && projected(high) > targetRank) high *= 2;
  if (projected(Math.min(high, maximum)) > targetRank) return null;
  high = Math.min(high, maximum);
  while (high - low > .01) { const mid = (low + high) / 2; if (projected(mid) <= targetRank) high = mid; else low = mid; }
  const result = simulate(model, { ...inputs, investmentUsd: high }, options);
  return { investment: high, dailyPoints: result.dailyPoints, rank: result.finalRank, finalPoints: result.finalPoints,
    targetThreshold: pointThresholdAtRank(targetRank, Number(inputs.days), model, options) };
}
