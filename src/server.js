import "dotenv/config";
import express from "express";
import { analyzeAlert } from "./claude.js";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
// Shared secret TradingView must include so random internet traffic can't post alerts.
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

// Simple in-memory account context. In a real deployment this comes from your broker.
const accountContext = {
  balance: Number(process.env.ACCOUNT_BALANCE) || 10000,
  risk_pct_per_trade: Number(process.env.RISK_PCT_PER_TRADE) || 1,
  open_positions: [],
};

app.get("/health", (_req, res) => {
  res.json({ status: "ok", model: process.env.CLAUDE_MODEL || "claude-opus-4-8" });
});

app.post("/webhook", async (req, res) => {
  // TradingView alert bodies are user-controlled; authenticate before doing any work.
  if (WEBHOOK_SECRET) {
    const provided = req.get("x-webhook-secret") || req.body?.secret;
    if (provided !== WEBHOOK_SECRET) {
      return res.status(401).json({ error: "invalid or missing webhook secret" });
    }
  }

  const alert = req.body;
  if (!alert || typeof alert !== "object") {
    return res.status(400).json({ error: "expected a JSON alert body" });
  }

  try {
    const decision = await analyzeAlert(alert, accountContext);
    console.log(
      `[decision] ${decision.action} (conf ${decision.confidence}) — ${decision.rationale}`
    );
    // A real system would hand `decision` to an order-execution module here.
    return res.json({ received: true, decision });
  } catch (err) {
    console.error("[error] failed to analyze alert:", err.message);
    return res.status(502).json({ error: "analysis failed", detail: err.message });
  }
});

// Only start listening when run directly (`node src/server.js`), so tests can
// import `app` without binding a port.
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  app.listen(PORT, () => {
    console.log(`claude-vers-tradingview listening on http://localhost:${PORT}`);
    console.log(`  POST /webhook   — TradingView alert endpoint`);
    console.log(`  GET  /health    — health check`);
    if (!WEBHOOK_SECRET) {
      console.warn("  [warn] WEBHOOK_SECRET is unset — the webhook is unauthenticated.");
    }
  });
}

export { app };
