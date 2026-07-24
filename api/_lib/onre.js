const API = "https://rewards.api.onre.finance/api/v1";

export async function getOnReJson(path) {
  const response = await fetch(`${API}${path}`, {
    headers: { accept: "application/json" }
  });

  if (!response.ok) {
    const error = new Error(`OnRe returned ${response.status}`);
    error.status = response.status;
    throw error;
  }

  return response.json();
}

export function setCache(res, seconds = 300) {
  res.setHeader("Cache-Control", `public, s-maxage=${seconds}, stale-while-revalidate=600`);
}

export function sendError(res, error, fallback) {
  console.error(error);
  const status = [404, 429].includes(error.status) ? error.status : 500;
  const message = status === 404
    ? "Wallet not found on the OnRe leaderboard"
    : status === 429 ? "OnRe rate limit reached" : fallback;
  return res.status(status).json({ error: message });
}
