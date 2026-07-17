import { getOnReJson, sendError, setCache } from "./_lib/onre.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const page = Math.max(0, Number.parseInt(req.query.page || "0", 10));
  const requestedSize = Number.parseInt(req.query.size || "25", 10);
  const size = [10, 25, 50, 100].includes(requestedSize) ? requestedSize : 25;

  try {
    const data = await getOnReJson(`/points/leaderboard?page=${page}&size=${size}`);
    setCache(res);
    return res.status(200).json(data.leaderboard);
  } catch (error) {
    return sendError(res, error, "Failed to fetch leaderboard");
  }
}
