import { buildVelocityModel, parseCsv, rankAt, simulate, strategyDailyPoints, targetInvestment, walletVelocity } from "./simulator-model.js";

const $ = (id) => document.getElementById(id);
const fmt = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });
const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 2 });
const money = new Intl.NumberFormat("en", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const strategyNames = { hold: "Hold ONyc", supply: "Supply ONyc", lp: "Provide liquidity", loop: "Leveraged loop", yt: "Exponent YT-ONyc", ratex: "RateX yield trading", vault: "Vault strategy", junior: "Exponent junior tranche", senior: "Exponent senior tranche", custom: "Custom" };
const strategies = Object.keys(strategyNames);
let model; let currentResult; let strategyResults = []; let earlierRows; let laterRows; let winsorSettings = "1:99";

async function unlockSimulator() {
  document.body.classList.add("simulator-locked");
  const gate = $("simulator-gate");
  const authenticated = await fetch("/api/simulator-auth").then((response) => response.ok).catch(() => false);
  if (!authenticated) await new Promise((resolve) => {
    $("gate-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = form.querySelector("button");
      button.disabled = true; $("gate-error").textContent = "";
      try {
        const response = await fetch("/api/simulator-auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: new FormData(form).get("password") }) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Unable to verify password");
        form.reset(); resolve();
      } catch (error) { $("gate-error").textContent = error.message; }
      finally { button.disabled = false; }
    });
  });
  gate.hidden = true; document.body.classList.remove("simulator-locked");
}

await unlockSimulator();

async function loadExponentYtQuote() {
  const status = $("yt-live-status");
  try {
    const response = await fetch("/api/exponent-yt"); const quote = await response.json();
    if (!response.ok) throw new Error(quote.error || "Live quote unavailable");
    const ytPerOnyc = Number(quote.ytPerOnyc ?? quote.ytPerUsd);
    if (!(ytPerOnyc > 0)) throw new Error("Invalid Exponent quote");
    $("simulator-form").elements.ytPerOnyc.value = ytPerOnyc.toFixed(4);
    status.textContent = `LIVE EXPONENT · ${ytPerOnyc.toFixed(2)} YT / ONYC`;
    status.title = `${quote.source.replaceAll("_", " ")} · ${new Date(quote.asOf).toLocaleString()}`;
  } catch { status.textContent = "LIVE QUOTE UNAVAILABLE · USING EDITABLE FALLBACK"; status.classList.add("quote-fallback"); }
}

const formValues = () => {
  const data = Object.fromEntries(new FormData($("simulator-form")));
  for (const key of Object.keys(data)) if (!['strategy','mode','statistic'].includes(key)) data[key] = Number(data[key]);
  data.qualifyingShare /= 100; return data;
};
const optionsFrom = (input) => ({ mode: input.mode, statistic: input.statistic, competitorMultiplier: input.competitorMultiplier });
const escapeCsv = (value) => `"${String(value ?? "").replaceAll('"','""')}"`;

function svgChart(series, { invert = false, formatter = compact.format, fill = false } = {}) {
  const width = 620, height = 250, left = 58, right = 15, top = 15, bottom = 30;
  const all = series.flatMap((line) => line.values.map((point) => point.y));
  let min = Math.min(...all), max = Math.max(...all); if (min === max) max = min + 1;
  const maxX = Math.max(...series.flatMap((line) => line.values.map((point) => point.x)), 1);
  const x = (value) => left + value / maxX * (width - left - right);
  const y = (value) => top + ((invert ? value - min : max - value) / (max - min)) * (height - top - bottom);
  const path = (values) => values.map((point, i) => `${i ? "L" : "M"}${x(point.x).toFixed(1)},${y(point.y).toFixed(1)}`).join(" ");
  const grid = [0, .25, .5, .75, 1].map((ratio) => { const value = min + (max - min) * (invert ? ratio : 1 - ratio); const yy = top + ratio * (height-top-bottom); return `<line class="chart-grid" x1="${left}" x2="${width-right}" y1="${yy}" y2="${yy}"/><text class="chart-label" x="${left-7}" y="${yy+3}" text-anchor="end">${formatter(value)}</text>`; }).join("");
  const lineClass = (line, index) => line.className || (index ? "chart-static" : fill ? "chart-fill" : "chart-user");
  const lines = series.map((line, index) => `<path class="${lineClass(line,index)}" d="${path(line.values)}"/>`).join("");
  const legend = series.map((line, i) => `<line class="chart-legend ${lineClass(line,i)}" x1="${left+i*175}" x2="${left+16+i*175}" y1="${height-7}" y2="${height-7}"/><text class="chart-label" x="${left+22+i*175}" y="${height-4}">${line.label}</text>`).join("");
  return `<svg viewBox="0 0 ${width} ${height}" role="img"><g>${grid}${lines}${legend}</g></svg>`;
}

