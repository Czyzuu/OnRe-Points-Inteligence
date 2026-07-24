import { fetchExponentYtQuote } from "./_lib/exponent.js";
import { sendError, setCache } from "./_lib/onre.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  try {
    const quote = await fetchExponentYtQuote();
    setCache(res, 60);
    return res.status(200).json(quote);
  } catch (error) { return sendError(res, error, "Failed to fetch Exponent YT quote"); }
}
