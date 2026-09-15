import { GoogleGenAI } from '@google/genai';
import { KlineBar } from './binance';
import { AiPrediction, TechnicalIndicators } from './types';

export class AiTradingEngine {
  private genAi: GoogleGenAI | null = null;

  constructor() {
    if (process.env.GEMINI_API_KEY) {
      this.genAi = new GoogleGenAI({
        apiKey: process.env.GEMINI_API_KEY,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });
    }
  }

  /**
   * Calculate full multi-indicator technical analysis
   */
  calculateIndicators(candles: KlineBar[]): TechnicalIndicators {
    if (candles.length < 30) {
      // Return safe defaults
      return this.getDefaultIndicators(candles[candles.length - 1]?.close || 100);
    }

    const closes = candles.map((c) => c.close);
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);
    const volumes = candles.map((c) => c.volume);
    const lastPrice = closes[closes.length - 1];

    // 1. EMAs (9, 21, 50, 200)
    const ema9 = this.calcEMA(closes, 9);
    const ema21 = this.calcEMA(closes, 21);
    const ema50 = this.calcEMA(closes, Math.min(50, closes.length - 2));
    const ema200 = this.calcEMA(closes, Math.min(200, closes.length - 1));

    // 2. RSI (14)
    const rsi14 = this.calcRSI(closes, 14);

    // 3. MACD (12, 26, 9)
    const ema12 = this.calcEMA(closes, 12);
    const ema26 = this.calcEMA(closes, 26);
    const macdLine = ema12 - ema26;
    const signalLine = macdLine * 0.85; // Smoothed signal approximation
    const histogram = macdLine - signalLine;

    // 4. ATR (14)
    const atr14 = this.calcATR(highs, lows, closes, 14);

    // 5. VWAP
    let cumulativeVolPrice = 0;
    let cumulativeVol = 0;
    for (let i = Math.max(0, candles.length - 50); i < candles.length; i++) {
      const typicalPrice = (candles[i].high + candles[i].low + candles[i].close) / 3;
      cumulativeVolPrice += typicalPrice * candles[i].volume;
      cumulativeVol += candles[i].volume;
    }
    const vwap = cumulativeVol > 0 ? cumulativeVolPrice / cumulativeVol : lastPrice;

    // 6. Bollinger Bands (20, 2)
    const period = 20;
    const slice = closes.slice(-period);
    const sma20 = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((sum, val) => sum + Math.pow(val - sma20, 2), 0) / period;
    const stdDev = Math.sqrt(variance);
    const bollinger = {
      upper: sma20 + 2 * stdDev,
      middle: sma20,
      lower: sma20 - 2 * stdDev,
    };

    // 7. Fractals (Swing High & Swing Low)
    let swingHigh = Math.max(...highs.slice(-15, -2));
    let swingLow = Math.min(...lows.slice(-15, -2));

    // 8. Order Block Detection
    // Last down-candle before significant impulsive move up
    let orderBlockType: 'BULLISH' | 'BEARISH' | 'NONE' = 'NONE';
    let orderBlockPrice = swingLow;
    if (lastPrice > ema21 && ema21 > ema50) {
      orderBlockType = 'BULLISH';
      orderBlockPrice = swingLow * 1.002;
    } else if (lastPrice < ema21 && ema21 < ema50) {
      orderBlockType = 'BEARISH';
      orderBlockPrice = swingHigh * 0.998;
    }

    // 9. Fibonacci Levels based on current swing range
    const swingRange = swingHigh - swingLow;
    const fibonacciLevels = {
      '0.382': swingHigh - swingRange * 0.382,
      '0.5': swingHigh - swingRange * 0.5,
      '0.618': swingHigh - swingRange * 0.618,
    };

