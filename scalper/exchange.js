// ── Exchange adapter (BitGet spot) ──────────────────────────────
// Public market data needs no auth, so PAPER mode runs on real candles
// with simulated fills. LIVE mode signs requests and places real orders.

import { createHmac } from "crypto";
import https from "https";

function request(method, path, body, keys) {
  return new Promise((resolve, reject) => {
    const ts = Date.now().toString();
    const bodyStr = body ? JSON.stringify(body) : "";
    const headers = { "Content-Type": "application/json", locale: "en-US" };
    if (keys) {
      const sig = createHmac("sha256", keys.secret)
        .update(ts + method + path + bodyStr)
        .digest("base64");
      headers["ACCESS-KEY"] = keys.apiKey;
      headers["ACCESS-SIGN"] = sig;
      headers["ACCESS-TIMESTAMP"] = ts;
      headers["ACCESS-PASSPHRASE"] = keys.passphrase;
    }
    const req = https.request(
      { hostname: "api.bitget.com", path, method, headers },
      (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(d));
          } catch {
            reject(new Error(`Bad response: ${d.slice(0, 200)}`));
          }
        });
      },
    );
    req.on("error", reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

const GRAN = { 1: "1min", 5: "5min", 15: "15min", 60: "1h" };

export class Exchange {
  constructor({ symbol, live, keys, feeRate = 0.001 }) {
    this.symbol = symbol;
    this.live = live;
    this.keys = keys;
    this.feeRate = feeRate;
  }

  async candles(timeframe = 1, limit = 200) {
    const gran = GRAN[timeframe] || "1min";
    const res = await request(
      "GET",
      `/api/v2/spot/market/candles?symbol=${this.symbol}&granularity=${gran}&limit=${limit}`,
    );
    // BitGet returns newest-last already for this endpoint; normalize + sort asc.
    const rows = (res.data || []).map((c) => ({
      ts: parseInt(c[0]),
      open: parseFloat(c[1]),
      high: parseFloat(c[2]),
      low: parseFloat(c[3]),
      close: parseFloat(c[4]),
      vol: parseFloat(c[5]),
    }));
    return rows.sort((a, b) => a.ts - b.ts);
  }

  async price() {
    const res = await request(
      "GET",
      `/api/v2/spot/market/tickers?symbol=${this.symbol}`,
    );
    return parseFloat(res.data?.[0]?.lastPr || 0);
  }

  async liveBalanceUSDT() {
    const res = await request("GET", "/api/v2/spot/account/assets", null, this.keys);
    const usdt = res.data?.find((a) => a.coin === "USDT");
    return parseFloat(usdt?.available || 0);
  }

  // Places a real market order (LIVE only). qty is base-asset units for sells,
  // quote (USDT) amount for buys — matching BitGet's spot market semantics.
  async marketOrder(side, size) {
    const body = {
      symbol: this.symbol,
      side,
      orderType: "market",
      force: "gtc",
      size: String(size),
    };
    return request("POST", "/api/v2/spot/trade/place-order", body, this.keys);
  }
}
