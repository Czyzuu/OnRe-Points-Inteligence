const APP_API = "https://app.exponent.finance/api";
const QUOTE_API = "https://quote.exponent.finance/quote";
const MATURITY_DATE = "2026-09-10";
const CACHE_MS = 60_000;
let cachedQuote;

async function json(fetchImpl, url, options) {
  const response = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Exponent returned ${response.status}`);
  return response.json();
}

export async function fetchExponentYtQuote(fetchImpl = fetch) {
  if (fetchImpl === fetch && cachedQuote && Date.now() - cachedQuote.time < CACHE_MS) return cachedQuote.data;
  const [vaultsRaw, tokensRaw] = await Promise.all([
    json(fetchImpl, `${APP_API}/vaults?is_active=true`), json(fetchImpl, `${APP_API}/sy-tokens`)
  ]);
  const vaults = Array.isArray(vaultsRaw) ? vaultsRaw : vaultsRaw.data || [];
  const tokens = Array.isArray(tokensRaw) ? tokensRaw : tokensRaw.data || [];
  const tokenByMint = new Map(tokens.map((token) => [token.mint, token]));
  const vault = vaults.find((candidate) => {
    const token = tokenByMint.get(candidate.sy_token);
    return token?.underlying_asset?.ticker === "ONyc" && candidate.end_timestamp?.startsWith(MATURITY_DATE);
  });
  if (!vault) throw new Error("Exponent ONyc 10SEP26 market not found");

  let ytPerOnyc; let source = "indicative";
  try {
    const quote = await json(fetchImpl, QUOTE_API, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
      vaultAddress: vault.address, direction: "BASE_TO_YT", inAmount: 1_000_000_000, syExchangeRate: vault.sy_exchange_rate,
      orderbookAddresses: (vault.orderbooks || []).map((market) => market.address), clmmAddress: vault.clmm_markets?.[0]?.address || "",
      legacyMarketAddresses: (vault.markets || []).map((market) => market.address), enableLegacyMarkets: true
    }) });
    if (!quote.success || !Number(quote.data?.totalOutAmount)) throw new Error("No executable quote");
    ytPerOnyc = Number(quote.data.totalOutAmount) / 1_000_000_000; source = "executable_quote";
  } catch {
    if (!(Number(vault.yt_price) > 0)) throw new Error("Exponent YT price unavailable");
    ytPerOnyc = 1 / Number(vault.yt_price);
  }
  const data = { market: "ONyc-10SEP26", ytPerOnyc, ytPriceOnyc: 1 / ytPerOnyc, source, asOf: new Date().toISOString() };
  if (fetchImpl === fetch) cachedQuote = { time: Date.now(), data };
  return data;
}
