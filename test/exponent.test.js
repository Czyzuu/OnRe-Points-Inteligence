import test from "node:test";
import assert from "node:assert/strict";
import { fetchExponentYtQuote } from "../api/_lib/exponent.js";

const vault = { address:"vault",end_timestamp:"2026-09-10T09:58:19Z",sy_token:"sy",sy_exchange_rate:1,yt_price:.02,
  orderbooks:[{address:"book"}],clmm_markets:[{address:"clmm"}],markets:[{address:"legacy"}] };
const token = { mint:"sy",underlying_asset:{ticker:"ONyc"} };
const response = (data, ok = true, status = 200) => ({ ok, status, json:async()=>data });

test("uses Exponent executable quote for live YT per ONyc", async () => {
  const calls=[]; const fetchMock=async(url,options)=>{calls.push({url,options});if(url.includes("/vaults"))return response([vault]);if(url.includes("/sy-tokens"))return response([token]);return response({success:true,data:{totalOutAmount:58_000_000_000}})};
  const quote=await fetchExponentYtQuote(fetchMock);assert.equal(quote.ytPerOnyc,58);assert.equal(quote.source,"executable_quote");assert.equal(calls[2].options.method,"POST");
});

test("falls back to indicative YT price when routing is unavailable", async () => {
  const fetchMock=async(url)=>{if(url.includes("/vaults"))return response([vault]);if(url.includes("/sy-tokens"))return response([token]);return response({},false,503)};
  const quote=await fetchExponentYtQuote(fetchMock);assert.equal(quote.ytPerOnyc,50);assert.equal(quote.source,"indicative");
});