function renderSummary(input, result, options) {
  const cards = [
    ["PROJECTED RANK", `#${fmt.format(result.finalRank)}`, `From #${fmt.format(result.startRank)}`],
    ["POSITIONS GAINED", fmt.format(result.positionsGained), `After ${input.days} days`],
    ["FINAL POINTS", fmt.format(result.finalPoints), `${fmt.format(input.currentPoints)} starting points`],
    ["POINTS PER DAY", fmt.format(result.dailyPoints), strategyNames[input.strategy]]
  ];
  $("summary-cards").innerHTML = cards.map(([label,value,note]) => `<article><span>${label}</span><strong title="${value}">${value}</strong><small>${note}</small></article>`).join("");
}

function renderCharts(input, result, options) {
  $("rank-chart").innerHTML = svgChart([
    { label: "Moving leaderboard", values: result.trajectory.map((r) => ({ x:r.day,y:r.projectedRank })) },
    { label: "Static comparison", values: result.trajectory.map((r) => ({ x:r.day,y:r.staticRank })) }
  ], { invert:true, formatter:(v)=>`#${compact.format(v)}` });
  const thresholdValues = result.trajectory.map((r) => {
    const wallet = model.wallets[Math.min(model.wallets.length - 1, Math.max(0, r.projectedRank - 1))];
    return { x:r.day, y:wallet.currentPoints + walletVelocity(wallet, options.mode, options.statistic, model) * options.competitorMultiplier * r.day };
  });
  $("points-chart").innerHTML = svgChart([{ label:"User points", values:result.trajectory.map((r)=>({x:r.day,y:r.userPoints})) },{ label:"Rank threshold", values:thresholdValues }]);
}

function renderStrategies(input, options) {
  strategyResults = strategies.map((strategy) => ({ strategy, result:simulate(model,{...input,strategy},options) }));
  const best = Math.min(...strategyResults.map((row)=>row.result.finalRank));
  $("strategy-table").innerHTML = strategyResults.map(({strategy,result}) => {
    const cost = result.positionsGained ? input.investmentUsd/result.positionsGained : Infinity;
    return `<tr class="${result.finalRank===best?'best-strategy':''}"><td>${strategyNames[strategy]}</td><td class="right">${fmt.format(result.dailyPoints)}</td><td class="right">${fmt.format(result.finalPoints)}</td><td class="right">#${fmt.format(result.finalRank)}</td><td class="right">${fmt.format(result.positionsGained)}</td><td class="right">${input.investmentUsd?compact.format(result.dailyPoints/input.investmentUsd):'—'}</td><td class="right">${Number.isFinite(cost)?money.format(cost):'—'}</td></tr>`;
  }).join("");
}

function renderDiagnostics(input) {
  const d=model.diagnostics; const items=[["EARLIER SNAPSHOT",model.earlierAt],["LATEST SNAPSHOT",model.laterAt],["ACTUAL TIMESTAMP GAP",`${(model.actualElapsedDays*24).toFixed(2)} hours`],["MODELED ACCRUAL PERIOD",`${model.elapsedDays} day`],["EARLIER WALLETS",d.earlier],["LATEST WALLETS",d.later],["MATCHED",d.matched],["NEW WALLETS",d.newWallets],["MISSING",d.missing],["POSITIVE DELTA",d.positive],["ZERO DELTA",d.zero],["NEGATIVE DELTA",d.negative],["RAW MEDIAN / DAY",compact.format(d.rawMedian)],["WINSORIZED MEDIAN",compact.format(d.winsorMedian)],["P1 CUTOFF",compact.format(model.low)],["P99 CUTOFF",compact.format(model.high)]];
  $("diagnostics-content").innerHTML=`<div class="diagnostic-grid">${items.map(([k,v])=>`<div><span>${k}</span><b>${v}</b></div>`).join('')}</div><p class="note">Selected method: ${input.mode} · ${input.statistic} · competitor velocity × ${input.competitorMultiplier}. Negative deltas are retained diagnostically and cleaned to zero for projection.</p>`;
  $("cohort-table").innerHTML=model.cohortStats.map((c)=>`<tr><td>${c.label}</td><td class="right">${fmt.format(c.count)}</td><td class="right">${fmt.format(c.active)}</td><td class="right">${fmt.format(c.median)}</td><td class="right">${fmt.format(c.mean)}</td><td class="right">${fmt.format(c.p25)}</td><td class="right">${fmt.format(c.p75)}</td><td class="right">${fmt.format(c.p90)}</td></tr>`).join('');
}

