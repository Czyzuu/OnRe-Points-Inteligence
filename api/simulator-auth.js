import { createHmac, timingSafeEqual } from "node:crypto";

const COOKIE = "onre_simulator_session";
const MAX_AGE = 60 * 60 * 24 * 7;
const sign = (value, password) => createHmac("sha256", password).update(value).digest("hex");

function validSession(req, password) {
  const cookie = String(req.headers.cookie || "").split(";").map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE}=`));
  if (!cookie) return false;
  const [expires, signature] = decodeURIComponent(cookie.slice(COOKIE.length + 1)).split(".");
  if (!expires || !signature || Number(expires) < Date.now()) return false;
  const expected = sign(expires, password);
  return signature.length === expected.length && timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

export default async function handler(req, res) {
  const configuredPassword = process.env.SIMULATOR_PASSWORD;
  if (!configuredPassword) return res.status(503).json({ error: "Simulator access is not configured" });
  if (req.method === "GET") { const authenticated = validSession(req, configuredPassword); return res.status(authenticated ? 200 : 401).json({ authenticated }); }
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  let body = req.body || {};
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  const supplied = String(body.password || "");
  const valid = supplied.length === configuredPassword.length && timingSafeEqual(Buffer.from(supplied), Buffer.from(configuredPassword));
  if (!valid) return res.status(401).json({ error: "Incorrect password" });

  const expires = String(Date.now() + MAX_AGE * 1000);
  const secure = req.headers["x-forwarded-proto"] === "https" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${COOKIE}=${encodeURIComponent(`${expires}.${sign(expires, configuredPassword)}`)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${MAX_AGE}${secure}`);
  return res.status(200).json({ authenticated: true });
}
