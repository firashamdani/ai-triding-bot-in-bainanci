import { GoogleGenAI } from '@google/genai';
import { KlineBar } from './binance';
import { AiPrediction, TechnicalIndicators } from './types';
import {
  atr as atrSeries,
  bollinger,
  ema as emaSeries,
  isNum,
  macd as macdSeries,
  rsi as rsiSeries,
  last as lastOf,
} from './indicators';
import { buildBundle, getStrategy, type StrategySignal } from './strategies';

export interface StrategyHit {
  strategyId: string;
  strategyName: string;
  confidence: number;
  reason: string;
  signal: StrategySignal;
}

export interface ConsensusResult {
  fired: StrategyHit[];
  evaluated: number;
  /** 0..1 — fraction of evaluated strategies that signalled long */
  agreement: number;
  bestConfidence: number;
}

export class AiTradingEngine {
  private genAi: GoogleGenAI | null = null;

  constructor() {
    if (process.env.GEMINI_API_KEY) {
      this.genAi = new GoogleGenAI({
        apiKey: process.env.GEMINI_API_KEY,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
      });
    }
  }

  get isGeminiAvailable(): boolean {
    return this.genAi !== null;
  }

  /**
   * Full multi-indicator technical analysis.
   *
   * Fixes vs the previous version:
   *  - MACD used `signal = macd * 0.85`, forcing `histogram = macd * 0.15`. The
   *    histogram could therefore never disagree with the MACD line and added no
   *    information. It is now EMA(9) of the MACD line, as defined by Appel.
   *  - EMA periods were mangled when data was short: `ema(closes, min(200, len-1))`
   *    turned "EMA200" into "EMA99" on a 100-bar series, so the macro-trend
   *    filter compared price against a stale bar instead of a real 200-EMA.
   *    Periods are now fixed; when there is not enough history the indicator is
   *    reported as unavailable and confidence is reduced instead of being faked.
   *  - EMAs are SMA-seeded to remove initialization bias.
   *  - ATR uses Wilder's smoothing.
   */
  calculateIndicators(candles: KlineBar[]): TechnicalIndicators & { available: Record<string, boolean> } {
    const closes = candles.map((c) => c.close);
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);
    const lastPrice = closes[closes.length - 1] ?? 0;

    if (candles.length < 30) {
      return { ...this.getDefaultIndicators(lastPrice || 100), available: { ema200: false, ema50: false, macd: false } };
    }

    const ema9 = lastOf(emaSeries(closes, 9));
    const ema21 = lastOf(emaSeries(closes, 21));
    const ema50 = lastOf(emaSeries(closes, 50));
    const ema200 = lastOf(emaSeries(closes, 200));
    const rsi14 = lastOf(rsiSeries(closes, 14));
    const m = macdSeries(closes, 12, 26, 9);
    const atr14 = lastOf(atrSeries(highs, lows, closes, 14));
    const bb = bollinger(closes, 20, 2);

    // VWAP over the last 50 bars, volume-weighted on typical price
    let pv = 0;
    let vv = 0;
    for (let i = Math.max(0, candles.length - 50); i < candles.length; i++) {
      const tp = (candles[i].high + candles[i].low + candles[i].close) / 3;
      pv += tp * candles[i].volume;
      vv += candles[i].volume;
    }
    const vwap = vv > 0 ? pv / vv : lastPrice;

    // Swing points exclude the last 2 bars (an unconfirmed bar is not a fractal)
    const hiSlice = highs.slice(-15, -2);
    const loSlice = lows.slice(-15, -2);
    const swingHigh = hiSlice.length ? Math.max(...hiSlice) : lastPrice;
    const swingLow = loSlice.length ? Math.min(...loSlice) : lastPrice;

    // Order block proxy: last opposing candle before an impulse in trend direction
    let orderBlockType: 'BULLISH' | 'BEARISH' | 'NONE' = 'NONE';
    let orderBlockPrice = swingLow;
    if (isNum(ema21) && isNum(ema50) && lastPrice > ema21 && ema21 > ema50) {
      orderBlockType = 'BULLISH';
      orderBlockPrice = swingLow * 1.002;
    } else if (isNum(ema21) && isNum(ema50) && lastPrice < ema21 && ema21 < ema50) {
      orderBlockType = 'BEARISH';
      orderBlockPrice = swingHigh * 0.998;
    }

    const swingRange = Math.max(swingHigh - swingLow, lastPrice * 1e-6);

