/**
 * Technical indicator library.
 * مكتبة المؤشرات الفنية — implementations that follow the canonical definitions.
 *
 * Design rules:
 *  - Every function returns an array aligned 1:1 with the input series.
 *  - Warm-up positions are NaN (never 0), so callers cannot accidentally treat
 *    "not enough data" as a real value.
 *  - Values at index i depend only on inputs at index <= i (no look-ahead bias),
 *    which makes the same code safe for live trading AND backtesting.
 */

export type Series = number[];

export const isNum = (v: number): boolean => Number.isFinite(v);

/** Simple Moving Average */
export function sma(values: Series, period: number): Series {
  const out: Series = new Array(values.length).fill(NaN);
  if (period <= 0) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/**
 * Exponential Moving Average, seeded with the SMA of the first `period` values.
 * (Seeding with values[0] — as the previous implementation did — introduces a
 * large initialization bias on short series.)
 */
export function ema(values: Series, period: number): Series {
  const out: Series = new Array(values.length).fill(NaN);
  if (period <= 0 || values.length < period) return out;
  const k = 2 / (period + 1);
  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i];
  let prev = seed / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** Relative Strength Index — Wilder's smoothing */
export function rsi(values: Series, period = 14): Series {
  const out: Series = new Array(values.length).fill(NaN);
  if (values.length <= period) return out;

  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gainSum += diff;
    else lossSum -= diff;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

/** True Range */
export function trueRange(highs: Series, lows: Series, closes: Series): Series {
  const out: Series = new Array(closes.length).fill(NaN);
  if (closes.length === 0) return out;
  out[0] = highs[0] - lows[0];
  for (let i = 1; i < closes.length; i++) {
    out[i] = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
  }
  return out;
}

/** Average True Range — Wilder's smoothing */
export function atr(highs: Series, lows: Series, closes: Series, period = 14): Series {
  const tr = trueRange(highs, lows, closes);
  const out: Series = new Array(closes.length).fill(NaN);
  if (tr.length <= period) return out;

  let seed = 0;
  for (let i = 1; i <= period; i++) seed += tr[i];
  let prev = seed / period;
  out[period] = prev;
  for (let i = period + 1; i < tr.length; i++) {
    prev = (prev * (period - 1) + tr[i]) / period;
    out[i] = prev;
  }
  return out;
}

export interface MacdResult {
  macd: Series;
  signal: Series;
  histogram: Series;
}

/**
 * MACD with a real signal line = EMA(signalPeriod) of the MACD line.
 * (The previous implementation approximated it as `signal = macd * 0.85`, which
 * forced `histogram = macd * 0.15` — i.e. the histogram could never disagree
 * with the MACD line and carried zero information.)
 */
export function macd(values: Series, fast = 12, slow = 26, signalPeriod = 9): MacdResult {
  const emaFast = ema(values, fast);
  const emaSlow = ema(values, slow);
  const macdLine: Series = values.map((_, i) =>
    isNum(emaFast[i]) && isNum(emaSlow[i]) ? emaFast[i] - emaSlow[i] : NaN
  );

  // EMA of the MACD line, computed only over the region where the MACD exists.
  const firstValid = macdLine.findIndex((v) => isNum(v));
  const signalLine: Series = new Array(values.length).fill(NaN);
  if (firstValid >= 0) {
    const tail = macdLine.slice(firstValid);
    const sigTail = ema(tail, signalPeriod);
    for (let i = 0; i < sigTail.length; i++) signalLine[firstValid + i] = sigTail[i];
  }

  const histogram: Series = macdLine.map((v, i) =>
    isNum(v) && isNum(signalLine[i]) ? v - signalLine[i] : NaN
  );

  return { macd: macdLine, signal: signalLine, histogram };
}

export interface BollingerResult {
  upper: Series;
  middle: Series;
  lower: Series;
  /** (upper - lower) / middle — volatility measure used for "squeeze" detection */
  bandwidth: Series;
  /** (price - lower) / (upper - lower) */
  percentB: Series;
}

export function bollinger(values: Series, period = 20, mult = 2): BollingerResult {
  const middle = sma(values, period);
  const upper: Series = new Array(values.length).fill(NaN);
  const lower: Series = new Array(values.length).fill(NaN);
  const bandwidth: Series = new Array(values.length).fill(NaN);
  const percentB: Series = new Array(values.length).fill(NaN);

  for (let i = period - 1; i < values.length; i++) {
    let sumSq = 0;
    for (let j = i - period + 1; j <= i; j++) sumSq += (values[j] - middle[i]) ** 2;
    const sd = Math.sqrt(sumSq / period);
    upper[i] = middle[i] + mult * sd;
    lower[i] = middle[i] - mult * sd;
    bandwidth[i] = middle[i] !== 0 ? (upper[i] - lower[i]) / middle[i] : NaN;
    const width = upper[i] - lower[i];
    percentB[i] = width > 0 ? (values[i] - lower[i]) / width : NaN;
  }
  return { upper, middle, lower, bandwidth, percentB };
}

export interface DonchianResult {
  upper: Series;
  lower: Series;
  middle: Series;
}

/** Donchian channel (Turtle Trading). Uses the previous N bars, excluding bar i. */
export function donchian(highs: Series, lows: Series, period: number): DonchianResult {
  const n = highs.length;
  const upper: Series = new Array(n).fill(NaN);
  const lower: Series = new Array(n).fill(NaN);
  const middle: Series = new Array(n).fill(NaN);

  for (let i = period; i < n; i++) {
    let hi = -Infinity;
    let lo = Infinity;
    for (let j = i - period; j < i; j++) {
      if (highs[j] > hi) hi = highs[j];
      if (lows[j] < lo) lo = lows[j];
    }
    upper[i] = hi;
    lower[i] = lo;
    middle[i] = (hi + lo) / 2;
  }
  return { upper, lower, middle };
}

export interface StochasticResult {
  k: Series;
  d: Series;
}

export function stochastic(highs: Series, lows: Series, closes: Series, kPeriod = 14, dPeriod = 3): StochasticResult {
  const n = closes.length;
  const rawK: Series = new Array(n).fill(NaN);
  for (let i = kPeriod - 1; i < n; i++) {
    let hi = -Infinity;
    let lo = Infinity;
    for (let j = i - kPeriod + 1; j <= i; j++) {
      if (highs[j] > hi) hi = highs[j];
      if (lows[j] < lo) lo = lows[j];
    }
    rawK[i] = hi > lo ? ((closes[i] - lo) / (hi - lo)) * 100 : 50;
  }
  return { k: rawK, d: sma(rawK.map((v) => (isNum(v) ? v : NaN)), dPeriod) };
}

export interface SupertrendResult {
  /** NaN when not yet defined */
  line: Series;
  /** 1 = uptrend, -1 = downtrend, NaN = undefined */
  direction: Series;
}

/** Supertrend (ATR band flip) — widely used trend/trailing-stop indicator. */
export function supertrend(highs: Series, lows: Series, closes: Series, period = 10, multiplier = 3): SupertrendResult {
  const n = closes.length;
  const atrSeries = atr(highs, lows, closes, period);
  const line: Series = new Array(n).fill(NaN);
  const direction: Series = new Array(n).fill(NaN);

  let finalUpper = NaN;
  let finalLower = NaN;
  let trend = 1;

  for (let i = 0; i < n; i++) {
    const a = atrSeries[i];
    if (!isNum(a)) continue;
    const mid = (highs[i] + lows[i]) / 2;
    const basicUpper = mid + multiplier * a;
    const basicLower = mid - multiplier * a;

    finalUpper =
      !isNum(finalUpper) || basicUpper < finalUpper || closes[i - 1] > finalUpper ? basicUpper : finalUpper;
    finalLower =
      !isNum(finalLower) || basicLower > finalLower || closes[i - 1] < finalLower ? basicLower : finalLower;

    const prevTrend = trend;
    if (closes[i] > finalUpper) trend = 1;
    else if (closes[i] < finalLower) trend = -1;
    else trend = i > 0 && isNum(direction[i - 1]) ? (direction[i - 1] as number) : prevTrend;

    direction[i] = trend;
    line[i] = trend === 1 ? finalLower : finalUpper;
  }
  return { line, direction };
}

export interface AdxResult {
  adx: Series;
  plusDI: Series;
  minusDI: Series;
}

/** Average Directional Index — trend *strength* filter (not direction). */
export function adx(highs: Series, lows: Series, closes: Series, period = 14): AdxResult {
  const n = closes.length;
  const plusDM: Series = new Array(n).fill(0);
  const minusDM: Series = new Array(n).fill(0);
  const tr = trueRange(highs, lows, closes);

  for (let i = 1; i < n; i++) {
    const upMove = highs[i] - highs[i - 1];
    const downMove = lows[i - 1] - lows[i];
    plusDM[i] = upMove > downMove && upMove > 0 ? upMove : 0;
    minusDM[i] = downMove > upMove && downMove > 0 ? downMove : 0;
  }

  const atrW = atr(highs, lows, closes, period);
  const smoothPlus = wilderSum(plusDM, period);
  const smoothMinus = wilderSum(minusDM, period);

  const plusDI: Series = new Array(n).fill(NaN);
  const minusDI: Series = new Array(n).fill(NaN);
  const dx: Series = new Array(n).fill(NaN);

  for (let i = 0; i < n; i++) {
    if (!isNum(atrW[i]) || atrW[i] === 0) continue;
    plusDI[i] = (smoothPlus[i] / atrW[i]) * 100;
    minusDI[i] = (smoothMinus[i] / atrW[i]) * 100;
    const sum = plusDI[i] + minusDI[i];
    dx[i] = sum > 0 ? (Math.abs(plusDI[i] - minusDI[i]) / sum) * 100 : 0;
  }

  // ADX = Wilder-smoothed DX
  const adxOut: Series = new Array(n).fill(NaN);
  const firstDx = dx.findIndex((v) => isNum(v));
  if (firstDx >= 0 && firstDx + period < n) {
    let seed = 0;
    for (let i = firstDx; i < firstDx + period; i++) seed += dx[i];
    let prev = seed / period;
    adxOut[firstDx + period - 1] = prev;
    for (let i = firstDx + period; i < n; i++) {
      prev = (prev * (period - 1) + dx[i]) / period;
      adxOut[i] = prev;
    }
  }
  return { adx: adxOut, plusDI, minusDI };
}

/** Wilder's smoothing used for DM series in ADX */
function wilderSum(values: Series, period: number): Series {
  const n = values.length;
  const out: Series = new Array(n).fill(NaN);
  if (n <= period) return out;
  let seed = 0;
  for (let i = 1; i <= period; i++) seed += values[i];
  let prev = seed;
  out[period] = prev;
  for (let i = period + 1; i < n; i++) {
    prev = prev - prev / period + values[i];
    out[i] = prev;
  }
  return out;
}

/** Rate of change over `period` bars, in percent */
export function roc(values: Series, period: number): Series {
  const out: Series = new Array(values.length).fill(NaN);
  for (let i = period; i < values.length; i++) {
    if (values[i - period] !== 0) out[i] = ((values[i] - values[i - period]) / values[i - period]) * 100;
  }
  return out;
}

/** Volume relative to its own moving average (>=1 means expansion) */
export function volumeRatio(volumes: Series, period = 20): Series {
  const avg = sma(volumes, period);
  return volumes.map((v, i) => (isNum(avg[i]) && avg[i] > 0 ? v / avg[i] : NaN));
}

/** Highest high of the previous `period` bars (excluding bar i) */
export function highestHigh(highs: Series, period: number): Series {
  const out: Series = new Array(highs.length).fill(NaN);
  for (let i = period; i < highs.length; i++) {
    let hi = -Infinity;
    for (let j = i - period; j < i; j++) if (highs[j] > hi) hi = highs[j];
    out[i] = hi;
  }
  return out;
}

/** Lowest low of the previous `period` bars (excluding bar i) */
export function lowestLow(lows: Series, period: number): Series {
  const out: Series = new Array(lows.length).fill(NaN);
  for (let i = period; i < lows.length; i++) {
    let lo = Infinity;
    for (let j = i - period; j < i; j++) if (lows[j] < lo) lo = lows[j];
    out[i] = lo;
  }
  return out;
}

/** True when `a` crossed above `b` at index i (a[i] > b[i] && a[i-1] <= b[i-1]) */
export function crossAbove(a: Series, b: Series, i: number): boolean {
  if (i < 1) return false;
  if (![a[i], a[i - 1], b[i], b[i - 1]].every(isNum)) return false;
  return a[i] > b[i] && a[i - 1] <= b[i - 1];
}

/** True when `a` crossed below `b` at index i */
export function crossBelow(a: Series, b: Series, i: number): boolean {
  if (i < 1) return false;
  if (![a[i], a[i - 1], b[i], b[i - 1]].every(isNum)) return false;
  return a[i] < b[i] && a[i - 1] >= b[i - 1];
}

/** Last finite value of a series (or NaN) */
export function last(s: Series): number {
  for (let i = s.length - 1; i >= 0; i--) if (isNum(s[i])) return s[i];
  return NaN;
}
