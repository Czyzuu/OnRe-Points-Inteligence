# OnRe Points Intelligence

A standalone dashboard for the public OnRe rewards data. It shows total issued points, genuine daily issuance observations, cumulative wallet percentile bands with cutoff scores, and a paginated leaderboard. OnRe's June 17, 2026 backfill is separated from the daily chart because it aggregates all earlier points.

The `/valuation.html` subpage provides an editable point-value scenario calculator using live supply, optional forward dilution, and the valuation/allocation framework discussed by DeFiSolar.

## Run

```bash
npm start
```

Open <http://localhost:4173>.

The server proxies and caches the public OnRe Rewards API for one minute. No API key or package installation is required; use Node.js 18 or newer.

## Deploy to Vercel

Import this `OnRe` directory as a Vercel project and keep the framework preset set to **Other**. No build command, environment variables, or output-directory override is required. Vercel serves `public/` and deploys the handlers in `api/` as serverless functions.

The Vercel API responses use CDN caching for five minutes with stale-while-revalidate. Wallet lookups use a shorter one-minute cache.
