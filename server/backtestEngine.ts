import { KlineBar } from './binance';
import { Backtest } from './types';

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
  feePercent?: number; // Default 0.1% for Binance Spot
  slippagePercent?: number; // Default 0.05%
  isWalkForward?: boolean;
}

export interface WalkForwardResult {
  inSample: Backtest;
  outOfSample: Backtest;
  efficiencyRatio: number; // OutOfSample Sharpe / InSample Sharpe
  robustnessVerdict: 'ROBUST' | 'MODERATE' | 'OVERFITTED';
}

export class BacktestingEngine {
  /**
   * Run high-fidelity historical backtest simulation
   */
  runBacktest(userId: string, candles: KlineBar[], options: BacktestOptions): Backtest {
    const initialBalance = options.initialBalance || 10000;
    const feeRate = (options.feePercent ?? 0.1) / 100;
    const slippageRate = (options.slippagePercent ?? 0.05) / 100;
    const riskPercent = (options.riskPerTradePercent || 1.0) / 100;
    const slPercent = (options.stopLossPercent || 2.0) / 100;
    const tpRatio = options.takeProfitRatio || 2.0;

    let balance = initialBalance;
    let peakBalance = initialBalance;
    let maxDrawdownUsd = 0;
    let maxDrawdownPercent = 0;

    const trades: Backtest['trades'] = [];
    const equityCurve: { time: string; equity: number }[] = [
      { time: new Date(candles[0]?.time || Date.now()).toISOString().split('T')[0], equity: initialBalance },
    ];

    let activeTrade: {
      entryPrice: number;
      quantity: number;
      stopLoss: number;
      takeProfit: number;
      entryTime: number;
      reason: string;
    } | null = null;

    // Simulation Loop through historical candles (no look-ahead)
    const lookback = 30;
    for (let i = lookback; i < candles.length; i++) {
      const currentCandle = candles[i];
      const prevCandles = candles.slice(i - lookback, i);
      const prevCloses = prevCandles.map((c) => c.close);

      // Check exit of existing trade first
      if (activeTrade) {
        let closed = false;
        let exitPrice = 0;
        let exitReason = '';

        // Check if Stop Loss was hit during the candle
        if (currentCandle.low <= activeTrade.stopLoss) {
          exitPrice = activeTrade.stopLoss * (1 - slippageRate);
          exitReason = 'STOP_LOSS';
          closed = true;
        } else if (currentCandle.high >= activeTrade.takeProfit) {
          // Check if Take Profit was hit
          exitPrice = activeTrade.takeProfit * (1 - slippageRate);
          exitReason = 'TAKE_PROFIT';
          closed = true;
        }

        if (closed) {
          const grossPnl = (exitPrice - activeTrade.entryPrice) * activeTrade.quantity;
          const entryFee = activeTrade.entryPrice * activeTrade.quantity * feeRate;
          const exitFee = exitPrice * activeTrade.quantity * feeRate;
          const netPnl = grossPnl - (entryFee + exitFee);
          const pnlPercent = (netPnl / (activeTrade.entryPrice * activeTrade.quantity)) * 100;

          balance += netPnl;
          if (balance > peakBalance) peakBalance = balance;
          const dd = ((peakBalance - balance) / peakBalance) * 100;
          if (dd > maxDrawdownPercent) {
            maxDrawdownPercent = dd;
            maxDrawdownUsd = peakBalance - balance;
          }

          trades.push({
            id: `bt_trd_${trades.length + 1}`,
            symbol: options.symbol,
            side: 'BUY',
            entryPrice: Math.round(activeTrade.entryPrice * 100) / 100,
            exitPrice: Math.round(exitPrice * 100) / 100,
            pnl: Math.round(netPnl * 100) / 100,
            pnlPercent: Math.round(pnlPercent * 100) / 100,
            entryTime: new Date(activeTrade.entryTime).toISOString(),
            exitTime: new Date(currentCandle.time).toISOString(),
            reason: exitReason,
          });

          equityCurve.push({
            time: new Date(currentCandle.time).toISOString().split('T')[0],
            equity: Math.round(balance * 100) / 100,
          });

          activeTrade = null;
        }
      }

      // If no active trade, evaluate entry signal based on strategy
      if (!activeTrade) {
        const signal = this.evaluateHistoricalSignal(prevCloses, currentCandle, options.strategyId);

        if (signal === 'BUY') {
          const entryPrice = currentCandle.close * (1 + slippageRate);
          const stopLoss = entryPrice * (1 - slPercent);
          const riskDistance = entryPrice - stopLoss;
          const takeProfit = entryPrice + riskDistance * tpRatio;

          const riskAmount = balance * riskPercent;
          const quantity = riskAmount / (entryPrice - stopLoss);

          if (quantity * entryPrice <= balance * 0.5) {
            activeTrade = {
              entryPrice,
              quantity,
              stopLoss,
              takeProfit,
              entryTime: currentCandle.time,
              reason: 'Strategy entry trigger verified',
            };
          }
        }
      }
    }

    // Force close active trade at end of data if any
    if (activeTrade && candles.length > 0) {
      const lastCandle = candles[candles.length - 1];
      const exitPrice = lastCandle.close * (1 - slippageRate);
      const grossPnl = (exitPrice - activeTrade.entryPrice) * activeTrade.quantity;
      const netPnl = grossPnl - (exitPrice * activeTrade.quantity * feeRate * 2);
      balance += netPnl;
      trades.push({
        id: `bt_trd_${trades.length + 1}`,
        symbol: options.symbol,
        side: 'BUY',
        entryPrice: activeTrade.entryPrice,
        exitPrice,
        pnl: Math.round(netPnl * 100) / 100,
        pnlPercent: Math.round(((exitPrice - activeTrade.entryPrice) / activeTrade.entryPrice) * 10000) / 100,
        entryTime: new Date(activeTrade.entryTime).toISOString(),
        exitTime: new Date(lastCandle.time).toISOString(),
        reason: 'BACKTEST_END_CLOSE',
      });
      equityCurve.push({
        time: new Date(lastCandle.time).toISOString().split('T')[0],
        equity: Math.round(balance * 100) / 100,
      });
    }

    // Calculate Metrics
    const winningTrades = trades.filter((t) => t.pnl > 0);
    const losingTrades = trades.filter((t) => t.pnl <= 0);

    const grossProfit = winningTrades.reduce((acc, t) => acc + t.pnl, 0);
    const grossLoss = Math.abs(losingTrades.reduce((acc, t) => acc + t.pnl, 0));

    const winRate = trades.length > 0 ? (winningTrades.length / trades.length) * 100 : 0;
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 9.99 : 0;
    const netProfit = balance - initialBalance;
    const netReturnPercent = (netProfit / initialBalance) * 100;

    const avgWin = winningTrades.length > 0 ? grossProfit / winningTrades.length : 0;
    const avgLoss = losingTrades.length > 0 ? grossLoss / losingTrades.length : 0;
    const largestWin = winningTrades.length > 0 ? Math.max(...winningTrades.map((t) => t.pnl)) : 0;
    const largestLoss = losingTrades.length > 0 ? Math.min(...losingTrades.map((t) => t.pnl)) : 0;

    // Sharpe Ratio approximation: mean return / standard deviation of returns * sqrt(252)
    const returns = trades.map((t) => t.pnlPercent / 100);
    const meanReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
    const variance =
      returns.length > 1
        ? returns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / (returns.length - 1)
        : 0;
    const stdDev = Math.sqrt(variance);
    const sharpeRatio = stdDev > 0 ? (meanReturn / stdDev) * Math.sqrt(Math.min(trades.length, 52)) : 0;

    return {
      id: `bt_${Date.now()}`,
      userId,
      symbol: options.symbol,
      timeframe: options.timeframe,
      startDate: options.startDate,
      endDate: options.endDate,
      strategyId: options.strategyId,
      initialBalance: Math.round(initialBalance * 100) / 100,
      finalBalance: Math.round(balance * 100) / 100,
      totalTrades: trades.length,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      winRate: Math.round(winRate * 10) / 10,
      netProfit: Math.round(netProfit * 100) / 100,
      netReturnPercent: Math.round(netReturnPercent * 100) / 100,
      maxDrawdownPercent: Math.round(maxDrawdownPercent * 100) / 100,
      profitFactor: Math.round(profitFactor * 100) / 100,
      sharpeRatio: Math.round(sharpeRatio * 100) / 100,
      averageTradeProfit: Math.round(avgWin * 100) / 100,
      averageTradeLoss: Math.round(avgLoss * 100) / 100,
      largestWin: Math.round(largestWin * 100) / 100,
      largestLoss: Math.round(largestLoss * 100) / 100,
      createdAt: new Date().toISOString(),
      equityCurve,
      trades,
    };
  }

