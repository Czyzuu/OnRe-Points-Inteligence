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
  const status = error.status === 404 ? 404 : 500;
  return res.status(status).json({ error: status === 404 ? "Wallet not found on the OnRe leaderboard" : fallback });
}