    return {
      rsi14: round1(isNum(rsi14) ? rsi14 : 50),
      macd: {
        macd: round(isNum(m.macd[m.macd.length - 1]) ? m.macd[m.macd.length - 1] : 0),
        signal: round(isNum(m.signal[m.signal.length - 1]) ? m.signal[m.signal.length - 1] : 0),
        histogram: round(isNum(m.histogram[m.histogram.length - 1]) ? m.histogram[m.histogram.length - 1] : 0),
      },
      ema9: round(isNum(ema9) ? ema9 : lastPrice),
      ema21: round(isNum(ema21) ? ema21 : lastPrice),
      ema50: round(isNum(ema50) ? ema50 : lastPrice),
      ema200: round(isNum(ema200) ? ema200 : lastPrice),
      atr14: round(isNum(atr14) ? atr14 : lastPrice * 0.012),
      vwap: round(vwap),
      bollinger: {
        upper: round(isNum(bb.upper[bb.upper.length - 1]) ? bb.upper[bb.upper.length - 1] : lastPrice * 1.02),
        middle: round(isNum(bb.middle[bb.middle.length - 1]) ? bb.middle[bb.middle.length - 1] : lastPrice),
        lower: round(isNum(bb.lower[bb.lower.length - 1]) ? bb.lower[bb.lower.length - 1] : lastPrice * 0.98),
      },
      fractals: { swingHigh: round(swingHigh), swingLow: round(swingLow) },
      orderBlock: { type: orderBlockType, priceLevel: round(orderBlockPrice) },
      fibonacciLevels: {
        '0.382': round(swingHigh - swingRange * 0.382),
        '0.5': round(swingHigh - swingRange * 0.5),
        '0.618': round(swingHigh - swingRange * 0.618),
      },
      available: {
        ema200: isNum(ema200),
        ema50: isNum(ema50),
        macd: isNum(m.histogram[m.histogram.length - 1]),
        atr: isNum(atr14),
      },
    };
  }

  /**
   * Run every requested strategy over the same bars and report which ones fire.
   * Agreement between independent strategies is a far stronger filter than any
   * single hand-tuned score.
   */
  strategyConsensus(bars: KlineBar[], strategyIds: string[]): ConsensusResult {
    const fired: StrategyHit[] = [];
    let evaluated = 0;

    for (const id of strategyIds) {
      const strategy = getStrategy(id);
      if (!strategy || bars.length < strategy.minBars) continue;
      evaluated++;
      const params = strategy.defaultParams;
      const bundle = buildBundle(bars, params);
      const sig = strategy.evaluate(bundle, bars.length - 1, params);
      if (sig) {
        fired.push({ strategyId: id, strategyName: strategy.name, confidence: sig.confidence, reason: sig.reason, signal: sig });
      }
    }

    return {
      fired,
      evaluated,
      agreement: evaluated > 0 ? fired.length / evaluated : 0,
      bestConfidence: fired.length ? Math.max(...fired.map((f) => f.confidence)) : 0,
    };
  }

  /**
   * Multi-timeframe analysis and confidence scoring.
   *
   * LONG-ONLY SEMANTICS: this platform trades Binance Spot, so SELL / STRONG_SELL
   * mean "do not be long — stay in cash or exit", never "open a short". The
   * scoring is calibrated so that WAIT is the default and a long entry requires
   * agreement across timeframes.
   */
  async analyzeSymbol(
    symbol: string,
    currentPrice: number,
    candles15m: KlineBar[],
    candles1h: KlineBar[],
    candles4h: KlineBar[],
    minConfidence: number = 75,
    strategyIds: string[] = []
  ): Promise<AiPrediction> {
    const ind15m = this.calculateIndicators(candles15m);
    const ind1h = this.calculateIndicators(candles1h);
    const ind4h = this.calculateIndicators(candles4h);

    let score = 50;
    const reasons: string[] = [];

    // ---- 1. Macro trend (4H) ----
    let trendFactor: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
    const macroReliable = ind4h.available.ema200 && ind4h.available.ema50;
    if (macroReliable) {
      if (ind4h.ema21 > ind4h.ema50 && ind4h.ema50 > ind4h.ema200) {
        trendFactor = 'BULLISH';
        score += 15;
        reasons.push('Macro 4H: bullish EMA alignment (21 > 50 > 200)');
      } else if (ind4h.ema21 < ind4h.ema50 && ind4h.ema50 < ind4h.ema200) {
        trendFactor = 'BEARISH';
        score -= 18;
        reasons.push('Macro 4H: bearish EMA alignment (21 < 50 < 200) — spot bot stays flat');
      } else {
        reasons.push('Macro 4H: mixed / range-bound EMA structure');
      }
    } else {
      score -= 5;
      reasons.push('Macro 4H: not enough history for EMA200 — trend filter unavailable, confidence reduced');
    }

    // ---- 2. Intermediate structure (1H) ----
    const is1hBullish = currentPrice > ind1h.ema21 && ind1h.macd.histogram > 0;
    const is1hBearish = currentPrice < ind1h.ema21 && ind1h.macd.histogram < 0;
    let structureFactor: 'BULLISH_BREAK' | 'BEARISH_BREAK' | 'CONSOLIDATION' | 'RANGE' = 'RANGE';
    if (is1hBullish) {
      structureFactor = 'BULLISH_BREAK';
      score += 12;
      reasons.push(`Structure 1H: price above EMA21 with a positive MACD histogram (${ind1h.macd.histogram})`);
    } else if (is1hBearish) {
      structureFactor = 'BEARISH_BREAK';
      score -= 12;
      reasons.push(`Structure 1H: price below EMA21 with a negative MACD histogram (${ind1h.macd.histogram})`);
    } else {
      structureFactor = 'CONSOLIDATION';
      reasons.push('Structure 1H: consolidation — no edge either way');
    }

    // ---- 3. Momentum (15M) ----
    let momentumFactor: 'STRONG' | 'MODERATE' | 'WEAK' = 'MODERATE';
    const r = ind15m.rsi14;
    if (r >= 50 && r <= 68) {
      momentumFactor = 'STRONG';
      score += 9;
      reasons.push(`Momentum 15M: RSI ${r} in the healthy expansion band (50-68), not yet overbought`);
    } else if (r > 72) {
      momentumFactor = 'WEAK';
      score -= 9;
      reasons.push(`Momentum 15M: RSI ${r} overbought — chasing here has poor expectancy`);
    } else if (r < 32) {
      momentumFactor = 'WEAK';
      score -= 4;
      reasons.push(`Momentum 15M: RSI ${r} oversold — a bounce is possible but the trend filter must agree first`);
    } else {
      reasons.push(`Momentum 15M: RSI ${r} neutral`);
    }

    // ---- 4. Entry zone: Fibonacci golden pocket / extension risk ----
    let entryZoneFactor: 'OPTIMAL' | 'FAIR' | 'RISKY' = 'FAIR';
    const golden = ind15m.fibonacciLevels['0.618'];
    const distToGolden = golden > 0 ? Math.abs(currentPrice - golden) / currentPrice : 1;
    if (distToGolden < 0.008) {
      entryZoneFactor = 'OPTIMAL';
      score += 9;
      reasons.push('Entry zone: price is inside the 0.5-0.618 Fibonacci golden pocket');
    } else if (currentPrice > ind15m.bollinger.upper) {
      entryZoneFactor = 'RISKY';
      score -= 11;
      reasons.push('Entry zone: price closed beyond the upper Bollinger band — statistically extended');
    } else if (currentPrice < ind15m.bollinger.lower) {
      entryZoneFactor = 'RISKY';
      score -= 6;
      reasons.push('Entry zone: price below the lower Bollinger band — falling knife risk in spot');
    }

    // ---- 5. Volume confirmation ----
    let volumeFactor: 'CONFIRMED' | 'UNCONFIRMED' | 'DIVERGENT' = 'UNCONFIRMED';
    if (candles15m.length >= 6) {
      const recent = candles15m.slice(-6, -1);
      const avgVol = recent.reduce((s, c) => s + c.volume, 0) / recent.length;
      const lastVol = candles15m[candles15m.length - 1].volume;
      if (avgVol > 0) {
        const ratio = lastVol / avgVol;
        if (ratio > 1.3) {
          volumeFactor = 'CONFIRMED';
          score += 7;
          reasons.push(`Volume: ${ratio.toFixed(2)}x the 5-bar average — participation confirms the move`);
        } else if (ratio < 0.6 && trendFactor === 'BULLISH') {
          volumeFactor = 'DIVERGENT';
          score -= 6;
          reasons.push(`Volume: only ${ratio.toFixed(2)}x average while price rises — weak participation (divergence)`);
        } else {
          reasons.push(`Volume: ${ratio.toFixed(2)}x average — no confirmation either way`);
        }
      }
    }

    // ---- 6. Multi-timeframe alignment ----
    let mtfAlignment: 'FULL_ALIGNMENT' | 'PARTIAL' | 'CONFLICT' = 'PARTIAL';
    if (trendFactor === 'BULLISH' && is1hBullish && r >= 45) {
      mtfAlignment = 'FULL_ALIGNMENT';
      score += 8;
      reasons.push('Multi-timeframe: 4H + 1H + 15M all agree bullish');
    } else if ((trendFactor === 'BULLISH' && is1hBearish) || (trendFactor === 'BEARISH' && is1hBullish)) {
      mtfAlignment = 'CONFLICT';
      score -= 16;
      reasons.push('Multi-timeframe CONFLICT: 1H opposes the 4H trend — standing aside');
    }

    // ---- 7. Independent strategy consensus ----
    let consensus: ConsensusResult | null = null;
    if (strategyIds.length > 0 && candles15m.length >= 220) {
      consensus = this.strategyConsensus(candles15m, strategyIds);
      if (consensus.fired.length > 0) {
        const names = consensus.fired.map((f) => f.strategyName).join(', ');
        score += Math.min(14, consensus.fired.length * 5);
        reasons.push(`Strategy consensus: ${consensus.fired.length}/${consensus.evaluated} proven strategies signalled long (${names})`);
      } else if (consensus.evaluated > 0) {
        score -= 4;
        reasons.push(`Strategy consensus: 0/${consensus.evaluated} strategies signalled — no mechanical entry available`);
      }
    }

    const confidenceScore = Math.max(5, Math.min(97, Math.round(score)));

    let prediction: AiPrediction['prediction'];
    if (confidenceScore >= 85) prediction = 'STRONG_BUY';
    else if (confidenceScore >= minConfidence) prediction = 'BUY';
    else if (confidenceScore <= 22) prediction = 'STRONG_SELL';
    else if (confidenceScore <= 38) prediction = 'SELL';
    else {
      prediction = 'WAIT';
      reasons.push(`Confidence ${confidenceScore}% is below the ${minConfidence}% entry threshold — no trade`);
    }

    // ---- Risk levels from ATR, not from fixed guesses ----
    const atr = ind15m.atr14 > 0 ? ind15m.atr14 : currentPrice * 0.015;
    const suggestedStopLoss = round(currentPrice - 1.5 * atr);
    const riskAmount = currentPrice - suggestedStopLoss;
    const suggestedTp1 = round(currentPrice + riskAmount * 2);
    const suggestedTp2 = round(currentPrice + riskAmount * 3);
    const suggestedTp3 = round(currentPrice + riskAmount * 4.5);

    let aiCommentary: string | null = null;
    if (this.genAi) {
      try {
        const prompt = `You are a quantitative crypto analyst. Data for ${symbol}:
Price ${currentPrice}; 4H trend ${trendFactor}; 1H structure ${structureFactor};
15M RSI ${ind15m.rsi14}; MACD histogram ${ind15m.macd.histogram}; ATR(14) ${round(atr)};
Signal ${prediction} at ${confidenceScore}% confidence.
Key evidence: ${reasons.join('; ')}

Write exactly 2 sentences on the probability profile and the main risk of this setup.
This is a LONG-ONLY spot system: never suggest shorting. Plain text only.`;

        const response = await this.genAi.models.generateContent({
          model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
          contents: prompt,
        });
        if (response.text) aiCommentary = response.text.trim();
      } catch {
        aiCommentary = null; // fall back to the deterministic rules silently
      }
    }
    if (aiCommentary) reasons.unshift(`AI assessment: ${aiCommentary}`);

    return {
      id: `pred_${Date.now()}_${symbol}`,
      symbol,
      timestamp: new Date().toISOString(),
      timeframe: '15m',
      prediction,
      confidenceScore,
      factors: {
        trend: trendFactor,
        momentum: momentumFactor,
        volume: volumeFactor,
        structure: structureFactor,
        entryZone: entryZoneFactor,
        multiTimeframeAlignment: mtfAlignment,
      },
      reasoning: reasons,
      suggestedEntry: currentPrice,
      suggestedStopLoss,
      suggestedTp1,
      suggestedTp2,
      suggestedTp3,
      riskRewardRatio: '1:2 / 1:3 (partial at 2R, runner to 3R)',
      actualOutcome: 'PENDING',
      consensus: consensus
        ? {
            fired: consensus.fired.map((f) => ({ strategyId: f.strategyId, name: f.strategyName, confidence: f.confidence, reason: f.reason })),
            evaluated: consensus.evaluated,
            agreement: Math.round(consensus.agreement * 100) / 100,
          }
        : undefined,
      longOnly: true,
    };
  }

  private getDefaultIndicators(price: number): TechnicalIndicators {
    // Neutral placeholders — flagged via `available` so callers know these are not measurements.
    return {
      rsi14: 50,
      macd: { macd: 0, signal: 0, histogram: 0 },
      ema9: price,
      ema21: price,
      ema50: price,
      ema200: price,
      atr14: price * 0.012,
      vwap: price,
      bollinger: { upper: price * 1.02, middle: price, lower: price * 0.98 },
      fractals: { swingHigh: price * 1.02, swingLow: price * 0.98 },
      orderBlock: { type: 'NONE', priceLevel: price },
      fibonacciLevels: { '0.382': price, '0.5': price, '0.618': price },
    };
  }
}

const round = (v: number) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : 0);
const round1 = (v: number) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : 0);

export const aiTradingEngine = new AiTradingEngine();
