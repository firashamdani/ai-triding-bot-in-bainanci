/**
 * Strategy registry — the single source of truth for trading logic.
 * سجل الاستراتيجيات — المصدر الوحيد لمنطق التداول.
 *
 * Why one registry
 * ----------------
 * Previously live trading used `aiEngine.analyzeSymbol()` while backtesting used
 * a separate `evaluateHistoricalSignal()` with different (and much simpler)
 * rules. That means a "winning" backtest said nothing about what the live bot
 * would actually do. Both paths now call the same functions here, so a
 * backtest result is a real statement about live behaviour.
 *
 * All strategies are LONG-ONLY by design: this platform trades Binance **Spot**,
 * where shorting is impossible. Opening a SELL on spot means selling an asset
 * you already hold, not opening a short position.
 *
 * Every strategy is a documented, publicly-studied approach rather than a
 * curve-fit invention:
 *   - Turtle / Donchian breakout        (Richard Dennis, 1983)
 *   - Connors RSI(2) mean reversion     (Connors & Alvarez, 2008)
 *   - Supertrend + ATR trailing         (Olivier Seban)
 *   - Bollinger squeeze breakout        (John Bollinger)
 *   - MACD momentum                     (Gerald Appel)
 *   - EMA trend pullback / Fib golden pocket / VWAP reversion — standard TA
 *
 * IMPORTANT: "documented" != "guaranteed profitable". Past performance on any
 * dataset — real or simulated — does not predict future results. Use the
 * walk-forward analysis and paper trading before ever enabling live mode.
 */
import type { KlineBar } from './binance';
import {
  adx,
  atr,
  bollinger,
  crossAbove,
  crossBelow,
  donchian,
  ema,
  isNum,
  macd,
  roc,
  rsi,
  sma,
  supertrend,
  volumeRatio,
  type AdxResult,
  type BollingerResult,
  type DonchianResult,
  type MacdResult,
  type Series,
  type SupertrendResult,
} from './indicators';

export type StrategyCategory = 'TREND' | 'BREAKOUT' | 'PULLBACK' | 'MOMENTUM' | 'MEAN_REVERSION' | 'FRACTAL';

export type ExitMode = 'TP_SL' | 'SIGNAL';

export interface StrategyParams {
  [key: string]: number | string | boolean;
}

export interface StrategySignal {
  /** Spot trading is long-only */
  side: 'BUY';
  /** 0..100 */
  confidence: number;
  stopLoss: number;
  takeProfits: number[];
  reason: string;
  reasonAr: string;
  exitMode: ExitMode;
}

export interface PositionState {
  entryPrice: number;
  entryIndex: number;
  stopLoss: number;
  takeProfits: number[];
  highestSinceEntry: number;
}

/** All indicators precomputed once per series (causal — no look-ahead). */
export interface IndicatorBundle {
  bars: KlineBar[];
  closes: Series;
  highs: Series;
  lows: Series;
  volumes: Series;
  emaFast: Series;
  emaMid: Series;
  emaSlow: Series;
  ema200: Series;
  sma5: Series;
  sma20: Series;
  sma200: Series;
  rsiSlow: Series;
  rsiFast: Series;
  macd: MacdResult;
  atr: Series;
  bb: BollingerResult;
  donchianEntry: DonchianResult;
  donchianExit: DonchianResult;
  supertrend: SupertrendResult;
  adx: AdxResult;
  volRatio: Series;
  rocFast: Series;
  rocSlow: Series;
  swingHigh: Series;
  swingLow: Series;
  vwap: Series;
  vwapStd: Series;
  /** Minimum bars required before signals are valid */
  warmup: number;
}

export interface StrategyDefinition {
  id: string;
  name: string;
  nameAr: string;
  description: string;
  descriptionAr: string;
  category: StrategyCategory;
  /** Provenance / documentation reference, shown in the UI */
  reference: string;
  /**
   * Timeframes this system was designed for. Running a daily-bar system on 1h
   * data multiplies trade count (and therefore fee drag) by ~24x without adding
   * edge — measured, this is what turns Turtle and RSI(2) from viable to losing.
   */
  recommendedTimeframes: string[];
  defaultParams: StrategyParams;
  exitMode: ExitMode;
  /** Minimum bars needed for a valid evaluation */
  minBars: number;
  evaluate(b: IndicatorBundle, i: number, p: StrategyParams): StrategySignal | null;
  /** For SIGNAL-exit strategies: true means close the position now */
  checkExit?(b: IndicatorBundle, i: number, p: StrategyParams, pos: PositionState): boolean;
}

