# OnRe Points Intelligence

A standalone dashboard for the public OnRe rewards data. It shows total issued points, genuine daily issuance observations, cumulative wallet percentile bands with cutoff scores, and a paginated leaderboard. OnRe's June 17, 2026 backfill is separated from the daily chart because it aggregates all earlier points.

The `/valuation.html` subpage provides an editable point-value scenario calculator using live supply, optional forward dilution, and the valuation/allocation framework discussed by DeFiSolar.

The `/simulator.html` subpage projects an editable strategy against a moving leaderboard. It derives stationary wallet and cohort velocities from daily points-credit changes in timestamped CSV snapshots under `public/data/`. Add future snapshots to `public/data/snapshots.json`; the latest two are used by the current model.

## Run

```bash
npm start
```

Open <http://localhost:4173>.

Run the pure model tests with:

```bash
npm test
```

The simulator preview is protected by a server-validated password and signed HttpOnly session cookie. Configure `SIMULATOR_PASSWORD` in the deployment environment before opening the page; the password is not stored in the repository.

The server proxies and caches the public OnRe Rewards API for one minute. No API key or package installation is required; use Node.js 18 or newer.

## Deploy to Vercel

Import this `OnRe` directory as a Vercel project and keep the framework preset set to **Other**. No build command, environment variables, or output-directory override is required. Vercel serves `public/` and deploys the handlers in `api/` as serverless functions.

The Vercel API responses use CDN caching for five minutes with stale-while-revalidate. Wallet lookups use a shorter one-minute cache.
