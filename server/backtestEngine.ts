import { KlineBar } from './binance';
import { Backtest } from './types';
import { buildBundle, getStrategy, type StrategyDefinition, type StrategyParams } from './strategies';

export interface BacktestOptions {
  symbol: string;
  timeframe: string;
  startDate: string;
  endDate: string;
  strategyId: string;
  initialBalance: number;
  riskPerTradePercent: number;
  stopLossPercent: number;
  takeProfitRatio: number;
  feePercent?: number; // Default 0.1% for Binance Spot (taker)
  slippagePercent?: number; // Default 0.05%
  /** Hard cap on notional exposure as a % of equity. Spot has no leverage => 100 */
  maxExposurePercent?: number;
  /** Override strategy parameters (used by the robustness test) */
  params?: StrategyParams;
  /**
   * Restrict trading/metrics to a bar-index window WITHOUT cutting the
   * indicator warm-up. Indicators are always computed on the full series (they
   * are causal), so walk-forward out-of-sample windows keep their history
   * instead of collapsing to zero trades.
   */
  window?: { from: number; to: number };
  isWalkForward?: boolean;
}

export interface WalkForwardFold {
  index: number;
  trainStart: string;
  trainEnd: string;
  testStart: string;
  testEnd: string;
  inSample: Backtest;
  outOfSample: Backtest;
  efficiencyRatio: number;
}

export interface WalkForwardResult {
  inSample: Backtest;
  outOfSample: Backtest;
  efficiencyRatio: number;
  robustnessVerdict: 'ROBUST' | 'MODERATE' | 'OVERFITTED' | 'INSUFFICIENT_DATA';
  /** Folds whose out-of-sample window had enough trades to be evidence at all. */
  informativeFolds?: number;
  /** Minimum OOS trades a fold needs before it counts toward the verdict. */
  minTradesPerFold?: number;
  /** Out-of-sample totals pooled across every fold (dollars, not per-window means). */
  pooledOutOfSampleTrades?: number;
  pooledOutOfSampleNetProfit?: number;
  pooledOutOfSampleProfitFactor?: number;
  folds?: WalkForwardFold[];
  meanOutOfSampleReturnPercent?: number;
  profitableFolds?: number;
  totalFolds?: number;
  notes?: string[];
}

export interface RobustnessResult {
  strategyId: string;
  baseline: Backtest;
  trials: number;
  profitableTrials: number;
  profitableRate: number;
  meanReturnPercent: number;
  worstReturnPercent: number;
  bestReturnPercent: number;
  verdict: 'ROBUST' | 'FRAGILE' | 'UNPROVEN';
  notes: string[];
}

const BARS_PER_YEAR: Record<string, number> = {
  '1m': 525600, '3m': 175200, '5m': 105120, '15m': 35040, '30m': 17520,
  '1h': 8760, '2h': 4380, '4h': 2190, '6h': 1460, '8h': 1095, '12h': 730,
  '1d': 365, '3d': 122, '1w': 52,
};

interface OpenTrade {
  entryPrice: number;
  entryIndex: number;
  entryTime: number;
  quantity: number;
  stopLoss: number;
  takeProfits: number[];
  highestSinceEntry: number;
  riskPerUnit: number;
  entryNotional: number;
  entryFee: number;
  sizeLimited: boolean;
  confidence: number;
  reason: string;
}

interface TradeDetail {
  netPnl: number;
  pnlPercent: number;
  rMultiple: number;
  exitReason: string;
  sizeLimited: boolean;
  holdingBars: number;
  confidence: number;
}

/**
 * Historical backtest engine.
 *
 * Honesty rules enforced here (the previous version violated several):
 *  1. Signals computed on bar i's CLOSE are filled at bar i+1's OPEN.
 *     Filling on the same close that produced the signal is look-ahead bias.
 *  2. Intrabar exits assume the WORST ordering: if a candle's range covers both
 *     the stop and a target, the stop is taken.
 *  3. Fees are charged on BOTH entry and exit notional, plus slippage on both,
 *     and they actually hit the balance (not just the trade record).
 *  4. No exit is evaluated on the entry bar itself.
 *  5. The live strategy registry is used — the same code the bot trades with.
 *  6. Drawdown is mark-to-market on the equity curve, not just realized PnL.
 *  7. When risk sizing exceeds the exposure cap the position is SCALED DOWN and
 *     flagged, never silently dropped (the old version produced zero-trade
 *     backtests that looked like "the strategy failed").
 */
