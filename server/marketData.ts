/**
 * Market data provider with a realistic, *persistent* offline fallback.
 * مزوّد بيانات السوق مع بديل واقعي ومستقر عند انقطاع الاتصال.
 *
 * Why this exists
 * ---------------
 * The previous implementation regenerated a brand-new random walk on every
 * single `getKlines()` call, with two defects that made backtests and paper
 * trading meaningless:
 *   1. Non-persistence — two calls one second apart returned unrelated price
 *      series, so a position's PnL was pure noise and SL/TP fired randomly.
 *   2. Upward bias — `(Math.random() - 0.48)` embeds a permanent +2% of
 *      volatility drift per bar, so *any* long-only strategy looked profitable.
 *   3. Wrong spacing — every interval was generated 15 minutes apart, so the
 *      "multi-timeframe" analysis (15m/1h/4h) was reading identical data.
 *
 * This module replaces that with a seeded regime-switching process:
 *   - Deterministic per symbol (same seed => same history, reproducible runs).
 *   - Zero mean drift across regimes (no free money for long-only strategies).
 *   - Fat tails + volatility clustering, like real crypto.
 *   - Correct candle spacing per interval, derived from one shared regime
 *     timeline so timeframes agree on the market state.
 *   - Append-only growth: the cached series is extended forward in time, so
 *     live prices move continuously instead of teleporting.
 *
 * NOTE: this is a *simulation* used when api.binance.com is unreachable.
 * It is good enough to validate engine plumbing and to sanity-check that a
 * strategy is not structurally broken, but it is NOT real market data.
 * Always re-validate on real Binance history before risking capital.
 */
import type { KlineBar } from './binance';

const MINUTE = 60_000;

export const INTERVAL_MINUTES: Record<string, number> = {
  '1m': 1,
  '3m': 3,
  '5m': 5,
  '15m': 15,
  '30m': 30,
  '1h': 60,
  '2h': 120,
  '4h': 240,
  '6h': 360,
  '8h': 480,
  '12h': 720,
  '1d': 1440,
  '3d': 4320,
  '1w': 10080,
};

export function intervalToMs(interval: string): number {
  const m = INTERVAL_MINUTES[interval];
  if (!m) throw new Error(`Unsupported interval: ${interval}`);
  return m * MINUTE;
}

/** Deterministic 32-bit PRNG (mulberry32) */
export class Rng {
  private state: number;
  constructor(seed: number) {
    this.state = seed >>> 0;
  }
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  /** Standard normal via Box-Muller */
  normal(): number {
    let u = 0;
    let v = 0;
    while (u === 0) u = this.next();
    while (v === 0) v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  /** Fat-tailed normal: occasional large moves, like real crypto */
  fatNormal(): number {
    const r = this.next();
    if (r < 0.002) return this.normal() * 9; // flash crash / squeeze
    if (r < 0.05) return this.normal() * 2.8; // tail event
    return this.normal();
  }
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }
}

