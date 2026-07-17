import { getOnReJson, sendError, setCache } from "./_lib/onre.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const address = String(req.query.address || "").trim();
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
    return res.status(400).json({ error: "Enter a valid Solana wallet address" });
  }

  try {
    const data = await getOnReJson(`/points/${address}`);
    setCache(res, 60);
    return res.status(200).json(data);
  } catch (error) {
    return sendError(res, error, "Failed to fetch wallet points");
  }
}
