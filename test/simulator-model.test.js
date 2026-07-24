import test from "node:test";
import assert from "node:assert/strict";
import { buildVelocityModel, parseCsv, quantile, rankAt, simulate, strategyDailyPoints, targetInvestment } from "../public/simulator-model.js";

const header='"rank","wallet_address","total_points","percentile","network_share","top_source","top_source_points","exported_at"\n';
const csv=(rows,time)=>header+rows.map((r)=>`"${r.rank}","${r.wallet}","${r.points}","0","0","Wallet holdings","${r.points}","${time}"`).join('\n');
const earlyTime='2026-07-23T22:49:29.508Z', lateTime='2026-07-24T06:12:39.311Z';
const early=parseCsv(csv([{rank:2,wallet:'B',points:100},{rank:1,wallet:'A',points:200}],earlyTime));
const late=parseCsv(csv([{rank:1,wallet:'A',points:274},{rank:2,wallet:'B',points:100},{rank:3,wallet:'C',points:50}],lateTime));
const model=buildVelocityModel(early,late,0,1);

test('parses and sorts leaderboard rows',()=>assert.deepEqual(early.map(r=>r.walletAddress),['A','B']));
test('matches wallets and identifies new wallets',()=>{assert.equal(model.matched.length,2);assert.equal(model.diagnostics.newWallets,1)});
test('treats consecutive snapshot dates as one daily credit cycle',()=>{assert.ok(model.actualElapsedDays>.30&&model.actualElapsedDays<.32);assert.equal(model.elapsedDays,1);assert.equal(model.matched.find(w=>w.walletAddress==='A').rawDailyVelocity,74)});
test('cleans negative velocities to zero',()=>{const m=buildVelocityModel(parseCsv(csv([{rank:1,wallet:'A',points:200}],earlyTime)),parseCsv(csv([{rank:1,wallet:'A',points:100}],lateTime)),0,1);assert.equal(m.matched[0].cleanDailyVelocity,0)});
test('winsorizes velocities at configured cutoffs',()=>{const m=buildVelocityModel(parseCsv(csv([{rank:1,wallet:'A',points:0},{rank:2,wallet:'B',points:0},{rank:3,wallet:'C',points:0}],earlyTime)),parseCsv(csv([{rank:1,wallet:'A',points:1},{rank:2,wallet:'B',points:2},{rank:3,wallet:'C',points:1000}],lateTime)),.1,.9);assert.equal(m.high,quantile(m.matched.map(w=>w.cleanDailyVelocity),.9));assert.ok(m.matched[2].walletVelocity<m.matched[2].cleanDailyVelocity)});
test('calculates every strategy formula',()=>{const i={investmentUsd:100,onycPrice:2,holdMultiplier:1,supplyMultiplier:3,lpMultiplier:2,qualifyingShare:.5,leverage:2,loopMultiplier:3,ytPerUsd:10,ytMultiplier:4,customDailyPoints:77};assert.equal(strategyDailyPoints('hold',i),50);assert.equal(strategyDailyPoints('supply',i),150);assert.equal(strategyDailyPoints('lp',i),50);assert.equal(strategyDailyPoints('loop',i),300);assert.equal(strategyDailyPoints('yt',i),4000);assert.equal(strategyDailyPoints('custom',i),77)});
test('places existing wallets above the user on exact ties',()=>assert.equal(rankAt(274,0,model,{mode:'wallet',statistic:'median',competitorMultiplier:1}),2));
test('moving and static leaderboard projections differ',()=>{const r=simulate(model,{strategy:'custom',customDailyPoints:1,currentPoints:100,investmentUsd:0,days:30},{mode:'wallet',statistic:'median',competitorMultiplier:1});assert.notEqual(r.trajectory.at(-1).projectedRank,r.trajectory.at(-1).staticRank)});
test('target-rank solver finds minimum monotonic investment',()=>{const inputs={strategy:'supply',supplyMultiplier:3,onycPrice:1,currentPoints:0,investmentUsd:0,days:30};const r=targetInvestment(model,inputs,{mode:'wallet',statistic:'median',competitorMultiplier:1},2,10000);assert.ok(r&&r.rank<=2)});
test('scenario multiplier changes competitor projection',()=>{const inputs={strategy:'custom',customDailyPoints:1,currentPoints:100,investmentUsd:0,days:30};const base=simulate(model,inputs,{mode:'wallet',statistic:'median',competitorMultiplier:1});const conservative=simulate(model,inputs,{mode:'wallet',statistic:'median',competitorMultiplier:1.25});assert.ok(conservative.finalRank>=base.finalRank)});