  /**
   * Walk-Forward Analysis: Splits dataset into In-Sample (training/tuning)
   * and Out-of-Sample (unseen testing) to test strategy robustness
   */
  runWalkForwardAnalysis(userId: string, candles: KlineBar[], options: BacktestOptions): WalkForwardResult {
    const splitIndex = Math.floor(candles.length * 0.7); // 70% In-sample, 30% Out-of-sample
    const inSampleCandles = candles.slice(0, splitIndex);
    const outOfSampleCandles = candles.slice(splitIndex);

    const inSample = this.runBacktest(userId, inSampleCandles, {
      ...options,
      startDate: new Date(inSampleCandles[0]?.time || Date.now()).toISOString().split('T')[0],
      endDate: new Date(inSampleCandles[inSampleCandles.length - 1]?.time || Date.now()).toISOString().split('T')[0],
    });

    const outOfSample = this.runBacktest(userId, outOfSampleCandles, {
      ...options,
      initialBalance: inSample.finalBalance,
      startDate: new Date(outOfSampleCandles[0]?.time || Date.now()).toISOString().split('T')[0],
      endDate: new Date(outOfSampleCandles[outOfSampleCandles.length - 1]?.time || Date.now()).toISOString().split('T')[0],
    });

    const inSharpe = Math.max(0.1, inSample.sharpeRatio);
    const efficiencyRatio = Math.round((outOfSample.sharpeRatio / inSharpe) * 100) / 100;

    let robustnessVerdict: WalkForwardResult['robustnessVerdict'] = 'ROBUST';
    if (efficiencyRatio < 0.4 || outOfSample.profitFactor < 1.0) {
      robustnessVerdict = 'OVERFITTED';
    } else if (efficiencyRatio < 0.75) {
      robustnessVerdict = 'MODERATE';
    }

    return {
      inSample,
      outOfSample,
      efficiencyRatio,
      robustnessVerdict,
    };
  }