/** Stable string hash -> 32-bit seed */
export function hashSeed(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

type RegimeName = 'TREND_UP' | 'TREND_DOWN' | 'RANGE' | 'HIGH_VOL';

interface Regime {
  /** log-drift per day */
  muDay: number;
  /** log-volatility per day */
  sigmaDay: number;
  /** volume multiplier */
  volMult: number;
}

/**
 * Calibrated so the UNCONDITIONAL expected drift is ~0 (slightly negative):
 *   0.32(+0.012) + 0.33(-0.012) + 0.25(0) + 0.10(-0.003) = -0.0003 / day.
 * A long-only bot therefore has no free tailwind from the data generator; it has
 * to earn its return by timing, which is exactly what we want to measure.
 */
const REGIMES: Record<RegimeName, Regime> = {
  TREND_UP: { muDay: 0.012, sigmaDay: 0.021, volMult: 1.15 },
  TREND_DOWN: { muDay: -0.012, sigmaDay: 0.027, volMult: 1.35 },
  RANGE: { muDay: 0.0, sigmaDay: 0.012, volMult: 0.85 },
  HIGH_VOL: { muDay: -0.003, sigmaDay: 0.052, volMult: 1.9 },
};

const REGIME_ORDER: RegimeName[] = ['TREND_UP', 'TREND_DOWN', 'RANGE', 'HIGH_VOL'];
const REGIME_WEIGHTS = [0.32, 0.33, 0.25, 0.1]; // stationary distribution
const P_STAY = 1 - 1 / 12; // average regime lasts ~12 days

function pickRegime(rng: Rng, current: RegimeName | null): RegimeName {
  if (current !== null && rng.next() < P_STAY) return current;
  const r = rng.next();
  let acc = 0;
  for (let i = 0; i < REGIME_ORDER.length; i++) {
    acc += REGIME_WEIGHTS[i];
    if (r <= acc) return REGIME_ORDER[i];
  }
  return REGIME_ORDER[REGIME_ORDER.length - 1];
}

/**
 * Regime timeline per symbol, built as a persistent Markov chain over ABSOLUTE
 * day indices. Because it is a function of the day (not of the bar index), every
 * interval generated for the same symbol agrees on the market state — which is
 * what makes multi-timeframe analysis meaningful.
 *
 * The earlier version re-rolled the regime independently for every day, so
 * regimes lasted one day each and the composition swung wildly between runs.
 */
const regimeTimelines = new Map<string, RegimeName[]>();

function regimeNameAtDay(symbol: string, dayIndex: number): RegimeName {
  let timeline = regimeTimelines.get(symbol);
  if (!timeline) {
    timeline = [];
    regimeTimelines.set(symbol, timeline);
  }
  if (dayIndex < 0) dayIndex = 0;
  if (timeline.length <= dayIndex) {
    const rng = new Rng(hashSeed(`${symbol}|regime-chain`));
    // Replay deterministically from day 0 so the prefix never changes
    let current: RegimeName | null = null;
    for (let d = 0; d <= dayIndex; d++) {
      current = pickRegime(rng, current);
      timeline[d] = current;
    }
  }
  return timeline[dayIndex];
}

/** Public accessor used by analytics/research tooling. */
export function regimeAtDay(symbol: string, dayIndex: number): Regime & { name: RegimeName } {
  const name = regimeNameAtDay(symbol, dayIndex);
  return { ...REGIMES[name], name };
}

/** Reset cached regime timelines (tests). */
export function resetRegimeCache(): void {
  regimeTimelines.clear();
}

export interface SyntheticSymbolProfile {
  startPrice: number;
  /** typical daily quote volume */
  baseVolume: number;
}

const PROFILES: Record<string, SyntheticSymbolProfile> = {
  BTCUSDT: { startPrice: 94000, baseVolume: 34000 },
  ETHUSDT: { startPrice: 3340, baseVolume: 185000 },
  SOLUSDT: { startPrice: 198.8, baseVolume: 890000 },
  BNBUSDT: { startPrice: 645.2, baseVolume: 94000 },
  XRPUSDT: { startPrice: 2.38, baseVolume: 1200000 },
  DOGEUSDT: { startPrice: 0.36, baseVolume: 900000 },
  ADAUSDT: { startPrice: 0.92, baseVolume: 600000 },
  AVAXUSDT: { startPrice: 38.5, baseVolume: 220000 },
  LINKUSDT: { startPrice: 22.4, baseVolume: 300000 },
};

export function profileFor(symbol: string): SyntheticSymbolProfile {
  return PROFILES[symbol] ?? { startPrice: 100, baseVolume: 100000 };
}

interface SeriesState {
  bars: KlineBar[];
  /** open time of the first bar */
  startTime: number;
  /** open time of the last bar */
  lastTime: number;
  rng: Rng;
  intervalMs: number;
}

/**
 * Cache keyed by symbol|interval. Series only ever grow forward in time,
 * which is what makes live prices continuous between polls.
 */
const cache = new Map<string, SeriesState>();

/**
 * How much history to build on first access.
 *
 * The floor matters: backtests and strategy evaluation need ~220 bars just for
 * indicator warm-up, so a short cache silently produces a handful of trades and
 * metrics that look like a verdict but are noise. 1500 bars leaves ~1280
 * tradable bars on every interval. The ceiling bounds memory for fine intervals.
 */
function initialBarCount(intervalMs: number): number {
  // Aim for ~2 years of coverage, then clamp. The clamp is what matters:
  //   1m/5m/15m -> 3000 bars (2 / 10 / 31 days)
  //   1h        -> 3000 bars (125 days)
  //   4h        -> 3000 bars (500 days)
  //   1d        -> 1500 bars (4.1 years)
  // Coarse intervals previously got only ~540 bars, which after the 220-bar
  // indicator warm-up left ~320 tradable bars and ~9 trades on Turtle — far too
  // few to distinguish an edge from noise.
  const target = 730 * 24 * 60 * MINUTE;
  const bars = Math.ceil(target / intervalMs);
  return Math.min(Math.max(bars, 1500), 3000);
}

function alignTime(t: number, intervalMs: number): number {
  return Math.floor(t / intervalMs) * intervalMs;
}

function buildBar(
  symbol: string,
  rng: Rng,
  prevClose: number,
  openTime: number,
  intervalMs: number,
  baseVolume: number
): KlineBar {
  const dayIndex = Math.floor(openTime / (24 * 60 * MINUTE));
  const regime = REGIMES[regimeNameAtDay(symbol, dayIndex)];
  const dtDays = intervalMs / (24 * 60 * MINUTE);

  const drift = regime.muDay * dtDays;
  const vol = regime.sigmaDay * Math.sqrt(dtDays);
  const ret = drift + vol * rng.fatNormal();

  const open = prevClose;
  const close = prevClose * Math.exp(ret);

  // Intra-bar range: wicks scale with realized volatility of the bar
  const bodyHi = Math.max(open, close);
  const bodyLo = Math.min(open, close);
  const wick = prevClose * vol * rng.range(0.25, 1.35);
  const high = bodyHi + wick * rng.range(0.2, 1.0);
  const low = Math.max(bodyLo - wick * rng.range(0.2, 1.0), prevClose * 0.5);

  // Volume rises with absolute return, plus a daily seasonality
  const hourOfDay = new Date(openTime).getUTCHours();
  const season = 0.75 + 0.5 * Math.exp(-((hourOfDay - 15) ** 2) / 18);
  const shock = 1 + 2.2 * (Math.abs(ret) / Math.max(vol, 1e-9));
  const volume =
    (baseVolume * dtDays * regime.volMult * season * shock * rng.range(0.55, 1.6)) || baseVolume * dtDays;

  return {
    time: openTime,
    open: round(open),
    high: round(Math.max(high, bodyHi)),
    low: round(Math.min(low, bodyLo)),
    close: round(close),
    volume: Math.max(1, Math.round(volume * 100) / 100),
  };
}

function round(p: number): number {
  if (p >= 1000) return Math.round(p * 100) / 100;
  if (p >= 1) return Math.round(p * 10000) / 10000;
  return Math.round(p * 1000000) / 1000000;
}

/**
 * Get a persistent, forward-growing synthetic series for symbol+interval.
 * Ends at the current (aligned) time so "latest price" is always fresh.
 */
export function getSyntheticSeries(symbol: string, interval: string, limit = 200, now = Date.now()): KlineBar[] {
  const intervalMs = intervalToMs(interval);
  const key = `${symbol}|${interval}`;
  const profile = profileFor(symbol);
  const lastAligned = alignTime(now, intervalMs);

  let state = cache.get(key);
  if (!state) {
    const count = initialBarCount(intervalMs);
    const rng = new Rng(hashSeed(`${symbol}|${interval}|seed`));
    const startTime = lastAligned - (count - 1) * intervalMs;
    let prevClose = profile.startPrice;
    const bars: KlineBar[] = [];
    for (let i = 0; i < count; i++) {
      const t = startTime + i * intervalMs;
      const bar = buildBar(symbol, rng, prevClose, t, intervalMs, profile.baseVolume);
      bars.push(bar);
      prevClose = bar.close;
    }
    state = { bars, startTime, lastTime: lastAligned, rng, intervalMs };
    cache.set(key, state);
  } else if (lastAligned > state.lastTime) {
    // Extend forward — append-only, never regenerate the past.
    let prevClose = state.bars[state.bars.length - 1].close;
    for (let t = state.lastTime + state.intervalMs; t <= lastAligned; t += state.intervalMs) {
      const bar = buildBar(symbol, state.rng, prevClose, t, state.intervalMs, profile.baseVolume);
      state.bars.push(bar);
      prevClose = bar.close;
      state.lastTime = t;
    }
    // Bound memory
    if (state.bars.length > 20000) state.bars.splice(0, state.bars.length - 20000);
  }

  const take = Math.min(Math.max(limit, 1), state.bars.length);
  return state.bars.slice(state.bars.length - take);
}

/** Latest simulated price for a symbol (continuous across calls). */
export function getSyntheticPrice(symbol: string, now = Date.now()): number {
  const s = getSyntheticSeries(symbol, '1m', 2, now);
  return s[s.length - 1].close;
}

/** Reset the cache — used by tests to get deterministic runs. */
export function resetSyntheticCache(): void {
  cache.clear();
  regimeTimelines.clear();
}

/** Deterministic long history for research/backtesting (independent of the live cache). */
export function generateHistoricalSeries(
  symbol: string,
  interval: string,
  bars: number,
  endTime = Date.now()
): KlineBar[] {
  const intervalMs = intervalToMs(interval);
  const profile = profileFor(symbol);
  const rng = new Rng(hashSeed(`${symbol}|hist|${interval}`));
  const lastAligned = alignTime(endTime, intervalMs);
  const startTime = lastAligned - (bars - 1) * intervalMs;
  let prevClose = profile.startPrice;
  const out: KlineBar[] = [];
  for (let i = 0; i < bars; i++) {
    const bar = buildBar(symbol, rng, prevClose, startTime + i * intervalMs, intervalMs, profile.baseVolume);
    out.push(bar);
    prevClose = bar.close;
  }
  return out;
}

/**
 * Resample a finer series into a coarser interval (used to keep timeframes
 * mutually consistent when both are requested).
 */
export function resample(bars: KlineBar[], targetInterval: string): KlineBar[] {
  const targetMs = intervalToMs(targetInterval);
  const buckets = new Map<number, KlineBar[]>();
  for (const b of bars) {
    const key = Math.floor(b.time / targetMs) * targetMs;
    const arr = buckets.get(key);
    if (arr) arr.push(b);
    else buckets.set(key, [b]);
  }
  return Array.from(buckets.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([time, group]) => ({
      time,
      open: group[0].open,
      high: Math.max(...group.map((g) => g.high)),
      low: Math.min(...group.map((g) => g.low)),
      close: group[group.length - 1].close,
      volume: group.reduce((s, g) => s + g.volume, 0),
    }));
}