const num = (p: StrategyParams, key: string, fallback: number): number => {
  const v = p[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
};
const bool = (p: StrategyParams, key: string, fallback: boolean): boolean => {
  const v = p[key];
  return typeof v === 'boolean' ? v : fallback;
};

const r2 = (v: number) => Math.round(v * 100) / 100;
const r6 = (v: number) => Math.round(v * 1000000) / 1000000;
const price = (v: number) => (v >= 1000 ? r2(v) : r6(v));

/** Anchored rolling VWAP over `period` bars plus its standard-deviation band */
function rollingVwap(bars: KlineBar[], period: number): { vwap: Series; std: Series } {
  const n = bars.length;
  const vwapArr: Series = new Array(n).fill(NaN);
  const stdArr: Series = new Array(n).fill(NaN);
  let pv = 0;
  let v = 0;
  const window: { tp: number; vol: number }[] = [];

  for (let i = 0; i < n; i++) {
    const tp = (bars[i].high + bars[i].low + bars[i].close) / 3;
    window.push({ tp, vol: bars[i].volume });
    pv += tp * bars[i].volume;
    v += bars[i].volume;
    if (window.length > period) {
      const old = window.shift()!;
      pv -= old.tp * old.vol;
      v -= old.vol;
    }
    if (window.length === period && v > 0) {
      const mean = pv / v;
      vwapArr[i] = mean;
      let acc = 0;
      for (const w of window) acc += w.vol * (w.tp - mean) ** 2;
      stdArr[i] = Math.sqrt(acc / v);
    }
  }
  return { vwap: vwapArr, std: stdArr };
}

/** Highest high / lowest low over the previous `period` bars, excluding bar i */
function swing(bars: KlineBar[], period: number): { high: Series; low: Series } {
  const n = bars.length;
  const high: Series = new Array(n).fill(NaN);
  const low: Series = new Array(n).fill(NaN);
  for (let i = period; i < n; i++) {
    let hi = -Infinity;
    let lo = Infinity;
    for (let j = i - period; j < i; j++) {
      if (bars[j].high > hi) hi = bars[j].high;
      if (bars[j].low < lo) lo = bars[j].low;
    }
    high[i] = hi;
    low[i] = lo;
  }
  return { high, low };
}

/** Build every indicator a strategy might need. Causal: index i uses data <= i. */
export function buildBundle(bars: KlineBar[], params: StrategyParams = {}): IndicatorBundle {
  const closes = bars.map((b) => b.close);
  const highs = bars.map((b) => b.high);
  const lows = bars.map((b) => b.low);
  const volumes = bars.map((b) => b.volume);

  const emaFastP = num(params, 'emaFast', 20);
  const emaMidP = num(params, 'emaSlow', 50);
  const atrP = num(params, 'atrPeriod', 14);
  const bbP = num(params, 'bbPeriod', 20);
  const bbM = num(params, 'bbMult', 2);
  const donEntry = num(params, 'donchianEntry', 20);
  const donExit = num(params, 'donchianExit', 10);
  const stP = num(params, 'supertrendPeriod', 10);
  const stM = num(params, 'supertrendMult', 3);
  const vwapP = num(params, 'vwapPeriod', 50);
  const swingP = num(params, 'swingLookback', 10);

  const { vwap, std } = rollingVwap(bars, vwapP);
  const sw = swing(bars, swingP);

  const warmup = Math.max(emaMidP, 200, donEntry + 2, stP * 2 + 2, bbP + 2, vwapP + 2) + 2;

  return {
    bars,
    closes,
    highs,
    lows,
    volumes,
    emaFast: ema(closes, emaFastP),
    emaMid: ema(closes, emaMidP),
    emaSlow: ema(closes, Math.min(100, Math.max(emaMidP * 2, 50))),
    ema200: ema(closes, 200),
    sma5: sma(closes, 5),
    sma20: sma(closes, 20),
    sma200: sma(closes, 200),
    rsiSlow: rsi(closes, num(params, 'rsiPeriod', 14)),
    rsiFast: rsi(closes, num(params, 'rsiFastPeriod', 2)),
    macd: macd(closes, 12, 26, 9),
    atr: atr(highs, lows, closes, atrP),
    bb: bollinger(closes, bbP, bbM),
    donchianEntry: donchian(highs, lows, donEntry),
    donchianExit: donchian(highs, lows, donExit),
    supertrend: supertrend(highs, lows, closes, stP, stM),
    adx: adx(highs, lows, closes, 14),
    volRatio: volumeRatio(volumes, 20),
    rocFast: roc(closes, num(params, 'rocFast', 4)),
    rocSlow: roc(closes, num(params, 'rocSlow', 12)),
    swingHigh: sw.high,
    swingLow: sw.low,
    vwap,
    vwapStd: std,
    warmup,
  };
}

/** Is the macro regime acceptable for a long entry? */
function regimeOk(b: IndicatorBundle, i: number, p: StrategyParams): boolean {
  if (!bool(p, 'requireEma200', true)) return true;
  const e200 = b.ema200[i];
  if (!isNum(e200)) return true; // not enough data: don't block, other filters still apply
  return b.closes[i] > e200;
}

function atrOr(b: IndicatorBundle, i: number, fallbackPct: number): number {
  const a = b.atr[i];
  return isNum(a) && a > 0 ? a : b.closes[i] * fallbackPct;
}

/** Place SL below a structural low, widened by ATR buffer */
function structuralStop(b: IndicatorBundle, i: number, p: StrategyParams, atrMult: number): number {
  const a = atrOr(b, i, 0.015);
  const swingLow = isNum(b.swingLow[i]) ? b.swingLow[i] : b.lows[i];
  return Math.min(b.closes[i] - atrMult * a, swingLow - 0.25 * a);
}

// =====================================================================
// 1. EMA Trend Pullback
// =====================================================================
const emaTrendPullback: StrategyDefinition = {
  id: 'strat_trend',
  name: 'EMA Trend Pullback (20/50/200 + ADX)',
  nameAr: 'ارتداد مع الاتجاه (EMA 20/50/200 مع فلتر ADX)',
  description:
    'Long only when EMA20 > EMA50 > EMA200 and ADX confirms trend strength. Enters on a pullback into the EMA20 zone that RSI resets, confirmed by a bullish close. Stop below the structural swing low, targets at 2R and 3R.',
  descriptionAr:
    'شراء فقط عندما يكون EMA20 > EMA50 > EMA200 مع تأكيد قوة الاتجاه عبر ADX. الدخول عند ارتداد السعر إلى منطقة EMA20 مع تصريف RSI، وتأكيد بإغلاق صاعد. الوقف أسفل قاع البنية، والأهداف عند 2R و 3R.',
  category: 'TREND',
  reference: 'Standard EMA-stacking trend continuation with ADX strength filter (Wilder, 1978).',
  recommendedTimeframes: ['1h', '4h'],
  defaultParams: {
    emaFast: 20, emaSlow: 50, rsiPeriod: 14, atrPeriod: 14,
    adxMin: 20, rsiPullbackMax: 50, rsiTurnMin: 50, atrStopMult: 1.5,
    tp1R: 2, tp2R: 3, requireEma200: true, minVolumeRatio: 0.8,
  },
  exitMode: 'TP_SL',
  minBars: 220,
  evaluate(b, i, p) {
    if (i < b.warmup) return null;
    const [ef, em, e200] = [b.emaFast[i], b.emaMid[i], b.ema200[i]];
    if (![ef, em, e200].every(isNum)) return null;
    if (!(ef > em && em > e200)) return null;

    const adxVal = b.adx.adx[i];
    if (isNum(adxVal) && adxVal < num(p, 'adxMin', 20)) return null;

    const rsiNow = b.rsiSlow[i];
    const rsiPrev = b.rsiSlow[i - 1];
    if (!isNum(rsiNow) || !isNum(rsiPrev)) return null;

    // Pullback: RSI cooled off recently, and is now turning back up
    let pulledBack = false;
    for (let j = Math.max(b.warmup, i - 6); j < i; j++) {
      if (isNum(b.rsiSlow[j]) && b.rsiSlow[j] <= num(p, 'rsiPullbackMax', 50)) pulledBack = true;
    }
    if (!pulledBack) return null;
    if (!(rsiNow > rsiPrev && rsiNow >= num(p, 'rsiTurnMin', 50))) return null;

    // Price is at/near the fast EMA and closed bullish
    const distToEma = Math.abs(b.closes[i] - ef) / ef;
    if (distToEma > 0.02) return null;
    if (!(b.closes[i] > b.bars[i].open)) return null;

    const vr = b.volRatio[i];
    if (isNum(vr) && vr < num(p, 'minVolumeRatio', 0.8)) return null;

    const entry = b.closes[i];
    const sl = structuralStop(b, i, p, num(p, 'atrStopMult', 1.5));
    const risk = entry - sl;
    if (risk <= 0 || risk / entry > 0.12) return null;

    const strength = Math.min(1, (isNum(adxVal) ? adxVal : 25) / 40);
    return {
      side: 'BUY',
      confidence: Math.round(58 + 22 * strength + (rsiNow >= 55 ? 8 : 0)),
      stopLoss: price(sl),
      takeProfits: [price(entry + risk * num(p, 'tp1R', 2)), price(entry + risk * num(p, 'tp2R', 3))],
      reason: `EMA stack bullish (20>50>200), ADX ${isNum(adxVal) ? adxVal.toFixed(1) : 'n/a'}, RSI reset to ${rsiNow.toFixed(1)} then turned up; price held the EMA20 zone and closed bullish.`,
      reasonAr: `توافق EMA صاعد (20>50>200)، ADX ${isNum(adxVal) ? adxVal.toFixed(1) : 'غير متاح'}، تصريف RSI إلى ${rsiNow.toFixed(1)} ثم انعكاس صعوداً؛ السعر حافظ على منطقة EMA20 وأغلق صاعداً.`,
      exitMode: 'TP_SL',
    };
  },
};

// =====================================================================
// 2. Bollinger Squeeze Breakout
// =====================================================================
const bbSqueezeBreakout: StrategyDefinition = {
  id: 'strat_breakout',
  name: 'Bollinger Squeeze Breakout (Volatility Expansion)',
  nameAr: 'اختراق انضغاط البولينجر (تمدّد التقلب)',
  description:
    'Waits for Bollinger bandwidth to compress into its lowest quintile of the last 100 bars, then enters when price closes above the upper band on above-average volume. Stop at the band middle, targets 2R/3R.',
  descriptionAr:
    'ينتظر انضغاط عرض نطاق البولينجر إلى أدنى خُمس خلال 100 شمعة، ثم يدخل عند إغلاق السعر فوق النطاق الأعلى بحجم تداول أعلى من المتوسط. الوقف عند منتصف النطاق، والأهداف 2R و 3R.',
  category: 'BREAKOUT',
  reference: 'John Bollinger, "Bollinger on Bollinger Bands" (2001) — the squeeze / volatility expansion setup.',
  recommendedTimeframes: ['1h', '4h'],
  defaultParams: {
    bbPeriod: 20, bbMult: 2, squeezeLookback: 100, squeezeQuantile: 0.2,
    minVolumeRatio: 1.2, atrStopMult: 2, tp1R: 2, tp2R: 3, requireEma200: false,
  },
  exitMode: 'TP_SL',
  minBars: 160,
  evaluate(b, i, p) {
    if (i < b.warmup) return null;
    const bw = b.bb.bandwidth[i];
    const upper = b.bb.upper[i];
    const middle = b.bb.middle[i];
    if (![bw, upper, middle].every(isNum)) return null;

    // Must be a fresh break above the upper band
    if (!(b.closes[i] > upper && b.closes[i - 1] <= (isNum(b.bb.upper[i - 1]) ? b.bb.upper[i - 1] : upper))) return null;

    const lookback = num(p, 'squeezeLookback', 100);
    const start = Math.max(b.warmup, i - lookback);
    const recent: number[] = [];
    for (let j = start; j < i; j++) if (isNum(b.bb.bandwidth[j])) recent.push(b.bb.bandwidth[j]);
    if (recent.length < 30) return null;

    const sorted = [...recent].sort((x, y) => x - y);
    const threshold = sorted[Math.floor(sorted.length * num(p, 'squeezeQuantile', 0.2))];
    // The squeeze must have been in force right before the break
    const preBreakBw = b.bb.bandwidth[i - 1];
    if (!isNum(preBreakBw) || preBreakBw > threshold) return null;

    const vr = b.volRatio[i];
    if (!isNum(vr) || vr < num(p, 'minVolumeRatio', 1.2)) return null;

    const entry = b.closes[i];
    const a = atrOr(b, i, 0.015);
    const sl = Math.max(middle, entry - num(p, 'atrStopMult', 2) * a);
    const risk = entry - sl;
    if (risk <= 0 || risk / entry > 0.1) return null;

    return {
      side: 'BUY',
      confidence: Math.round(60 + Math.min(20, (vr - 1) * 12)),
      stopLoss: price(sl),
      takeProfits: [price(entry + risk * num(p, 'tp1R', 2)), price(entry + risk * num(p, 'tp2R', 3))],
      reason: `Bandwidth ${bw.toFixed(4)} broke out of a squeeze (threshold ${threshold.toFixed(4)}); close ${entry.toFixed(2)} above upper band ${upper.toFixed(2)} on ${vr.toFixed(2)}x average volume.`,
      reasonAr: `عرض النطاق ${bw.toFixed(4)} خرج من حالة انضغاط (العتبة ${threshold.toFixed(4)})؛ الإغلاق ${entry.toFixed(2)} فوق النطاق الأعلى ${upper.toFixed(2)} بحجم ${vr.toFixed(2)} ضعف المتوسط.`,
      exitMode: 'TP_SL',
    };
  },
};

// =====================================================================
// 3. Fibonacci Golden-Pocket Pullback
// =====================================================================
const fibPullback: StrategyDefinition = {
  id: 'strat_pullback',
  name: 'Fibonacci Golden Pocket Pullback (0.5-0.618)',
  nameAr: 'ارتداد الجيب الذهبي لفيبوناتشي (0.5 - 0.618)',
  description:
    'In an established uptrend, measures the last impulse swing and enters when price retraces into the 0.5-0.618 golden pocket and prints a rejection candle. Stop under the 0.786 level, targets at the swing high and beyond.',
  descriptionAr:
    'في اتجاه صاعد قائم، يقيس آخر موجة اندفاعية ويدخل عند ارتداد السعر إلى الجيب الذهبي 0.5-0.618 مع شمعة رفض. الوقف تحت مستوى 0.786، والأهداف عند قمة الموجة وما بعدها.',
  category: 'PULLBACK',
  reference: 'Classic Fibonacci retracement practice; golden pocket popularised by modern swing-trading literature.',
  recommendedTimeframes: ['1h', '4h'],
  defaultParams: {
    swingLookback: 30, emaFast: 20, emaSlow: 50, fibMin: 0.5, fibMax: 0.618,
    rsiPeriod: 14, rsiMin: 35, rsiMax: 60, atrPeriod: 14, tp1R: 2, tp2R: 3.2, requireEma200: true,
  },
  exitMode: 'TP_SL',
  minBars: 220,
  evaluate(b, i, p) {
    if (i < b.warmup) return null;
    const lb = num(p, 'swingLookback', 30);
    const start = Math.max(b.warmup, i - lb);
    if (i - start < 10) return null;

    let swingHi = -Infinity;
    let swingLo = Infinity;
    let hiIdx = start;
    for (let j = start; j <= i; j++) {
      if (b.highs[j] > swingHi) { swingHi = b.highs[j]; hiIdx = j; }
      if (b.lows[j] < swingLo) swingLo = b.lows[j];
    }
    const range = swingHi - swingLo;
    if (range <= 0) return null;

    // Require an uptrend: the high must be later than the low
    let loIdx = start;
    for (let j = start; j <= i; j++) if (b.lows[j] === swingLo) loIdx = j;
    if (hiIdx <= loIdx) return null;

    if (!regimeOk(b, i, p)) return null;
    if (!(b.emaFast[i] > b.emaMid[i])) return null;

    const retracement = (swingHi - b.closes[i]) / range;
    if (retracement < num(p, 'fibMin', 0.5) || retracement > num(p, 'fibMax', 0.618)) return null;

    const rsiNow = b.rsiSlow[i];
    if (!isNum(rsiNow) || rsiNow < num(p, 'rsiMin', 35) || rsiNow > num(p, 'rsiMax', 60)) return null;

    // Rejection candle: long lower wick or bullish close off the low
    const bar = b.bars[i];
    const body = Math.abs(bar.close - bar.open);
    const lowerWick = Math.min(bar.open, bar.close) - bar.low;
    const isRejection = lowerWick > body * 1.1 || (bar.close > bar.open && bar.close > (bar.high + bar.low) / 2);
    if (!isRejection) return null;

    const entry = b.closes[i];
    const fib786 = swingHi - range * 0.786;
    const a = atrOr(b, i, 0.015);
    const sl = Math.min(fib786, entry - 1.2 * a);
    const risk = entry - sl;
    if (risk <= 0 || risk / entry > 0.1) return null;

    return {
      side: 'BUY',
      confidence: Math.round(62 + (1 - Math.abs(retracement - 0.559) / 0.059) * 12),
      stopLoss: price(sl),
      takeProfits: [price(Math.max(swingHi, entry + risk * num(p, 'tp1R', 2))), price(entry + risk * num(p, 'tp2R', 3.2))],
      reason: `Uptrend intact; price retraced ${(retracement * 100).toFixed(1)}% of the ${range.toFixed(2)} impulse into the golden pocket, RSI ${rsiNow.toFixed(1)}, rejection candle printed.`,
      reasonAr: `الاتجاه الصاعد قائم؛ ارتد السعر ${(retracement * 100).toFixed(1)}% من موجة ${range.toFixed(2)} إلى الجيب الذهبي، RSI ${rsiNow.toFixed(1)}، وظهرت شمعة رفض.`,
      exitMode: 'TP_SL',
    };
  },
};

// =====================================================================
// 4. MACD Momentum
// =====================================================================
const macdMomentum: StrategyDefinition = {
  id: 'strat_momentum',
  name: 'MACD Momentum (real signal line) + Volume',
  nameAr: 'زخم MACD (خط إشارة حقيقي) مع الحجم',
  description:
    'Enters on a fresh MACD/signal crossover with a rising histogram, above EMA200, on expanding volume. Requires RSI confirmation without being overbought. Stop 2x ATR, targets 2R/3R.',
  descriptionAr:
    'يدخل عند تقاطع جديد بين MACD وخط الإشارة مع histogram صاعد، فوق EMA200، وبحجم متزايد. يشترط تأكيد RSI دون تشبع شرائي. الوقف 2×ATR، والأهداف 2R و 3R.',
  category: 'MOMENTUM',
  reference: 'Gerald Appel, "Technical Analysis: Power Tools for Active Investors" (2005) — MACD(12,26,9) crossover.',
  recommendedTimeframes: ['1h', '4h'],
  defaultParams: {
    rsiPeriod: 14, rsiMin: 50, rsiMax: 72, atrPeriod: 14, atrStopMult: 2,
    minVolumeRatio: 1.15, tp1R: 2, tp2R: 3, requireEma200: true,
  },
  exitMode: 'TP_SL',
  minBars: 220,
  evaluate(b, i, p) {
    if (i < b.warmup) return null;
    if (!crossAbove(b.macd.macd, b.macd.signal, i)) return null;
    const hist = b.macd.histogram[i];
    if (!isNum(hist) || hist <= 0) return null;
    if (!regimeOk(b, i, p)) return null;

    const rsiNow = b.rsiSlow[i];
    if (!isNum(rsiNow) || rsiNow < num(p, 'rsiMin', 50) || rsiNow > num(p, 'rsiMax', 72)) return null;

    const vr = b.volRatio[i];
    if (!isNum(vr) || vr < num(p, 'minVolumeRatio', 1.15)) return null;

    const entry = b.closes[i];
    const a = atrOr(b, i, 0.015);
    const sl = entry - num(p, 'atrStopMult', 2) * a;
    const risk = entry - sl;
    if (risk <= 0 || risk / entry > 0.1) return null;

    return {
      side: 'BUY',
      confidence: Math.round(60 + Math.min(18, vr * 6) + (rsiNow > 58 ? 6 : 0)),
      stopLoss: price(sl),
      takeProfits: [price(entry + risk * num(p, 'tp1R', 2)), price(entry + risk * num(p, 'tp2R', 3))],
      reason: `MACD crossed above its signal (histogram ${hist.toFixed(2)}), price above EMA200, RSI ${rsiNow.toFixed(1)}, volume ${vr.toFixed(2)}x average.`,
      reasonAr: `تقاطع MACD فوق خط الإشارة (histogram ${hist.toFixed(2)})، السعر فوق EMA200، RSI ${rsiNow.toFixed(1)}، والحجم ${vr.toFixed(2)} ضعف المتوسط.`,
      exitMode: 'TP_SL',
    };
  },
};

// =====================================================================
// 5. Swing-structure break (BOS)
// =====================================================================
const fractalBos: StrategyDefinition = {
  id: 'strat_fractal',
  name: 'Swing Structure Break (BOS) + Donchian Confirm',
  nameAr: 'كسر بنية السوينغ (BOS) مع تأكيد دونشيان',
  description:
    'Enters when price breaks the previous swing high while the higher-timeframe trend filter (EMA50 > EMA200) agrees and ADX shows expansion. Stop under the most recent swing low, targets 2R/3R.',
  descriptionAr:
    'يدخل عند كسر السعر لقمة السوينغ السابقة مع موافقة فلتر الاتجاه (EMA50 > EMA200) وتوسع ADX. الوقف تحت أدنى سوينغ حديث، والأهداف 2R و 3R.',
  category: 'FRACTAL',
  reference: 'Market-structure / break-of-structure analysis; Donchian confirmation from Turtle Trading.',
  recommendedTimeframes: ['1h', '4h'],
  defaultParams: {
    swingLookback: 10, atrPeriod: 14, adxMin: 18, atrStopMult: 1.5,
    tp1R: 2, tp2R: 3, requireEma200: true, minVolumeRatio: 1.0,
  },
  exitMode: 'TP_SL',
  minBars: 220,
  evaluate(b, i, p) {
    if (i < b.warmup) return null;
    const sh = b.swingHigh[i];
    if (!isNum(sh)) return null;
    if (!(b.closes[i] > sh && b.closes[i - 1] <= sh)) return null;
    if (!regimeOk(b, i, p)) return null;
    if (!(b.emaMid[i] > b.ema200[i])) return null;

    const adxVal = b.adx.adx[i];
    if (isNum(adxVal) && adxVal < num(p, 'adxMin', 18)) return null;
    const vr = b.volRatio[i];
    if (isNum(vr) && vr < num(p, 'minVolumeRatio', 1.0)) return null;

    const entry = b.closes[i];
    const a = atrOr(b, i, 0.015);
    const swingLow = isNum(b.swingLow[i]) ? b.swingLow[i] : b.lows[i];
    const sl = Math.min(entry - num(p, 'atrStopMult', 1.5) * a, swingLow - 0.2 * a);
    const risk = entry - sl;
    if (risk <= 0 || risk / entry > 0.1) return null;

    return {
      side: 'BUY',
      confidence: Math.round(60 + Math.min(20, (isNum(adxVal) ? adxVal : 20) / 2)),
      stopLoss: price(sl),
      takeProfits: [price(entry + risk * num(p, 'tp1R', 2)), price(entry + risk * num(p, 'tp2R', 3))],
      reason: `Break of structure above swing high ${sh.toFixed(2)}; EMA50 > EMA200 and ADX ${isNum(adxVal) ? adxVal.toFixed(1) : 'n/a'} confirms expansion.`,
      reasonAr: `كسر بنية فوق قمة السوينغ ${sh.toFixed(2)}؛ EMA50 > EMA200 و ADX ${isNum(adxVal) ? adxVal.toFixed(1) : 'غير متاح'} يؤكد التوسع.`,
      exitMode: 'TP_SL',
    };
  },
};

// =====================================================================
// 6. Turtle / Donchian breakout  (SIGNAL exit)
// =====================================================================
const turtleDonchian: StrategyDefinition = {
  id: 'strat_turtle',
  name: 'Turtle Donchian Breakout (20 entry / 10 exit)',
  nameAr: 'اختراق دونشيان بطريقة السلحفاة (دخول 20 / خروج 10)',
  description:
    'The classic Turtle system: buy a 20-bar Donchian high breakout, exit when price breaks the 10-bar Donchian low. Uses a 2x ATR initial stop and lets winners run — exits are signal-driven, not fixed targets.',
  descriptionAr:
    'نظام السلحفاة الكلاسيكي: شراء عند اختراق قمة دونشيان 20 شمعة، والخروج عند كسر قاع دونشيان 10 شموع. يستخدم وقفاً أولياً 2×ATR ويترك الأرباح تجري — الخروج بالإشارة لا بأهداف ثابتة.',
  category: 'TREND',
  reference: 'Richard Dennis & William Eckhardt, Turtle Trading experiment (1983); System 1 rules.',
  recommendedTimeframes: ['4h', '1d'],
  defaultParams: {
    donchianEntry: 20, donchianExit: 10, atrPeriod: 14, atrStopMult: 2,
    minVolumeRatio: 1.0, requireEma200: false, adxMin: 0,
  },
  exitMode: 'SIGNAL',
  minBars: 60,
  evaluate(b, i, p) {
    const need = num(p, 'donchianEntry', 20) + 2;
    if (i < Math.max(need, 30)) return null;
    const upper = b.donchianEntry.upper[i];
    if (!isNum(upper)) return null;
    if (!(b.closes[i] > upper)) return null;

    const vr = b.volRatio[i];
    if (isNum(vr) && vr < num(p, 'minVolumeRatio', 1.0)) return null;

    const adxMin = num(p, 'adxMin', 0);
    if (adxMin > 0) {
      const adxVal = b.adx.adx[i];
      if (isNum(adxVal) && adxVal < adxMin) return null;
    }

    const entry = b.closes[i];
    const a = atrOr(b, i, 0.02);
    const sl = entry - num(p, 'atrStopMult', 2) * a;
    const risk = entry - sl;
    if (risk <= 0 || risk / entry > 0.15) return null;

    return {
      side: 'BUY',
      confidence: Math.round(58 + Math.min(20, (vr && isNum(vr) ? vr : 1) * 8)),
      stopLoss: price(sl),
      // Signal-exit strategy: TPs are wide safety nets, the real exit is Donchian(10)
      takeProfits: [price(entry + risk * 4), price(entry + risk * 8)],
      reason: `Close ${entry.toFixed(2)} broke the ${num(p, 'donchianEntry', 20)}-bar Donchian high ${upper.toFixed(2)}; exit rule is a break of the ${num(p, 'donchianExit', 10)}-bar Donchian low.`,
      reasonAr: `الإغلاق ${entry.toFixed(2)} اخترق قمة دونشيان ${num(p, 'donchianEntry', 20)} شمعة عند ${upper.toFixed(2)}؛ قاعدة الخروج كسر قاع دونشيان ${num(p, 'donchianExit', 10)} شموع.`,
      exitMode: 'SIGNAL',
    };
  },
  checkExit(b, i, p, pos) {
    const lower = b.donchianExit.lower[i];
    if (!isNum(lower)) return false;
    if (b.closes[i] < lower) return true;
    // Chandelier-style trailing: give back 3 ATR from the highest close since entry
    const a = atrOr(b, i, 0.02);
    return pos.highestSinceEntry - b.closes[i] > 3 * a;
  },
};

// =====================================================================
// 7. Connors RSI(2) mean reversion  (SIGNAL exit)
// =====================================================================
const rsi2MeanReversion: StrategyDefinition = {
  id: 'strat_rsi2',
  name: 'RSI(2) Mean Reversion (Connors) + SMA200 filter',
  nameAr: 'الارتداد للمتوسط بـ RSI(2) (كونورز) مع فلتر SMA200',
  description:
    'Buys short-term oversold conditions (RSI(2) < 10) only while price is above SMA200, then exits when price closes above SMA5 or RSI(2) recovers above 70. A hard ATR catastrophe stop guards against trend breaks.',
  descriptionAr:
    'يشتري حالات التشبع البيعي قصيرة الأجل (RSI(2) أقل من 10) فقط عندما يكون السعر فوق SMA200، ثم يخرج عند إغلاق السعر فوق SMA5 أو تعافي RSI(2) فوق 70. وقف كارثة صارم بـ ATR يحمي من كسر الاتجاه.',
  category: 'MEAN_REVERSION',
  reference: 'Larry Connors & Cesar Alvarez, "Short Term Trading Strategies That Work" (2008) — RSI(2) system.',
  recommendedTimeframes: ['4h', '1d'],
  defaultParams: {
    rsiFastPeriod: 2, rsiBuyBelow: 10, rsiExitAbove: 70, smaExitPeriod: 5,
    atrPeriod: 14, atrStopMult: 3.5, requireEma200: true, minVolumeRatio: 0,
  },
  exitMode: 'SIGNAL',
  minBars: 220,
  evaluate(b, i, p) {
    if (i < b.warmup) return null;
    const r2v = b.rsiFast[i];
    if (!isNum(r2v)) return null;
    if (!(r2v < num(p, 'rsiBuyBelow', 10))) return null;

    // Regime filter: only mean-revert inside a long-term uptrend
    const s200 = b.sma200[i];
    if (isNum(s200) && !(b.closes[i] > s200)) return null;
    if (bool(p, 'requireEma200', true) && isNum(b.ema200[i]) && !(b.closes[i] > b.ema200[i])) return null;

    const entry = b.closes[i];
    const a = atrOr(b, i, 0.02);
    const sl = entry - num(p, 'atrStopMult', 3.5) * a;
    const risk = entry - sl;
    if (risk <= 0 || risk / entry > 0.2) return null;

    return {
      side: 'BUY',
      confidence: Math.round(55 + Math.max(0, (num(p, 'rsiBuyBelow', 10) - r2v)) * 2),
      stopLoss: price(sl),
      takeProfits: [price(entry + risk * 1.2), price(entry + risk * 2)],
      reason: `RSI(2) at ${r2v.toFixed(1)} (deeply oversold) while price holds above SMA200 — statistical edge is a snap-back within an uptrend, not a reversal call.`,
      reasonAr: `RSI(2) عند ${r2v.toFixed(1)} (تشبع بيعي عميق) مع بقاء السعر فوق SMA200 — الأفضلية الإحصائية هي ارتداد سريع داخل الاتجاه الصاعد، لا توقع انعكاس.`,
      exitMode: 'SIGNAL',
    };
  },
  checkExit(b, i, p, pos) {
    if (i <= pos.entryIndex) return false;
    const sma5 = b.sma5[i];
    if (isNum(sma5) && b.closes[i] > sma5) return true;
    const r2v = b.rsiFast[i];
    if (isNum(r2v) && r2v > num(p, 'rsiExitAbove', 70)) return true;
    // Time stop: mean reversion should resolve quickly
    return i - pos.entryIndex > 10;
  },
};

// =====================================================================
// 8. Supertrend + ATR trailing  (SIGNAL exit)
// =====================================================================
const supertrendStrategy: StrategyDefinition = {
  id: 'strat_supertrend',
  name: 'Supertrend (10,3) + EMA200 filter',
  nameAr: 'سوبرترند (10،3) مع فلتر EMA200',
  description:
    'Enters when Supertrend flips bullish above EMA200, then trails the stop along the Supertrend line and exits on a bearish flip. Captures long trends with a mechanical, well-defined exit.',
  descriptionAr:
    'يدخل عند انقلاب السوبرترند إلى صاعد فوق EMA200، ثم يزحف الوقف على طول خط السوبرترند ويخرج عند انقلابه هابطاً. يقتنص الاتجاهات الطويلة بخروج ميكانيكي واضح.',
  category: 'TREND',
  reference: 'Supertrend indicator (Olivier Seban); ATR trailing stops per Wilder (1978).',
  recommendedTimeframes: ['1h', '4h'],
  defaultParams: {
    supertrendPeriod: 10, supertrendMult: 3, atrPeriod: 14, atrStopMult: 3,
    adxMin: 18, requireEma200: true, minVolumeRatio: 0,
  },
  exitMode: 'SIGNAL',
  minBars: 220,
  evaluate(b, i, p) {
    if (i < b.warmup) return null;
    const dir = b.supertrend.direction[i];
    const prevDir = b.supertrend.direction[i - 1];
    if (!isNum(dir) || !isNum(prevDir)) return null;
    if (!(dir === 1 && prevDir === -1)) return null;
    if (!regimeOk(b, i, p)) return null;

    const adxVal = b.adx.adx[i];
    if (isNum(adxVal) && adxVal < num(p, 'adxMin', 18)) return null;

    const entry = b.closes[i];
    const a = atrOr(b, i, 0.02);
    const stLine = isNum(b.supertrend.line[i]) ? b.supertrend.line[i] : entry - num(p, 'atrStopMult', 3) * a;
    const sl = Math.min(stLine, entry - num(p, 'atrStopMult', 3) * a);
    const risk = entry - sl;
    if (risk <= 0 || risk / entry > 0.15) return null;

    return {
      side: 'BUY',
      confidence: Math.round(60 + Math.min(18, (isNum(adxVal) ? adxVal : 20) / 2.5)),
      stopLoss: price(sl),
      takeProfits: [price(entry + risk * 4), price(entry + risk * 8)],
      reason: `Supertrend(${num(p, 'supertrendPeriod', 10)},${num(p, 'supertrendMult', 3)}) flipped bullish at ${entry.toFixed(2)} with price above EMA200; trailing stop follows the Supertrend line.`,
      reasonAr: `انقلب السوبرترند (${num(p, 'supertrendPeriod', 10)}،${num(p, 'supertrendMult', 3)}) إلى صاعد عند ${entry.toFixed(2)} مع بقاء السعر فوق EMA200؛ الوقف الزاحف يتبع خط السوبرترند.`,
      exitMode: 'SIGNAL',
    };
  },
  checkExit(b, i, p, pos) {
    const dir = b.supertrend.direction[i];
    if (isNum(dir) && dir === -1) return true;
    const stLine = b.supertrend.line[i];
    if (isNum(stLine) && stLine > pos.stopLoss) {
      // Trailing ratchet handled by the engine; exit if price closes under the line
      if (b.closes[i] < stLine) return true;
    }
    return false;
  },
};

// =====================================================================
// 9. Dual-momentum (relative + absolute)
// =====================================================================
const dualMomentum: StrategyDefinition = {
  id: 'strat_dual_momentum',
  name: 'Dual Momentum (ROC 4/12 + trend filter)',
  nameAr: 'الزخم المزدوج (ROC 4/12 مع فلتر الاتجاه)',
  description:
    'Enters only when both short and medium rate-of-change are positive and accelerating, price is above SMA200 (absolute momentum), and volume confirms. Targets 2R/3R with an ATR stop.',
  descriptionAr:
    'يدخل فقط عندما يكون معدل التغير قصير ومتوسط المدى إيجابياً ومتسارعاً، والسعر فوق SMA200 (الزخم المطلق)، مع تأكيد الحجم. الأهداف 2R و 3R مع وقف ATR.',
  category: 'MOMENTUM',
  reference: 'Gary Antonacci, "Dual Momentum Investing" (2014) — absolute + relative momentum.',
  recommendedTimeframes: ['4h', '1d'],
  defaultParams: {
    rocFast: 4, rocSlow: 12, atrPeriod: 14, atrStopMult: 2,
    minVolumeRatio: 1.1, tp1R: 2, tp2R: 3, requireEma200: true,
  },
  exitMode: 'TP_SL',
  minBars: 220,
  evaluate(b, i, p) {
    if (i < b.warmup) return null;
    const rf = b.rocFast[i];
    const rs = b.rocSlow[i];
    if (!isNum(rf) || !isNum(rs)) return null;
    if (!(rf > 0 && rs > 0)) return null;
    // Acceleration: short-term ROC stronger than the medium-term average pace
    if (!(rf > rs / 3)) return null;
    if (!regimeOk(b, i, p)) return null;
    const s200 = b.sma200[i];
    if (isNum(s200) && !(b.closes[i] > s200)) return null;

    const vr = b.volRatio[i];
    if (!isNum(vr) || vr < num(p, 'minVolumeRatio', 1.1)) return null;

    const entry = b.closes[i];
    const a = atrOr(b, i, 0.02);
    const sl = entry - num(p, 'atrStopMult', 2) * a;
    const risk = entry - sl;
    if (risk <= 0 || risk / entry > 0.1) return null;

    return {
      side: 'BUY',
      confidence: Math.round(58 + Math.min(20, rf * 1.5) + (rs > 5 ? 6 : 0)),
      stopLoss: price(sl),
      takeProfits: [price(entry + risk * num(p, 'tp1R', 2)), price(entry + risk * num(p, 'tp2R', 3))],
      reason: `Dual momentum aligned: ROC(${num(p, 'rocFast', 4)}) ${rf.toFixed(2)}% and ROC(${num(p, 'rocSlow', 12)}) ${rs.toFixed(2)}% both positive, above SMA200, volume ${vr.toFixed(2)}x.`,
      reasonAr: `الزخم المزدوج متوافق: ROC(${num(p, 'rocFast', 4)}) ${rf.toFixed(2)}% و ROC(${num(p, 'rocSlow', 12)}) ${rs.toFixed(2)}% كلاهما إيجابي، فوق SMA200، والحجم ${vr.toFixed(2)} ضعف.`,
      exitMode: 'TP_SL',
    };
  },
};

// =====================================================================
// 10. VWAP band reversion (intraday)
// =====================================================================
const vwapReversion: StrategyDefinition = {
  id: 'strat_vwap_reversion',
  name: 'VWAP Band Reversion (intraday)',
  nameAr: 'الارتداد من نطاقات VWAP (داخل اليوم)',
  description:
    'In an uptrending tape, buys when price stretches more than 2 standard deviations below the rolling VWAP and then closes back up — an institutional-value reversion. Target is the VWAP itself, stop is ATR-based.',
  descriptionAr:
    'في سياق صاعد، يشتري عندما يمتد السعر أكثر من انحرافين معياريين تحت VWAP المتحرك ثم يغلق مرتفعاً — ارتداد نحو القيمة المؤسسية. الهدف هو VWAP نفسه، والوقف مبني على ATR.',
  category: 'MEAN_REVERSION',
  reference: 'VWAP band reversion — standard institutional intraday execution technique.',
  recommendedTimeframes: ['15m', '5m'],
  defaultParams: {
    vwapPeriod: 50, vwapStdMult: 2, emaFast: 20, emaSlow: 50, atrPeriod: 14,
    atrStopMult: 2, tpVwap: true, minVolumeRatio: 0, requireEma200: false,
  },
  exitMode: 'TP_SL',
  minBars: 120,
  evaluate(b, i, p) {
    const need = num(p, 'vwapPeriod', 50) + 5;
    if (i < Math.max(need, 60)) return null;
    const v = b.vwap[i];
    const sd = b.vwapStd[i];
    if (!isNum(v) || !isNum(sd) || sd <= 0) return null;

    const z = (b.closes[i] - v) / sd;
    const prevZ = (b.closes[i - 1] - v) / sd;
    const mult = num(p, 'vwapStdMult', 2);
    if (!(prevZ <= -mult && z > prevZ)) return null;

    // Only fade dips inside an uptrend
    if (!(b.emaFast[i] > b.emaMid[i])) return null;
    const bar = b.bars[i];
    if (!(bar.close > bar.open)) return null;

    const entry = b.closes[i];
    const a = atrOr(b, i, 0.015);
    const sl = Math.min(entry - num(p, 'atrStopMult', 2) * a, b.lows[i] - 0.2 * a);
    const risk = entry - sl;
    if (risk <= 0 || risk / entry > 0.08) return null;

    const tp1 = bool(p, 'tpVwap', true) ? Math.max(v, entry + risk * 1.5) : entry + risk * 1.5;
    return {
      side: 'BUY',
      confidence: Math.round(56 + Math.min(20, Math.abs(prevZ) * 5)),
      stopLoss: price(sl),
      takeProfits: [price(tp1), price(entry + risk * 2.5)],
      reason: `Price stretched ${Math.abs(prevZ).toFixed(2)}σ below rolling VWAP (${v.toFixed(2)}) then closed bullish while EMA20 > EMA50 — reversion to institutional value.`,
      reasonAr: `امتد السعر ${Math.abs(prevZ).toFixed(2)} انحراف معياري تحت VWAP المتحرك (${v.toFixed(2)}) ثم أغلق صاعداً مع EMA20 > EMA50 — ارتداد نحو القيمة المؤسسية.`,
      exitMode: 'TP_SL',
    };
  },
};

export const STRATEGIES: StrategyDefinition[] = [
  emaTrendPullback,
  bbSqueezeBreakout,
  fibPullback,
  macdMomentum,
  fractalBos,
  turtleDonchian,
  rsi2MeanReversion,
  supertrendStrategy,
  dualMomentum,
  vwapReversion,
];

/**
 * Live index. Kept in sync by `registerStrategy` — a plain
 * `new Map(STRATEGIES...)` snapshot silently misses anything added later, which
 * is how a baseline strategy ended up "producing zero trades" in validation
 * instead of being reported as unregistered.
 */
const byId = new Map<string, StrategyDefinition>(STRATEGIES.map((s) => [s.id, s]));

export function getStrategy(id: string): StrategyDefinition | undefined {
  return byId.get(id);
}

/** Register an extra strategy (baselines, research variants, user-defined). */
export function registerStrategy(def: StrategyDefinition): void {
  if (!byId.has(def.id)) STRATEGIES.push(def);
  else STRATEGIES[STRATEGIES.findIndex((s) => s.id === def.id)] = def;
  byId.set(def.id, def);
}

/** Fall back to a conservative strategy instead of silently using trend logic */
export function getStrategyOrThrow(id: string): StrategyDefinition {
  const s = byId.get(id);
  if (!s) throw new Error(`Unknown strategy id: ${id}. Valid: ${STRATEGIES.map((x) => x.id).join(', ')}`);
  return s;
}

/** Strategy metadata in the shape the UI/db expects */
/** Default timeframe when a strategy does not declare one */
export function primaryTimeframe(s: StrategyDefinition): string {
  return s.recommendedTimeframes?.[0] ?? '1h';
}

export function toDbStrategy(s: StrategyDefinition) {
  return {
    id: s.id,
    name: s.name,
    nameAr: s.nameAr,
    description: s.description,
    descriptionAr: s.descriptionAr,
    category: s.category,
    isActive: true,
    reference: s.reference,
    exitMode: s.exitMode,
    recommendedTimeframes: s.recommendedTimeframes ?? ['1h'],
    parameters: s.defaultParams,
  };
}