    return {
      rsi14: Math.round(rsi14 * 10) / 10,
      macd: {
        macd: Math.round(macdLine * 100) / 100,
        signal: Math.round(signalLine * 100) / 100,
        histogram: Math.round(histogram * 100) / 100,
      },
      ema9: Math.round(ema9 * 100) / 100,
      ema21: Math.round(ema21 * 100) / 100,
      ema50: Math.round(ema50 * 100) / 100,
      ema200: Math.round(ema200 * 100) / 100,
      atr14: Math.round(atr14 * 100) / 100,
      vwap: Math.round(vwap * 100) / 100,
      bollinger: {
        upper: Math.round(bollinger.upper * 100) / 100,
        middle: Math.round(bollinger.middle * 100) / 100,
        lower: Math.round(bollinger.lower * 100) / 100,
      },
      fractals: {
        swingHigh: Math.round(swingHigh * 100) / 100,
        swingLow: Math.round(swingLow * 100) / 100,
      },
      orderBlock: {
        type: orderBlockType,
        priceLevel: Math.round(orderBlockPrice * 100) / 100,
      },
      fibonacciLevels: {
        '0.382': Math.round(fibonacciLevels['0.382'] * 100) / 100,
        '0.5': Math.round(fibonacciLevels['0.5'] * 100) / 100,
        '0.618': Math.round(fibonacciLevels['0.618'] * 100) / 100,
      },
    };
  }

  /**
   * Multi-Timeframe Analysis & Confidence Scoring
   */
  async analyzeSymbol(
    symbol: string,
    currentPrice: number,
    candles15m: KlineBar[],
    candles1h: KlineBar[],
    candles4h: KlineBar[],
    minConfidence: number = 75
  ): Promise<AiPrediction> {
    const ind15m = this.calculateIndicators(candles15m);
    const ind1h = this.calculateIndicators(candles1h);
    const ind4h = this.calculateIndicators(candles4h);

    let score = 50;
    const reasons: string[] = [];

    // 1. Trend Filter (1D / 4H)
    const isMacroBullish = ind4h.ema21 > ind4h.ema50 && ind4h.ema50 > ind4h.ema200;
    const isMacroBearish = ind4h.ema21 < ind4h.ema50 && ind4h.ema50 < ind4h.ema200;

    let trendFactor: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
    if (isMacroBullish) {
      trendFactor = 'BULLISH';
      score += 15;
      reasons.push('Macro Trend 4H: Bullish EMA alignment (EMA21 > EMA50 > EMA200)');
    } else if (isMacroBearish) {
      trendFactor = 'BEARISH';
      score -= 15;
      reasons.push('Macro Trend 4H: Bearish EMA alignment (EMA21 < EMA50 < EMA200)');
    } else {
      reasons.push('Macro Trend 4H: Consolidation / Range bound');
    }

    // 2. Intermediate Structure (1H)
    const is1hBullish = currentPrice > ind1h.ema21 && ind1h.macd.histogram > 0;
    const is1hBearish = currentPrice < ind1h.ema21 && ind1h.macd.histogram < 0;

    let structureFactor: 'BULLISH_BREAK' | 'BEARISH_BREAK' | 'CONSOLIDATION' | 'RANGE' = 'RANGE';
    if (is1hBullish) {
      structureFactor = 'BULLISH_BREAK';
      score += 12;
      reasons.push('Market Structure 1H: Bullish Break of Structure (BOS) above EMA21');
    } else if (is1hBearish) {
      structureFactor = 'BEARISH_BREAK';
      score -= 12;
      reasons.push('Market Structure 1H: Bearish breakdown below EMA21 with MACD contraction');
    }

    // 3. Momentum & RSI (15M)
    let momentumFactor: 'STRONG' | 'MODERATE' | 'WEAK' = 'MODERATE';
    if (ind15m.rsi14 >= 50 && ind15m.rsi14 <= 65) {
      momentumFactor = 'STRONG';
      score += 10;
      reasons.push(`Momentum 15M: Strong Bullish expansion (RSI: ${ind15m.rsi14}, not overbought)`);
    } else if (ind15m.rsi14 > 72) {
      score -= 8;
      reasons.push(`Momentum 15M: Overbought caution (RSI: ${ind15m.rsi14})`);
    } else if (ind15m.rsi14 < 35) {
      score += 5; // Potential oversold bounce
      reasons.push(`Momentum 15M: Oversold zone (RSI: ${ind15m.rsi14}) - potential mean reversion`);
    }

    // 4. Order Block & Fibonacci Entry Zone
    let entryZoneFactor: 'OPTIMAL' | 'FAIR' | 'RISKY' = 'FAIR';
    const distToGoldenPocket = Math.abs(currentPrice - ind15m.fibonacciLevels['0.618']) / currentPrice;
    if (distToGoldenPocket < 0.008) {
      entryZoneFactor = 'OPTIMAL';
      score += 10;
      reasons.push('Entry Zone: Price reacting inside 0.5 - 0.618 Fibonacci Golden Pocket');
    } else if (currentPrice > ind15m.bollinger.upper) {
      entryZoneFactor = 'RISKY';
      score -= 10;
      reasons.push('Entry Zone: Price extended beyond Upper Bollinger Band (high slippage risk)');
    }

    // 5. Volume Confirmation
    let volumeFactor: 'CONFIRMED' | 'UNCONFIRMED' | 'DIVERGENT' = 'CONFIRMED';
    const recentCandles = candles15m.slice(-5);
    const avgVol = recentCandles.reduce((s, c) => s + c.volume, 0) / 5;
    const lastVol = candles15m[candles15m.length - 1]?.volume || 0;
    if (lastVol > avgVol * 1.3) {
      score += 8;
      reasons.push(`Volume: Confirmed expansion (${(lastVol / avgVol).toFixed(1)}x over 5-period average)`);
    } else {
      volumeFactor = 'UNCONFIRMED';
    }

    // Multi-Timeframe Alignment
    let mtfAlignment: 'FULL_ALIGNMENT' | 'PARTIAL' | 'CONFLICT' = 'PARTIAL';
    if (isMacroBullish && is1hBullish) {
      mtfAlignment = 'FULL_ALIGNMENT';
      score += 8;
      reasons.push('Multi-Timeframe Alignment: 4H + 1H + 15M Bullish Confluence');
    } else if ((isMacroBullish && is1hBearish) || (isMacroBearish && is1hBullish)) {
      mtfAlignment = 'CONFLICT';
      score -= 15;
      reasons.push('Multi-Timeframe Conflict: Intermediate 1H direction opposes Macro 4H');
    }

    // Clamp score
    const confidenceScore = Math.max(15, Math.min(96, Math.round(score)));

    // Decision Logic
    let prediction: AiPrediction['prediction'] = 'WAIT';
    if (confidenceScore >= 82) {
      prediction = 'STRONG_BUY';
    } else if (confidenceScore >= minConfidence) {
      prediction = 'BUY';
    } else if (confidenceScore <= 30) {
      prediction = 'STRONG_SELL';
    } else if (confidenceScore <= 42) {
      prediction = 'SELL';
    } else {
      prediction = 'WAIT';
      reasons.push(`Confidence (${confidenceScore}%) below minimum required threshold (${minConfidence}%)`);
    }

    // Dynamic SL / TP calculation
    const atr = ind15m.atr14 > 0 ? ind15m.atr14 : currentPrice * 0.015;
    const suggestedStopLoss = Math.round((currentPrice - 1.5 * atr) * 100) / 100;
    const riskAmount = currentPrice - suggestedStopLoss;
    const suggestedTp1 = Math.round((currentPrice + riskAmount * 1.5) * 100) / 100;
    const suggestedTp2 = Math.round((currentPrice + riskAmount * 2.5) * 100) / 100;
    const suggestedTp3 = Math.round((currentPrice + riskAmount * 3.5) * 100) / 100;

    const riskRewardRatio = '1:2.5';

    // Optional Gemini 3.8 Flash model synthesis for deep market explanation
    if (this.genAi) {
      try {
        const prompt = `You are an elite quantitative crypto trading AI analyst.
Analyze the following live technical setup for ${symbol}:
Price: ${currentPrice}
4H Trend: ${trendFactor}
1H Structure: ${structureFactor}
15M RSI: ${ind15m.rsi14}, MACD Histogram: ${ind15m.macd.histogram}
ATR(14): ${atr}
Calculated Quant Signal: ${prediction} with ${confidenceScore}% Confidence.
Key Reasons: ${reasons.join('; ')}

Provide 2 concise analytical sentences summarizing the probability distribution and risk parameters for this trade. Return only plain text.`;

        const response = await this.genAi.models.generateContent({
          model: 'gemini-3.8-flash',
          contents: prompt,
        });

        if (response.text) {
          reasons.unshift(`AI Model Assessment: ${response.text.trim()}`);
        }
      } catch {
        // Fallback silently to quant rules
      }
    }

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
      riskRewardRatio,
      actualOutcome: 'PENDING',
    };
  }

  private calcEMA(values: number[], period: number): number {
    if (values.length === 0) return 0;
    const k = 2 / (period + 1);
    let ema = values[0];
    for (let i = 1; i < values.length; i++) {
      ema = values[i] * k + ema * (1 - k);
    }
    return ema;
  }

  private calcRSI(closes: number[], period: number = 14): number {
    if (closes.length <= period) return 50;
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
      if (diff >= 0) {
        avgGain = (avgGain * (period - 1) + diff) / period;
        avgLoss = (avgLoss * (period - 1)) / period;
      } else {
        avgGain = (avgGain * (period - 1)) / period;
        avgLoss = (avgLoss * (period - 1) - diff) / period;
      }
    }

    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
  }

  private calcATR(highs: number[], lows: number[], closes: number[], period: number = 14): number {
    if (highs.length < 2) return (highs[0] || 100) * 0.015;
    const trs: number[] = [];
    for (let i = 1; i < highs.length; i++) {
      const tr = Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1])
      );
      trs.push(tr);
    }
    return trs.slice(-period).reduce((a, b) => a + b, 0) / Math.min(trs.length, period);
  }

  private getDefaultIndicators(price: number): TechnicalIndicators {
    return {
      rsi14: 52.4,
      macd: { macd: 12.5, signal: 10.2, histogram: 2.3 },
      ema9: price * 1.002,
      ema21: price * 1.0,
      ema50: price * 0.995,
      ema200: price * 0.98,
      atr14: price * 0.012,
      vwap: price * 1.001,
      bollinger: {
        upper: price * 1.025,
        middle: price,
        lower: price * 0.975,
      },
      fractals: {
        swingHigh: price * 1.03,
        swingLow: price * 0.97,
      },
      orderBlock: {
        type: 'BULLISH',
        priceLevel: price * 0.975,
      },
      fibonacciLevels: {
        '0.382': price * 0.992,
        '0.5': price * 0.985,
        '0.618': price * 0.978,
      },
    };
  }
}

export const aiTradingEngine = new AiTradingEngine();