function update() {
  if (!model) return; const input=formValues();
  const nextWinsor = `${input.winsorLow}:${input.winsorHigh}`;
  if (nextWinsor !== winsorSettings) { const earlierAt=model.earlierAt,laterAt=model.laterAt;model=buildVelocityModel(earlierRows,laterRows,input.winsorLow/100,input.winsorHigh/100);model.earlierAt=earlierAt;model.laterAt=laterAt;winsorSettings=nextWinsor; }
  if (document.activeElement?.name !== "competitorMultiplier") $("simulator-form").elements.competitorMultiplier.value=input.scenario;
  input.competitorMultiplier=Number($("simulator-form").elements.competitorMultiplier.value);
  const options=optionsFrom(input); currentResult=simulate(model,input,options);
  const formulas={hold:`USD ÷ ONyc price × ${input.holdMultiplier}× hold boost`,supply:`USD ÷ ONyc price × ${input.supplyMultiplier}× lending boost`,lp:`USD ÷ price × ${input.lpMultiplier}× liquidity boost × qualifying share`,loop:`USD ÷ price × ${input.leverage}× leverage × ${input.loopMultiplier}× looping boost`,yt:`USD ÷ ONyc price × YT per ONyc × ${input.ytMultiplier}× Exponent YT boost`,ratex:`USD ÷ ONyc price × ${input.ratexMultiplier}× RateX boost`,vault:`USD ÷ ONyc price × ${input.vaultMultiplier}× vault boost`,junior:`USD ÷ ONyc price × ${input.juniorMultiplier}× junior tranche boost`,senior:`USD ÷ ONyc price × ${input.seniorMultiplier}× senior tranche boost`,custom:"Custom daily points"};
  $("strategy-formula").textContent=`${formulas[input.strategy]} = ${fmt.format(currentResult.dailyPoints)} / day`;
  renderSummary(input,currentResult,options); renderCharts(input,currentResult,options); renderStrategies(input,options); renderDiagnostics(input);
}

function download(name, headings, rows) { const text=[headings,...rows].map((row)=>row.map(escapeCsv).join(',')).join('\n'); const url=URL.createObjectURL(new Blob(['\uFEFF',text],{type:'text/csv'})); const a=document.createElement('a');a.href=url;a.download=`onre-${name}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000); }

$("target-form").addEventListener("submit",(event)=>{event.preventDefault();const input=formValues();const target=Number(new FormData(event.currentTarget).get('targetRank'));const found=targetInvestment(model,input,optionsFrom(input),target);$("target-result").innerHTML=found?`<b>${money.format(found.investment)}</b><br/>${fmt.format(found.dailyPoints)} points/day<br/>Target threshold: ${fmt.format(found.targetThreshold)} points<br/>Projected rank #${fmt.format(found.rank)}<br/>${fmt.format(found.finalPoints)} final points`:'Target is not reachable below $10,000,000 under these assumptions.';});
let timer; $("simulator-form").addEventListener("input",()=>{clearTimeout(timer);timer=setTimeout(update,80)});
document.querySelectorAll('[data-download]').forEach((button)=>button.addEventListener('click',()=>{const type=button.dataset.download;if(type==='velocities')download(type,['wallet','raw_daily_velocity','clean_daily_velocity','winsorized_velocity'],model.matched.map(w=>[w.walletAddress,w.rawDailyVelocity,w.cleanDailyVelocity,w.walletVelocity]));if(type==='cohorts')download(type,['cohort','count','active','median','mean','p25','p75','p90'],model.cohortStats.map(c=>[c.label,c.count,c.active,c.median,c.mean,c.p25,c.p75,c.p90]));if(type==='trajectory')download(type,['day','user_points','projected_rank','static_rank'],currentResult.trajectory.map(r=>[r.day,r.userPoints,r.projectedRank,r.staticRank]));if(type==='strategies')download(type,['strategy','daily_points','final_points','rank','positions_gained'],strategyResults.map(s=>[strategyNames[s.strategy],s.result.dailyPoints,s.result.finalPoints,s.result.finalRank,s.result.positionsGained]));}));

try {
  await loadExponentYtQuote();
  const manifest=await fetch('/data/snapshots.json').then(r=>r.json()); const snapshots=await Promise.all(manifest.map(async(item)=>({item,rows:parseCsv(await fetch(item.path).then(r=>r.text()))})));
  snapshots.sort((a,b)=>new Date(a.rows[0].exportedAt)-new Date(b.rows[0].exportedAt)); earlierRows=snapshots.at(-2).rows;laterRows=snapshots.at(-1).rows;
  model=buildVelocityModel(earlierRows,laterRows);model.earlierAt=earlierRows[0].exportedAt;model.laterAt=laterRows[0].exportedAt;
  $("model-status").textContent=`${fmt.format(laterRows.length)} WALLETS`;update();
} catch(error){$("error").textContent=`Unable to load simulator: ${error.message}`;$("error").hidden=false;$("model-status").textContent='ERROR';}
