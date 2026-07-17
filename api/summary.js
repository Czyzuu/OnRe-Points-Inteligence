import { getOnReJson, sendError, setCache } from "./_lib/onre.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const [overview, growth] = await Promise.all([
      getOnReJson("/analytics/overview"),
      getOnReJson("/analytics/points/growth")
    ]);
    const walletCount = Number(overview.points.walletCount);
    const percentileBands = await Promise.all([1, 5, 10, 25, 50].map(async (percentile) => {
      const rank = Math.ceil(walletCount * percentile / 100);
      const data = await getOnReJson(`/points/leaderboard?page=${rank - 1}&size=1`);
      return { percentile, rank, thresholdPoints: data.leaderboard.content[0]?.totalPoints ?? null };
    }));

    setCache(res);
    return res.status(200).json({ overview, growth: growth.series, percentileBands });
  } catch (error) {
    return sendError(res, error, "Failed to fetch OnRe summary");
  }
}