export class BacktestingEngine {
  runBacktest(userId: string, candles: KlineBar[], options: BacktestOptions): Backtest {
    const initialBalance = options.initialBalance > 0 ? options.initialBalance : 10000;
    const feeRate = (options.feePercent ?? 0.1) / 100;
    const slippageRate = (options.slippagePercent ?? 0.05) / 100;
    const riskPercent = (options.riskPerTradePercent || 1) / 100;
    const maxExposure = (options.maxExposurePercent ?? 100) / 100;
    const slPercentFallback = (options.stopLossPercent || 2) / 100;
    const tpRatioFallback = options.takeProfitRatio || 2;

    const strategy = getStrategy(options.strategyId);
    const notes: string[] = [];

    if (!strategy) {
      notes.push(`Unknown strategy "${options.strategyId}". No trades were simulated.`);
      return this.emptyResult(userId, candles, options, notes);
    }
    if (!candles || candles.length === 0) {
      notes.push('No market data supplied.');
      return this.emptyResult(userId, candles ?? [], options, notes);
    }
    if (candles.length < strategy.minBars + 5) {
      notes.push(
        `Not enough history: ${candles.length} candles supplied but "${strategy.name}" needs at least ${strategy.minBars}. ` +
          `Increase the period or use a smaller timeframe.`
      );
      return this.emptyResult(userId, candles, options, notes);
    }

    const params: StrategyParams = { ...strategy.defaultParams, ...(options.params || {}) };
    const bundle = buildBundle(candles, params);
    const warmup = Math.max(bundle.warmup, strategy.minBars);

    // Trading window (defaults to "everything after warm-up")
    const winFrom = Math.max(warmup, options.window?.from ?? warmup);
    const winTo = Math.min(candles.length, options.window?.to ?? candles.length);
    if (winTo - winFrom < 10) {
      notes.push(`Evaluation window is only ${Math.max(0, winTo - winFrom)} bars — too short to trade.`);
      return this.emptyResult(userId, candles, options, notes);
    }

    let cash = initialBalance; // uncommitted cash
    let peakEquity = initialBalance;
    let maxDrawdownPercent = 0;
    let maxDrawdownUsd = 0;

    const trades: Backtest['trades'] = [];
    const detailed: TradeDetail[] = [];
    const equitySeries: number[] = [];
    const equityTimes: number[] = [];

    let open: OpenTrade | null = null;
    let pendingSignal: StrategySignalOrNull = null;
    let pendingExitReason: string | null = null;
    let skippedUndersize = 0;
    let sizeLimitedCount = 0;
    let totalFeesPaid = 0;

    const closeTrade = (exitPrice: number, exitIndex: number, exitTime: number, reason: string, t: OpenTrade) => {
      const exitNotional = exitPrice * t.quantity;
      const exitFee = exitNotional * feeRate;
      totalFeesPaid += t.entryFee + exitFee;
      // Release proceeds net of the exit fee (entry notional+fee were deducted at open)
      cash += exitNotional - exitFee;

      const netPnl = exitNotional - exitFee - (t.entryNotional + t.entryFee);
      const pnlPercent = (netPnl / (t.entryNotional + t.entryFee)) * 100;
      const rMultiple = t.riskPerUnit > 0 ? (exitPrice - t.entryPrice) / t.riskPerUnit : 0;

      trades.push({
        id: `bt_trd_${trades.length + 1}`,
        symbol: options.symbol,
        side: 'BUY',
        entryPrice: round(t.entryPrice),
        exitPrice: round(exitPrice),
        pnl: round(netPnl),
        pnlPercent: round2(pnlPercent),
        entryTime: new Date(t.entryTime).toISOString(),
        exitTime: new Date(exitTime).toISOString(),
        reason,
      });
      detailed.push({
        netPnl,
        pnlPercent,
        rMultiple,
        exitReason: reason,
        sizeLimited: t.sizeLimited,
        holdingBars: Math.max(1, exitIndex - t.entryIndex),
        confidence: t.confidence,
      });
      open = null;
    };

    for (let i = winFrom; i < winTo; i++) {
      const bar = candles[i];

      // ---- 1. Fill an entry scheduled from the previous bar's close ----
      if (pendingSignal && !open) {
        const sig = pendingSignal;
        const entryPrice = bar.open * (1 + slippageRate);
        const stopLoss =
          sig.stopLoss > 0 && sig.stopLoss < entryPrice ? sig.stopLoss : entryPrice * (1 - slPercentFallback);
        let takeProfits = sig.takeProfits.filter((tp) => tp > entryPrice).sort((a, b) => a - b);
        if (takeProfits.length === 0) {
          const risk = entryPrice - stopLoss;
          takeProfits = [entryPrice + risk * tpRatioFallback, entryPrice + risk * tpRatioFallback * 1.5];
        }

        const riskPerUnit = entryPrice - stopLoss;
        const riskAmount = cash * riskPercent;
        let quantity = riskPerUnit > 0 ? riskAmount / riskPerUnit : 0;
        let sizeLimited = false;

        const maxNotional = cash * maxExposure;
        if (quantity * entryPrice > maxNotional) {
          quantity = maxNotional / entryPrice;
          sizeLimited = true;
          sizeLimitedCount++;
        }

        const entryNotional = quantity * entryPrice;
        const entryFee = entryNotional * feeRate;
        if (quantity <= 0 || entryNotional + entryFee > cash || entryNotional < 10) {
          skippedUndersize++;
        } else {
          cash -= entryNotional + entryFee;
          open = {
            entryPrice,
            entryIndex: i,
            entryTime: bar.time,
            quantity,
            stopLoss,
            takeProfits,
            highestSinceEntry: entryPrice,
            riskPerUnit,
            entryNotional,
            entryFee,
            sizeLimited,
            confidence: sig.confidence,
            reason: sig.reason,
          };
        }
        pendingSignal = null;
      }

      // ---- 2. Fill a signal-based exit at this bar's open ----
      if (pendingExitReason && open && i > open.entryIndex) {
        const exitPrice = bar.open * (1 - slippageRate);
        closeTrade(exitPrice, i, bar.time, pendingExitReason, open);
        pendingExitReason = null;
      }

      // ---- 3. Manage the open position intrabar (never on the entry bar) ----
      if (open && i > open.entryIndex) {
        const t = open;
        if (bar.high > t.highestSinceEntry) t.highestSinceEntry = bar.high;

        // Worst-case ordering: stop first, then the nearest target.
        if (bar.low <= t.stopLoss) {
          closeTrade(t.stopLoss * (1 - slippageRate), i, bar.time, 'STOP_LOSS', t);
        } else {
          for (let k = 0; k < t.takeProfits.length; k++) {
            if (bar.high >= t.takeProfits[k]) {
              closeTrade(t.takeProfits[k] * (1 - slippageRate), i, bar.time, `TAKE_PROFIT_${k + 1}`, t);
              break;
            }
          }
        }

        // Trailing ratchet for signal-driven trend strategies
        if (open && strategy.exitMode === 'SIGNAL') {
          const a = bundle.atr[i];
          if (Number.isFinite(a) && a > 0) {
            const trail = t.highestSinceEntry - 2.5 * a;
            if (trail > t.stopLoss) t.stopLoss = trail;
          }
        }

        // Signal-based exits are evaluated on the CLOSE, executed at the NEXT open
        if (open && strategy.checkExit && !pendingExitReason) {
          const shouldExit = strategy.checkExit(bundle, i, params, {
            entryPrice: t.entryPrice,
            entryIndex: t.entryIndex,
            stopLoss: t.stopLoss,
            takeProfits: t.takeProfits,
            highestSinceEntry: t.highestSinceEntry,
          });
          if (shouldExit) pendingExitReason = 'SIGNAL_EXIT';
        }
      }

      // ---- 4. Evaluate a new entry on the confirmed close ----
      if (!open && !pendingExitReason) {
        pendingSignal = strategy.evaluate(bundle, i, params);
      }

      // ---- 5. Mark-to-market equity ----
      const equity = open ? cash + open.quantity * bar.close : cash;
      equitySeries.push(equity);
      equityTimes.push(bar.time);
      if (equity > peakEquity) peakEquity = equity;
      const dd = peakEquity > 0 ? ((peakEquity - equity) / peakEquity) * 100 : 0;
      if (dd > maxDrawdownPercent) {
        maxDrawdownPercent = dd;
        maxDrawdownUsd = peakEquity - equity;
      }
    }

    // Force-close anything still open at the end of the window
    if (open) {
      const lastIdx = winTo - 1;
      const lastBar = candles[lastIdx];
      closeTrade(lastBar.close * (1 - slippageRate), lastIdx, lastBar.time, 'BACKTEST_END_CLOSE', open);
      notes.push('One position was still open at the end of the data and was force-closed.');
    }

    // ---------------- Metrics ----------------
    const finalEquity = cash;
    const winners = detailed.filter((d) => d.netPnl > 0);
    const losers = detailed.filter((d) => d.netPnl <= 0);
    const grossProfit = winners.reduce((s, d) => s + d.netPnl, 0);
    const grossLoss = Math.abs(losers.reduce((s, d) => s + d.netPnl, 0));

    const totalTrades = detailed.length;
    const winRate = totalTrades > 0 ? (winners.length / totalTrades) * 100 : 0;
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 99 : 0;
    const netProfit = finalEquity - initialBalance;
    const netReturnPercent = (netProfit / initialBalance) * 100;
    const avgWin = winners.length ? grossProfit / winners.length : 0;
    const avgLoss = losers.length ? grossLoss / losers.length : 0;
    const expectancy = totalTrades ? netProfit / totalTrades : 0;
    const avgR = totalTrades ? detailed.reduce((s, d) => s + d.rMultiple, 0) / totalTrades : 0;
    const avgHold = totalTrades ? detailed.reduce((s, d) => s + d.holdingBars, 0) / totalTrades : 0;

    // Sharpe/Sortino from the mark-to-market equity curve, annualised per timeframe
    const perBarReturns: number[] = [];
    for (let i = 1; i < equitySeries.length; i++) {
      if (equitySeries[i - 1] > 0) perBarReturns.push(equitySeries[i] / equitySeries[i - 1] - 1);
    }
    const barsPerYear = BARS_PER_YEAR[options.timeframe] ?? 365;

    const totalBars = Math.max(1, winTo - winFrom);
    const barsInMarket = detailed.reduce((s, d) => s + d.holdingBars, 0);
    const daysSpan = Math.max(1, (candles[winTo - 1].time - candles[winFrom].time) / 86400000);

    if (skippedUndersize > 0) {
      notes.push(`${skippedUndersize} signal(s) were skipped: computed size was below the $10 minimum notional.`);
    }
    if (sizeLimitedCount > 0) {
      notes.push(
        `${sizeLimitedCount} position(s) were scaled down to the ${(maxExposure * 100).toFixed(0)}% exposure cap, ` +
          `so realized risk per trade was below the requested ${(riskPercent * 100).toFixed(2)}%.`
      );
    }
    if (totalTrades === 0) {
      notes.push('No trades were generated on this data. The strategy may need more history or looser parameters.');
    } else if (totalTrades < 30) {
      notes.push(`Only ${totalTrades} trades — below the ~30 minimum for any statistical confidence in these metrics.`);
    }
    if (daysSpan < 30 && totalTrades > 0) {
      notes.push(`The window covers only ${daysSpan.toFixed(0)} days — too short to judge a strategy.`);
    }

    return {
      id: `bt_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
      userId,
      symbol: options.symbol,
      timeframe: options.timeframe,
      startDate: options.startDate || iso(candles[winFrom].time),
      endDate: options.endDate || iso(candles[winTo - 1].time),
      strategyId: options.strategyId,
      strategyName: strategy.name,
      initialBalance: round(initialBalance),
      finalBalance: round(finalEquity),
      totalTrades,
      winningTrades: winners.length,
      losingTrades: losers.length,
      winRate: round2(winRate),
      netProfit: round(netProfit),
      netReturnPercent: round2(netReturnPercent),
      maxDrawdownPercent: round2(maxDrawdownPercent),
      maxDrawdownUsd: round(maxDrawdownUsd),
      profitFactor: round2(profitFactor),
      grossProfit: round(grossProfit),
      grossLoss: round(grossLoss),
      hasNoLosingTrades: losers.length === 0 && winners.length > 0,
      sharpeRatio: round2(annualizedSharpe(perBarReturns, barsPerYear)),
      sortinoRatio: round2(annualizedSortino(perBarReturns, barsPerYear)),
      averageTradeProfit: round(avgWin),
      averageTradeLoss: round(avgLoss),
      expectancyPerTrade: round(expectancy),
      averageRMultiple: round2(avgR),
      averageHoldingBars: round2(avgHold),
      tradesPerMonth: round2((totalTrades / daysSpan) * 30),
      timeInMarketPercent: round2((barsInMarket / totalBars) * 100),
      largestWin: round(totalTrades ? Math.max(...detailed.map((d) => d.netPnl)) : 0),
      largestLoss: round(totalTrades ? Math.min(...detailed.map((d) => d.netPnl)) : 0),
      exitBreakdown: exitBreakdown(detailed),
      totalFeesPaid: round(totalFeesPaid),
      feeDragPercent: round2((totalFeesPaid / initialBalance) * 100),
      dataQuality: 'SIMULATED_OFFLINE',
      createdAt: new Date().toISOString(),
      notes,
      equityCurve: downsample(equityTimes, equitySeries, 300).map(({ t, v }) => ({
        time: new Date(t).toISOString(),
        equity: round(v),
      })),
      trades,
    };
  }

  /**
   * Walk-forward analysis with MULTIPLE rolling folds.
   * A single 70/30 split is one sample and proves very little; this trains and
   * tests on several consecutive windows and reports how often the strategy
   * holds up out-of-sample.
   */
  runWalkForwardAnalysis(userId: string, candles: KlineBar[], options: BacktestOptions, folds = 4): WalkForwardResult {
    const notes: string[] = [];
    const n = candles?.length ?? 0;
    if (n < 400) {
      notes.push(`Only ${n} candles supplied — walk-forward needs at least ~400 for meaningful folds.`);
    }

    const strategy = getStrategy(options.strategyId);
    const warmupBars = strategy ? Math.max(strategy.minBars, 220) : 220;
    const foldResults: WalkForwardFold[] = [];

    // Index windows over the FULL series. Indicators are computed on all candles
    // every time (they are causal), so each out-of-sample window keeps its
    // warm-up history. The previous version sliced the array, which discarded
    // the warm-up and silently produced zero-trade "out-of-sample" results.
    const usable = n - warmupBars;
    if (usable < 100) {
      const single = this.runBacktest(userId, candles ?? [], options);
      return {
        inSample: single,
        outOfSample: single,
        efficiencyRatio: 0,
        robustnessVerdict: 'INSUFFICIENT_DATA',
        folds: [],
        totalFolds: 0,
        profitableFolds: 0,
        meanOutOfSampleReturnPercent: 0,
        notes: [`Not enough data after warm-up (${usable} usable bars) for any walk-forward fold.`],
      };
    }

    // Each fold is split 70/30 into train/test, so a fold needs ~250 usable bars
    // before its out-of-sample window (75 bars) can plausibly contain a trade.
    // Requesting more folds than the data supports used to yield empty windows
    // that were then silently averaged into the verdict.
    // Anchored, expanding-window walk-forward: training always starts at the first
    // tradable bar and grows, and each test block is the NEXT contiguous block. The
    // out-of-sample windows therefore tile the timeline with no gaps and no overlap,
    // so pooled out-of-sample results mean the same thing regardless of fold count.
    //
    // The previous scheme cut every fold into a 70/30 split, which made out-of-sample
    // coverage an arbitrary 30% of history that changed completely with the fold
    // count — the same strategy pooled to +1038 USD at 5 folds and -281 USD at 8.
    const minBarsPerBlock = 250;
    const supportedFolds = Math.max(1, Math.floor(usable / minBarsPerBlock) - 1);
    const effectiveFolds = Math.max(1, Math.min(folds, supportedFolds));
    if (effectiveFolds < folds) {
      notes.push(
        `Requested ${folds} folds but only ${usable} usable bars are available; reduced to ${effectiveFolds} so each out-of-sample block is long enough to contain trades.`
      );
    }
    if (effectiveFolds < 3) {
      notes.push(
        `Fewer than 3 walk-forward folds are possible with this history — the verdict below is weak evidence, not proof. Use a coarser timeframe or a longer series.`
      );
    }

    const blockSize = Math.floor(usable / (effectiveFolds + 1));
    for (let f = 0; f < effectiveFolds; f++) {
      const trainFrom = warmupBars;
      const trainTo = warmupBars + (f + 1) * blockSize;
      const testFrom = trainTo;
      const testTo = f === effectiveFolds - 1 ? n : trainTo + blockSize;
      if (testTo - testFrom < 40) continue;

      const inSample = this.runBacktest(userId, candles, {
        ...options,
        window: { from: trainFrom, to: trainTo },
      });
      const outOfSample = this.runBacktest(userId, candles, {
        ...options,
        window: { from: testFrom, to: testTo },
      });

      const denom = Math.abs(inSample.sharpeRatio) < 0.1 ? 0.1 : Math.abs(inSample.sharpeRatio);
      const eff =
        inSample.sharpeRatio >= 0 ? outOfSample.sharpeRatio / denom : -Math.abs(outOfSample.sharpeRatio) / denom;

      foldResults.push({
        index: f,
        trainStart: inSample.startDate,
        trainEnd: inSample.endDate,
        testStart: outOfSample.startDate,
        testEnd: outOfSample.endDate,
        inSample,
        outOfSample,
        efficiencyRatio: round2(eff),
      });
    }

    if (foldResults.length === 0) {
      const single = this.runBacktest(userId, candles ?? [], options);
      return {
        inSample: single, outOfSample: single, efficiencyRatio: 0, robustnessVerdict: 'INSUFFICIENT_DATA',
        folds: [], totalFolds: 0, profitableFolds: 0, meanOutOfSampleReturnPercent: 0,
        notes: ['Not enough data for any walk-forward fold.'],
      };
    }

    const headline = foldResults[foldResults.length - 1];
    const meanOosReturn = foldResults.reduce((s2, f) => s2 + f.outOfSample.netReturnPercent, 0) / foldResults.length;
    const meanOosSharpe = foldResults.reduce((s2, f) => s2 + f.outOfSample.sharpeRatio, 0) / foldResults.length;
    const meanIsSharpe = foldResults.reduce((s2, f) => s2 + f.inSample.sharpeRatio, 0) / foldResults.length;
    const tradedFolds = foldResults.filter((f) => f.outOfSample.totalTrades > 0);
    const efficiencyRatio = round2(
      Math.abs(meanIsSharpe) < 0.1 ? meanOosSharpe / 0.1 : meanOosSharpe / Math.abs(meanIsSharpe)
    );

    // A window holding one trade is not evidence. Counting it as a "fold" made the
    // profitable-rate a coin flip driven by whichever single trade happened to land
    // inside the window, and the verdict swung between ROBUST and OVERFITTED purely
    // on fold count. Only folds with >= MIN_TRADES_PER_FOLD out-of-sample trades
    // are allowed to decide the verdict.
    const MIN_TRADES_PER_FOLD = 5;
    const informative = foldResults.filter((f) => f.outOfSample.totalTrades >= MIN_TRADES_PER_FOLD);

    // Pooled out-of-sample totals. Averaging per-window PERCENTAGES weights a
    // 1-trade window the same as a 30-trade window; pooling dollars does not.
    const pooledTrades = foldResults.reduce((s2, f) => s2 + f.outOfSample.totalTrades, 0);
    const pooledNet = foldResults.reduce((s2, f) => s2 + f.outOfSample.netProfit, 0);
    const pooledGrossWin = foldResults.reduce((s2, f) => s2 + f.outOfSample.grossProfit, 0);
    const pooledGrossLoss = foldResults.reduce((s2, f) => s2 + f.outOfSample.grossLoss, 0);
    const pooledPF =
      pooledGrossLoss > 0 ? round2(pooledGrossWin / pooledGrossLoss) : pooledGrossWin > 0 ? 99 : 0;

    // Verdict logic. The POOLED out-of-sample result is the primary evidence,
    // because it is weighted by dollars and is stable regardless of how the timeline
    // was cut. The per-window profitable rate is only a consistency modifier.
    //
    // Relying on the per-window rate alone was wrong in both directions: with many
    // folds each window held 1-2 trades (pure noise), and with few folds a single
    // long losing block could label a strategy "OVERFITTED" even though it made
    // +1200 USD out of sample at a 1.82 profit factor.
    const winCount = informative.filter((f) => f.outOfSample.netProfit > 0).length;
    const rate = informative.length ? winCount / informative.length : 0;
    const hasEnoughEvidence = informative.length >= 3 || pooledTrades >= 30;

    let robustnessVerdict: WalkForwardResult['robustnessVerdict'];
    if (!hasEnoughEvidence) {
      robustnessVerdict = 'INSUFFICIENT_DATA';
    } else if (pooledNet > 0 && pooledPF > 1.2 && rate >= 0.6) {
      robustnessVerdict = 'ROBUST';
    } else if (pooledNet > 0 && pooledPF > 1.05) {
      robustnessVerdict = 'MODERATE';
    } else {
      robustnessVerdict = 'OVERFITTED';
    }

    notes.push(
      `Walk-forward over ${foldResults.length} folds: ${winCount}/${informative.length} informative out-of-sample ` +
        `windows (>= ${MIN_TRADES_PER_FOLD} trades) were profitable. Mean OOS return ${meanOosReturn.toFixed(2)}%, ` +
        `mean OOS Sharpe ${meanOosSharpe.toFixed(2)}.`
    );
    if (informative.length < 3) {
      notes.push(
        `Only ${informative.length} of ${foldResults.length} out-of-sample windows held >= ${MIN_TRADES_PER_FOLD} trades, ` +
          `so the per-window rate is weak evidence; the verdict rests mainly on the pooled result.`
      );
    }
    if (robustnessVerdict === 'INSUFFICIENT_DATA') {
      notes.push(
        `This is NOT proof the strategy fails — the windows are simply too short for this trade frequency. ` +
          `Use a coarser timeframe, a longer history, or fewer folds.`
      );
    }
    if (robustnessVerdict === 'OVERFITTED') {
      notes.push(
        `Pooled out-of-sample result is not profitable. Do not enable this strategy on this symbol/timeframe.`
      );
    }
    notes.push(
      `Pooled out-of-sample: ${pooledTrades} trades, net ${pooledNet >= 0 ? '+' : ''}${pooledNet.toFixed(2)} USD, profit factor ${pooledPF}.`
    );
    if (tradedFolds.length < foldResults.length) {
      notes.push(`${foldResults.length - tradedFolds.length} fold(s) produced no trades and were excluded from the rate.`);
    }

    return {
      inSample: headline.inSample,
      outOfSample: headline.outOfSample,
      efficiencyRatio,
      robustnessVerdict,
      folds: foldResults,
      totalFolds: foldResults.length,
      meanOutOfSampleReturnPercent: round2(meanOosReturn),
      profitableFolds: winCount,
      informativeFolds: informative.length,
      minTradesPerFold: MIN_TRADES_PER_FOLD,
      pooledOutOfSampleTrades: pooledTrades,
      pooledOutOfSampleNetProfit: round2(pooledNet),
      pooledOutOfSampleProfitFactor: pooledPF,
      notes,
    };
  }

  /**
   * Parameter robustness: perturb numeric parameters by +/- jitter and re-run.
   * A strategy that only works at one exact parameter set is curve-fit.
   */
  runParameterRobustness(
    userId: string,
    candles: KlineBar[],
    options: BacktestOptions,
    trials = 12,
    jitter = 0.2
  ): RobustnessResult {
    const strategy = getStrategy(options.strategyId);
    const baseline = this.runBacktest(userId, candles, options);
    if (!strategy) {
      return {
        strategyId: options.strategyId, baseline, trials: 0, profitableTrials: 0,
        profitableRate: 0, meanReturnPercent: 0, worstReturnPercent: 0, bestReturnPercent: 0,
        verdict: 'UNPROVEN', notes: ['Unknown strategy id.'],
      };
    }

    const numericKeys = Object.keys(strategy.defaultParams).filter(
      (k) => typeof strategy.defaultParams[k] === 'number' && Number(strategy.defaultParams[k]) !== 0
    );
    const results: number[] = [];
    const notes: string[] = [];

    // Deterministic LCG so repeated runs give identical results
    let seed = 12345;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };

    for (let t = 0; t < trials; t++) {
      const params: StrategyParams = { ...strategy.defaultParams };
      const touched: string[] = [];
      const count = 1 + Math.floor(rand() * Math.min(3, Math.max(1, numericKeys.length)));
      for (let c = 0; c < count; c++) {
        const key = numericKeys[Math.floor(rand() * numericKeys.length)];
        const baseVal = Number(strategy.defaultParams[key]);
        if (!Number.isFinite(baseVal)) continue;
        const factor = 1 + (rand() * 2 - 1) * jitter;
        const next = baseVal * factor;
        params[key] = Number.isInteger(baseVal) ? Math.max(1, Math.round(next)) : Math.round(next * 1000) / 1000;
        touched.push(`${key}=${params[key]}`);
      }
      const res = this.runBacktest(userId, candles, { ...options, params });
      results.push(res.netReturnPercent);
      notes.push(`trial ${t + 1}: ${touched.join(', ') || 'no change'} -> ${res.netReturnPercent.toFixed(2)}% (${res.totalTrades} trades)`);
    }

    const profitable = results.filter((r) => r > 0).length;
    const rate = results.length ? profitable / results.length : 0;
    const mean = results.length ? results.reduce((s, r) => s + r, 0) / results.length : 0;
    let verdict: RobustnessResult['verdict'] = 'ROBUST';
    if (results.length < 5) verdict = 'UNPROVEN';
    else if (rate < 0.5) verdict = 'FRAGILE';
    else if (rate < 0.75) verdict = 'UNPROVEN';

    return {
      strategyId: options.strategyId,
      baseline,
      trials: results.length,
      profitableTrials: profitable,
      profitableRate: round2(rate * 100),
      meanReturnPercent: round2(mean),
      worstReturnPercent: round2(results.length ? Math.min(...results) : 0),
      bestReturnPercent: round2(results.length ? Math.max(...results) : 0),
      verdict,
      notes,
    };
  }

  private emptyResult(userId: string, candles: KlineBar[], options: BacktestOptions, notes: string[]): Backtest {
    const initialBalance = options.initialBalance || 10000;
    return {
      id: `bt_${Date.now()}`,
      userId,
      symbol: options.symbol,
      timeframe: options.timeframe,
      startDate: options.startDate || iso(candles?.[0]?.time),
      endDate: options.endDate || iso(candles?.[candles.length - 1]?.time),
      strategyId: options.strategyId,
      strategyName: getStrategy(options.strategyId)?.name ?? options.strategyId,
      initialBalance,
      finalBalance: initialBalance,
      totalTrades: 0, winningTrades: 0, losingTrades: 0, winRate: 0,
      netProfit: 0, netReturnPercent: 0, maxDrawdownPercent: 0, maxDrawdownUsd: 0,
      profitFactor: 0, sharpeRatio: 0, sortinoRatio: 0,
      grossProfit: 0, grossLoss: 0, hasNoLosingTrades: false,
      averageTradeProfit: 0, averageTradeLoss: 0, expectancyPerTrade: 0, averageRMultiple: 0,
      averageHoldingBars: 0, tradesPerMonth: 0, timeInMarketPercent: 0,
      largestWin: 0, largestLoss: 0, exitBreakdown: {},
      totalFeesPaid: 0, feeDragPercent: 0,
      dataQuality: 'SIMULATED_OFFLINE',
      createdAt: new Date().toISOString(),
      notes,
      equityCurve: [],
      trades: [],
    };
  }
}

type StrategySignalOrNull = ReturnType<StrategyDefinition['evaluate']>;

function exitBreakdown(d: TradeDetail[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of d) out[t.exitReason] = (out[t.exitReason] || 0) + 1;
  return out;
}

function annualizedSharpe(returns: number[], barsPerYear: number): number {
  if (returns.length < 2) return 0;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const sd = Math.sqrt(returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1));
  return sd === 0 ? 0 : (mean / sd) * Math.sqrt(barsPerYear);
}

function annualizedSortino(returns: number[], barsPerYear: number): number {
  if (returns.length < 2) return 0;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const downside = returns.filter((r) => r < 0);
  if (downside.length === 0) return mean > 0 ? 99 : 0;
  const dsd = Math.sqrt(downside.reduce((s, r) => s + r * r, 0) / downside.length);
  return dsd === 0 ? 0 : (mean / dsd) * Math.sqrt(barsPerYear);
}

function downsample(times: number[], values: number[], maxPoints: number): { t: number; v: number }[] {
  if (values.length <= maxPoints) return values.map((v, i) => ({ t: times[i], v }));
  const step = values.length / maxPoints;
  const out: { t: number; v: number }[] = [];
  for (let i = 0; i < maxPoints; i++) {
    const idx = Math.min(values.length - 1, Math.floor(i * step));
    out.push({ t: times[idx], v: values[idx] });
  }
  out.push({ t: times[times.length - 1], v: values[values.length - 1] });
  return out;
}

const round = (v: number) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : 0);
const round2 = (v: number) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : 0);
const iso = (t?: number) => (t ? new Date(t).toISOString().split('T')[0] : '');

export const backtestingEngine = new BacktestingEngine();
