// ── Technical indicators ────────────────────────────────────────
// Pure functions over arrays of numbers / candle objects.
// A candle is { ts, open, high, low, close, vol }.

export function sma(values, period) {
  if (values.length < period) return null;
  let sum = 0;
  for (let i = values.length - period; i < values.length; i++) sum += values[i];
  return sum / period;
}

// Full EMA series (so strategies can look at previous values for crossovers).
export function emaSeries(values, period) {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const out = [values[0]];
  for (let i = 1; i < values.length; i++) {
    out.push(values[i] * k + out[i - 1] * (1 - k));
  }
  return out;
}

export function ema(values, period) {
  const s = emaSeries(values, period);
  return s.length ? s[s.length - 1] : null;
}

// Wilder's RSI.
export function rsi(closes, period = 14) {
  if (closes.length < period + 1) return 50;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const g = diff > 0 ? diff : 0;
    const l = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

// Session VWAP over the provided candles.
export function vwap(candles) {
  let cumTPV = 0;
  let cumVol = 0;
  for (const c of candles) {
    const tp = (c.high + c.low + c.close) / 3;
    cumTPV += tp * c.vol;
    cumVol += c.vol;
  }
  if (cumVol === 0) return candles[candles.length - 1].close;
  return cumTPV / cumVol;
}

// Average True Range — the backbone of volatility-based stops.
export function atr(candles, period = 14) {
  if (candles.length < period + 1) return null;
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const h = candles[i].high;
    const l = candles[i].low;
    const pc = candles[i - 1].close;
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  // Wilder smoothing.
  let a = 0;
  for (let i = 0; i < period; i++) a += trs[i];
  a /= period;
  for (let i = period; i < trs.length; i++) a = (a * (period - 1) + trs[i]) / period;
  return a;
}

// Bollinger Bands on close.
export function bollinger(closes, period = 20, mult = 2) {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  const mean = slice.reduce((s, v) => s + v, 0) / period;
  const variance = slice.reduce((s, v) => s + (v - mean) ** 2, 0) / period;
  const sd = Math.sqrt(variance);
  return {
    basis: mean,
    upper: mean + mult * sd,
    lower: mean - mult * sd,
    width: (2 * mult * sd) / mean, // relative width — used for squeeze detection
  };
}

// MACD (returns line, signal, histogram).
export function macd(closes, fast = 12, slow = 26, signalP = 9) {
  if (closes.length < slow + signalP) return null;
  const fastE = emaSeries(closes, fast);
  const slowE = emaSeries(closes, slow);
  const macdLine = fastE.map((v, i) => v - slowE[i]);
  const signalLine = emaSeries(macdLine, signalP);
  const line = macdLine[macdLine.length - 1];
  const signal = signalLine[signalLine.length - 1];
  return { line, signal, hist: line - signal };
}

// ADX — trend strength (0-100). > 20-25 == trending.
export function adx(candles, period = 14) {
  if (candles.length < period * 2) return null;
  const plusDM = [];
  const minusDM = [];
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const up = candles[i].high - candles[i - 1].high;
    const down = candles[i - 1].low - candles[i].low;
    plusDM.push(up > down && up > 0 ? up : 0);
    minusDM.push(down > up && down > 0 ? down : 0);
    const h = candles[i].high;
    const l = candles[i].low;
    const pc = candles[i - 1].close;
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  const smooth = (arr) => {
    let s = 0;
    for (let i = 0; i < period; i++) s += arr[i];
    const out = [s];
    for (let i = period; i < arr.length; i++) {
      s = s - s / period + arr[i];
      out.push(s);
    }
    return out;
  };
  const trS = smooth(trs);
  const plusS = smooth(plusDM);
  const minusS = smooth(minusDM);
  const dx = [];
  for (let i = 0; i < trS.length; i++) {
    const plusDI = (100 * plusS[i]) / trS[i];
    const minusDI = (100 * minusS[i]) / trS[i];
    const sum = plusDI + minusDI;
    dx.push(sum === 0 ? 0 : (100 * Math.abs(plusDI - minusDI)) / sum);
  }
  if (dx.length < period) return null;
  let adxVal = 0;
  for (let i = 0; i < period; i++) adxVal += dx[i];
  adxVal /= period;
  for (let i = period; i < dx.length; i++) adxVal = (adxVal * (period - 1) + dx[i]) / period;
  return adxVal;
}