  private evaluateHistoricalSignal(prevCloses: number[], currentCandle: KlineBar, strategyId: string): 'BUY' | 'WAIT' {
    if (prevCloses.length < 20) return 'WAIT';
    const lastClose = currentCandle.close;

    // Fast EMA vs Slow EMA
    const sma9 = prevCloses.slice(-9).reduce((a, b) => a + b, 0) / 9;
    const sma21 = prevCloses.slice(-21).reduce((a, b) => a + b, 0) / 21;

    if (strategyId.includes('trend')) {
      // Golden cross with candle closing above both
      return sma9 > sma21 && lastClose > sma9 && currentCandle.volume > 100 ? 'BUY' : 'WAIT';
    }

    if (strategyId.includes('breakout')) {
      const recentHigh = Math.max(...prevCloses.slice(-15));
      return lastClose > recentHigh ? 'BUY' : 'WAIT';
    }

    if (strategyId.includes('fractal')) {
      const swingLow = Math.min(...prevCloses.slice(-10));
      return lastClose > swingLow * 1.01 && sma9 > sma21 ? 'BUY' : 'WAIT';
    }

    // Default trend test
    return sma9 > sma21 && lastClose > sma9 ? 'BUY' : 'WAIT';
  }
}

export const backtestingEngine = new BacktestingEngine();
