# claude-vers-tradingview

A small bridge that receives **TradingView webhook alerts** and uses **Claude** to
turn each one into a structured, risk-checked trading decision.

```
TradingView alert ──▶ POST /webhook ──▶ Claude (Opus 4.8) ──▶ { action, size, stop, ... }
```

Claude reads the raw alert payload plus your account context and returns a schema-valid
JSON decision (`buy` / `sell` / `hold` / `close`) with a suggested size, stop-loss,
take-profit, and a short rationale. Structured outputs guarantee the response is always
parseable, so your execution layer never has to scrape prose.

> ⚠️ **Educational scaffold, not financial advice.** It does not place real orders — the
> decision is logged and returned so you can wire it into your own broker integration.
> Test on paper before risking capital.

## Setup

```bash
npm install
cp .env.example .env      # then fill in ANTHROPIC_API_KEY and WEBHOOK_SECRET
npm start                 # or: npm run dev  (auto-reload)
```

Requires Node.js 20+.

## Endpoints

| Method | Path       | Purpose                                    |
| ------ | ---------- | ------------------------------------------ |
| `POST` | `/webhook` | Receive a TradingView alert, return a decision |
| `GET`  | `/health`  | Liveness / model check                     |

### Pointing TradingView at it

In a TradingView alert, set the **Webhook URL** to `https://your-host/webhook` and put
your alert data in the message body as JSON, e.g.:

```json
{
  "secret": "your-webhook-secret",
  "ticker": "BTCUSD",
  "signal": "ema_cross_up",
  "price": 64250,
  "timeframe": "1h"
}
```

The `secret` (or an `x-webhook-secret` header) must match `WEBHOOK_SECRET` from your
`.env`, or the request is rejected with `401`.

### Example response

```json
{
  "received": true,
  "decision": {
    "action": "buy",
    "confidence": 0.62,
    "size_pct": 25,
    "stop_loss": "63400",
    "take_profit": "66000",
    "rationale": "EMA cross-up on the 1h with room to the prior swing high; sized modestly given a single-indicator signal."
  }
}
```

## Configuration

All via environment variables (see `.env.example`):

| Variable              | Default            | Description                                  |
| --------------------- | ------------------ | -------------------------------------------- |
| `ANTHROPIC_API_KEY`   | —                  | Your Anthropic API key (required)            |
| `CLAUDE_MODEL`        | `claude-opus-4-8`  | Model to use                                 |
| `WEBHOOK_SECRET`      | —                  | Shared secret TradingView must send          |
| `PORT`                | `3000`             | HTTP port                                    |
| `ACCOUNT_BALANCE`     | `10000`            | Account size passed to Claude for sizing     |
| `RISK_PCT_PER_TRADE`  | `1`                | Max risk per trade (%)                        |

## Tests

```bash
npm test
```

Covers the `/health` and `/webhook` request wiring (no API calls).

## Project layout

```
src/
  server.js   Express app: routes, auth, wiring
  claude.js   Anthropic SDK call + decision JSON schema
test/
  server.test.js
```
