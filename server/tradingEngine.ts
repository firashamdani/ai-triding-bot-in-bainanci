import { db } from './db';
import { binanceClient } from './binance';
import { riskEngine } from './riskEngine';
import { buildBundle, getStrategy, type StrategyParams, type StrategySignal } from './strategies';
import { Position, Trade, Order } from './types';

/** Taker fee for Binance Spot. 0.1% standard, 0.075% when paying with BNB. */
const SPOT_FEE_RATE = Number(process.env.SPOT_FEE_RATE ?? 0.001);
/** Modelled slippage on market orders. */
const SLIPPAGE_RATE = Number(process.env.SLIPPAGE_RATE ?? 0.0005);

export interface AccountSummary {
  cash: number;
  committedCapital: number;
  equity: number;
  unrealizedPnlUsd: number;
  realizedPnlUsd: number;
  openPositions: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  exposurePercent: number;
  feeDragPercent: number;
}

/**
 * Direction-aware P&L.
 *
 * The previous implementation always used `(exit - entry) * qty`, which is the
 * LONG formula, and applied it to SELL positions too — every short recorded an
 * inverted profit/loss, and its SL/TP triggers were reversed as well.
 *
 * Note: Binance **Spot** cannot open shorts. SELL only makes sense as closing a
 * long you already hold, so `openPosition` rejects side=SELL outright. This
 * helper still handles both directions so legacy/seeded SELL rows (and any
 * future margin support) are accounted correctly instead of silently wrong.
 */
export function computePnl(side: 'BUY' | 'SELL', entryPrice: number, exitPrice: number, quantity: number): number {
  return side === 'BUY' ? (exitPrice - entryPrice) * quantity : (entryPrice - exitPrice) * quantity;
}

export function computePnlPercent(side: 'BUY' | 'SELL', entryPrice: number, exitPrice: number): number {
  if (entryPrice <= 0) return 0;
  const raw = side === 'BUY' ? (exitPrice - entryPrice) / entryPrice : (entryPrice - exitPrice) / entryPrice;
  return raw * 100;
}

/** True when `price` has breached the stop for this position's direction. */
function stopHit(pos: Position, high: number, low: number): boolean {
  if (!pos.stopLoss || pos.stopLoss <= 0) return false;
  return pos.side === 'BUY' ? low <= pos.stopLoss : high >= pos.stopLoss;
}

/** True when `price` has reached the target for this position's direction. */
function targetHit(pos: Position, target: number, high: number, low: number): boolean {
  if (!target || target <= 0) return false;
  return pos.side === 'BUY' ? high >= target : low <= target;
}

export class TradingEngine {
  /** Uncommitted cash. Equity = cash + market value of open positions. */
  private paperBalance = 10000.0;
  private capitalInitialized = false;
  private autoLoopHandle: NodeJS.Timeout | null = null;
  private lastAutoCycleAt = 0;
  public autoTradeLog: string[] = [];

  /**
   * Seeded demo positions are created directly in db.ts, so their notional was
   * never deducted from cash. Do it once, so equity starts at the advertised
   * $10,000 instead of being silently inflated by phantom capital.
   */
  private ensureCapitalInitialized() {
    if (this.capitalInitialized) return;
    this.capitalInitialized = true;
    let committed = 0;
    for (const pos of db.positions.values()) {
      if (pos.mode === 'PAPER') committed += pos.entryPrice * pos.quantity * (1 + SPOT_FEE_RATE);
    }
    if (committed > 0) {
      this.paperBalance = Math.max(100, this.paperBalance - committed);
    }
  }

  getPaperBalance(): number {
    this.ensureCapitalInitialized();
    return this.paperBalance;
  }

  setPaperBalance(amount: number) {
    this.ensureCapitalInitialized();
    this.paperBalance = Math.max(100, amount);
  }

  /** Total account value: cash plus the mark-to-market value of open positions. */
  getEquity(userId: string = 'usr_trader'): number {
    this.ensureCapitalInitialized();
    let marketValue = 0;
    for (const pos of db.positions.values()) {
      if (pos.mode !== 'PAPER') continue;
      if (userId && pos.userId !== userId) continue;
      marketValue += pos.currentPrice * pos.quantity;
    }
    return this.paperBalance + marketValue;
  }

  getAccountSummary(userId: string = 'usr_trader'): AccountSummary {
    this.ensureCapitalInitialized();
    let committed = 0;
    let unrealized = 0;
    let openPositions = 0;
    for (const pos of db.positions.values()) {
      if (pos.mode !== 'PAPER') continue;
      if (userId && pos.userId !== userId) continue;
      committed += pos.entryPrice * pos.quantity;
      unrealized += computePnl(pos.side, pos.entryPrice, pos.currentPrice, pos.quantity);
      openPositions++;
    }

    const trades = db.trades.filter((t) => !userId || t.userId === userId);
    const wins = trades.filter((t) => t.realizedPnlUsd > 0);
    const realized = trades.reduce((s, t) => s + t.realizedPnlUsd, 0);
    const fees = trades.reduce((s, t) => s + (t.feesPaid || 0), 0);
    const equity = this.getEquity(userId);

    return {
      cash: round(this.paperBalance),
      committedCapital: round(committed),
      equity: round(equity),
      unrealizedPnlUsd: round(unrealized),
      realizedPnlUsd: round(realized),
      openPositions,
      totalTrades: trades.length,
      winningTrades: wins.length,
      losingTrades: trades.length - wins.length,
      winRate: trades.length ? round((wins.length / trades.length) * 100) : 0,
      exposurePercent: equity > 0 ? round((committed / equity) * 100) : 0,
      feeDragPercent: equity > 0 ? round((fees / equity) * 100) : 0,
    };
  }

  /**
   * Open a new position.
   * LONG ONLY: Binance Spot has no shorting, so side=SELL is rejected with an
   * explanation instead of creating a position the exchange could never fill.
   */
  async openPosition(
    userId: string,
    params: {
      symbol: string;
      side: 'BUY' | 'SELL';
      mode: 'PAPER' | 'LIVE';
      quantity?: number;
      stopLoss?: number;
      takeProfit?: number;
      takeProfits?: number[];
      strategyId?: string;
      strategyName?: string;
      aiConfidence?: number;
      entryReason?: string;
      exitMode?: 'TP_SL' | 'SIGNAL';
    }
  ): Promise<{ success: boolean; position?: Position; error?: string; code?: string }> {
    this.ensureCapitalInitialized();

    const settings = db.botSettings.get(userId);
    if (!settings) {
      return { success: false, error: 'User bot configuration not found.', code: 'NO_SETTINGS' };
    }

    // ---- Spot constraint: no shorting ----
    if (params.side === 'SELL') {
      db.logAudit(
        userId,
        'ORDER_REJECTED',
        `Rejected SELL open on ${params.symbol}: Binance Spot does not support short selling. SELL is only valid for closing an existing long.`,
        'WARNING'
      );
      return {
        success: false,
        code: 'SHORT_NOT_SUPPORTED_ON_SPOT',
        error:
          'Binance Spot cannot open short positions. A SELL order only closes a long you already hold. ' +
          'To exit, close the position instead; to profit from a decline, the bot stays in cash.',
      };
    }

    if (!settings.isEnabled && params.mode === 'LIVE') {
      return { success: false, error: 'Trading Bot is currently disabled in settings.', code: 'BOT_DISABLED' };
    }

    // ---- Strict gating for live trading ----
    if (params.mode === 'LIVE') {
      if (!db.systemHealth.globalLiveTradingEnabled) {
        return {
          success: false,
          code: 'LIVE_GLOBALLY_DISABLED',
          error: 'Live Trading is disabled platform-wide by the Administrator. Use Paper Trading to test.',
        };
      }
      if (!binanceClient.hasCredentials(userId)) {
        return {
          success: false,
          code: 'NO_API_KEYS',
          error: 'No Binance API keys connected. Add them in Binance Connection first.',
        };
      }
      const connCheck = await binanceClient.testConnection(userId);
      if (!connCheck.success || connCheck.permissions.canWithdraw) {
        return { success: false, code: 'LIVE_SECURITY_CHECK_FAILED', error: `Live Trading Security Check Failed: ${connCheck.message}` };
      }
    }

    // ---- Global risk switches apply to paper too, so the demo behaves like live ----
    if (db.systemHealth.globalKillSwitchActive) {
      return { success: false, code: 'KILL_SWITCH', error: 'Global Kill Switch is active. All trading halted.' };
    }
    if (db.systemHealth.circuitBreakerTripped) {
      return { success: false, code: 'CIRCUIT_BREAKER', error: 'Circuit breaker is tripped. Reset it before opening new positions.' };
    }

    // ---- Live price ----
    const currentPrice = await binanceClient.getLatestPrice(params.symbol);

    const userPositions = Array.from(db.positions.values()).filter((p) => p.userId === userId);
    if (userPositions.some((p) => p.symbol === params.symbol)) {
      return {
        success: false,
        code: 'DUPLICATE_SYMBOL',
        error: `A position on ${params.symbol} is already open. Close it before re-entering.`,
      };
    }

    const effectiveBalance = params.mode === 'PAPER' ? this.getEquity(userId) : 10000;

    // ---- Volatility + structure context for the stop-loss model ----
    // Without these the ATR and STRUCTURE stop types silently degrade to a flat
    // percentage, which is exactly how stops get taken out by ordinary noise.
    let atrValue = 0;
    let structureStop = 0;
    try {
      const bars = await binanceClient.getKlines(params.symbol, settings.primaryTimeframe || '15m', 60);
      if (bars.length > 20) {
        atrValue = estimateAtr(bars, 14);
        const swingWindow = bars.slice(-21, -1);
        if (swingWindow.length) structureStop = Math.min(...swingWindow.map((b) => b.low));
      }
    } catch {
      atrValue = currentPrice * 0.015;
    }

    // ---- Risk engine ----
    const riskCheck = riskEngine.calculatePositionSize(
      userId,
      effectiveBalance,
      currentPrice,
      settings,
      userPositions.length,
      params.stopLoss,
      {
        committedNotional: userPositions.reduce((s, p) => s + p.entryPrice * p.quantity, 0),
        atrValue,
        structureStop,
        availableCash: params.mode === 'PAPER' ? this.paperBalance : undefined,
      }
    );

    if (!riskCheck.allowed) {
      return { success: false, code: 'RISK_REJECTED', error: `Risk Check Rejected: ${riskCheck.reason}` };
    }

    // Allow an explicit quantity override (manual trading UI), validated by the risk engine
    let quantity = riskCheck.quantity;
    if (params.quantity && params.quantity > 0) {
      quantity = params.quantity;
      const notional = quantity * currentPrice;
      if (notional > effectiveBalance * 0.95) {
        return { success: false, code: 'INSUFFICIENT_BALANCE', error: `Requested notional $${notional.toFixed(2)} exceeds available balance.` };
      }
    }

    const clientOrderId = `order_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    if (!riskEngine.checkIdempotency(clientOrderId)) {
      return { success: false, error: 'Duplicate order detected. Operation aborted.', code: 'DUPLICATE_ORDER' };
    }

    const entryPrice = currentPrice * (1 + SLIPPAGE_RATE);
    const notional = entryPrice * quantity;
    const entryFee = notional * SPOT_FEE_RATE;

    // ---- Paper: verify cash is actually available BEFORE committing ----
    if (params.mode === 'PAPER' && notional + entryFee > this.paperBalance) {
      return {
        success: false,
        code: 'INSUFFICIENT_CASH',
        error: `Insufficient cash: need $${(notional + entryFee).toFixed(2)}, have $${this.paperBalance.toFixed(2)}.`,
      };
    }

    // ---- Live: execute on Binance ----
    let binanceOrderId: string | undefined;
    if (params.mode === 'LIVE') {
      const liveOrderRes = await binanceClient.executeSpotOrder(userId, {
        symbol: params.symbol,
        side: params.side,
        type: 'MARKET',
        quantity,
        clientOrderId,
      });
      if (!liveOrderRes.success) {
        db.logAudit(userId, 'API_ERROR', `Binance order execution failed: ${liveOrderRes.error}`, 'ALERT');
        return { success: false, code: 'BINANCE_REJECTED', error: `Binance Execution Error: ${liveOrderRes.error}` };
      }
      binanceOrderId = liveOrderRes.orderId;
      if (liveOrderRes.sentQuantity) quantity = liveOrderRes.sentQuantity;
    }

    const orderRecord: Order = {
      id: `ord_${Date.now()}`,
      clientOrderId,
      symbol: params.symbol,
      side: params.side,
      type: 'MARKET',
      price: round6(entryPrice),
      quantity,
      status: 'FILLED',
      mode: params.mode,
      createdAt: new Date().toISOString(),
      binanceOrderId,
    };
    db.orders.unshift(orderRecord);

    const takeProfits =
      params.takeProfits && params.takeProfits.length > 0
        ? params.takeProfits
        : [params.takeProfit || riskCheck.takeProfitPrice, (params.takeProfit || riskCheck.takeProfitPrice) * 1.015];

    const positionId = `pos_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const newPosition: Position = {
      id: positionId,
      userId,
      symbol: params.symbol,
      side: params.side,
      mode: params.mode,
      quantity,
      entryPrice: round6(entryPrice),
      currentPrice: round6(entryPrice),
      stopLoss: round6(riskCheck.stopLossPrice),
      takeProfit1: round6(takeProfits[0]),
      takeProfit2: round6(takeProfits[1] ?? takeProfits[0] * 1.015),
      trailingStopActive: settings.stopLossType === 'TRAILING' || params.exitMode === 'SIGNAL',
      unrealizedPnlUsd: 0,
      unrealizedPnlPercent: 0,
      openedAt: new Date().toISOString(),
      strategy: params.strategyName || getStrategy(params.strategyId || '')?.name || 'Manual',
      aiConfidence: params.aiConfidence ?? 0,
      entryReason: params.entryReason || 'Manual entry with verified risk parameters',
      // --- bookkeeping the old engine never tracked ---
      strategyId: params.strategyId,
      exitMode: params.exitMode ?? 'TP_SL',
      entryNotional: round(notional),
      entryFeePaid: round(entryFee),
      highestSinceEntry: round6(entryPrice),
      lowestSinceEntry: round6(entryPrice),
      takeProfit1Filled: false,
      stopLossAtBreakeven: false,
      dataSource: binanceClient.lastDataSource,
    };

    db.positions.set(positionId, newPosition);

    // Commit capital + entry fee so exposure and equity stay honest
    if (params.mode === 'PAPER') {
      this.paperBalance -= notional + entryFee;
    }

    db.logAudit(
      userId,
      'TRADE_OPEN',
      `Opened ${params.mode} LONG ${quantity} ${params.symbol} @ $${round6(entryPrice)} (notional $${round(notional)}, fee $${round(entryFee)}, SL $${round6(riskCheck.stopLossPrice)}, TP1 $${round6(takeProfits[0])})`,
      'INFO'
    );
    db.addNotification(
      `Position Opened (${params.mode})`,
      `${params.symbol} LONG filled at $${round6(entryPrice)}. SL $${round6(riskCheck.stopLossPrice)} · TP1 $${round6(takeProfits[0])}.`,
      'TRADE'
    );

    return { success: true, position: newPosition };
  }

  /**
   * Close part of a position (used for the TP1 partial exit).
   */
  async closePartial(
    positionId: string,
    fraction: number,
    exitPriceRaw: number,
    reason: Trade['exitReason']
  ): Promise<{ success: boolean; trade?: Trade; error?: string }> {
    const pos = db.positions.get(positionId);
    if (!pos) return { success: false, error: 'Position not found' };
    if (fraction <= 0 || fraction >= 1) return { success: false, error: 'Partial fraction must be between 0 and 1' };

    const filters = await binanceClient.getSymbolFilters(pos.symbol);
    const closeQty = binanceClient.roundQuantity(pos.symbol, pos.quantity * fraction, filters);
    if (closeQty <= 0 || closeQty >= pos.quantity) {
      return { success: false, error: 'Partial size rounds to zero or the whole position at this step size' };
    }

    const exitPrice = exitPriceRaw * (1 - SLIPPAGE_RATE);
    const proceeds = exitPrice * closeQty;
    const exitFee = proceeds * SPOT_FEE_RATE;
    // Cost basis attributable to the slice being closed
    const costBasis = (pos.entryNotional ?? pos.entryPrice * pos.quantity) * (closeQty / pos.quantity) +
      (pos.entryFeePaid ?? 0) * (closeQty / pos.quantity);
    const netPnl = proceeds - exitFee - costBasis;

    if (pos.mode === 'PAPER') this.paperBalance += proceeds - exitFee;

    pos.quantity = round6(pos.quantity - closeQty);
    pos.entryNotional = round(pos.entryPrice * pos.quantity);

    const trade: Trade = {
      id: `trd_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      userId: pos.userId,
      symbol: pos.symbol,
      side: pos.side,
      mode: pos.mode,
      quantity: closeQty,
      entryPrice: pos.entryPrice,
      exitPrice: round6(exitPrice),
      stopLoss: pos.stopLoss,
      takeProfit: pos.takeProfit1,
      realizedPnlUsd: round(netPnl),
      realizedPnlPercent: round(computePnlPercent(pos.side, pos.entryPrice, exitPrice)),
      openedAt: pos.openedAt,
      closedAt: new Date().toISOString(),
      exitReason: reason,
      strategy: pos.strategy,
      aiConfidence: pos.aiConfidence,
      entryReason: pos.entryReason,
      riskRewardAchieved: formatR(pos.entryPrice, pos.stopLoss, exitPrice, pos.side),
      feesPaid: round(exitFee + costBasis * 0),
      isPartialClose: true,
    };

    db.trades.unshift(trade);
    riskEngine.recordTradeResult(pos.userId, netPnl);
    return { success: true, trade };
  }

  /**
   * Close an open position fully.
   * Fees are charged on BOTH legs and capital is released back to cash.
   */
  async closePosition(
    userId: string,
    positionId: string,
    exitReason: Trade['exitReason'] = 'MANUAL_CLOSE'
  ): Promise<{ success: boolean; trade?: Trade; error?: string }> {
    this.ensureCapitalInitialized();
    const position = db.positions.get(positionId);
    if (!position) return { success: false, error: 'Position not found' };

    const exitPriceRaw = await binanceClient.getLatestPrice(position.symbol);
    const exitPrice = exitPriceRaw * (1 - SLIPPAGE_RATE);

    const grossPnl = computePnl(position.side, position.entryPrice, exitPrice, position.quantity);
    const proceeds = exitPrice * position.quantity;
    const exitFee = proceeds * SPOT_FEE_RATE;
    const entryFee = position.entryFeePaid ?? position.entryPrice * position.quantity * SPOT_FEE_RATE;
    // Net PnL includes the entry fee, which the old engine never charged.
    const netPnl = grossPnl - exitFee - entryFee;
    const pnlPercent = computePnlPercent(position.side, position.entryPrice, exitPrice);

    if (position.mode === 'PAPER') {
      // Release sale proceeds. Entry notional was already deducted at open, so
      // the net effect on cash is exactly netPnl.
      this.paperBalance += proceeds - exitFee;
    }

    const trade: Trade = {
      id: `trd_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      userId: position.userId,
      symbol: position.symbol,
      side: position.side,
      mode: position.mode,
      quantity: position.quantity,
      entryPrice: position.entryPrice,
      exitPrice: round6(exitPrice),
      stopLoss: position.stopLoss,
      takeProfit: position.takeProfit1,
      realizedPnlUsd: round(netPnl),
      realizedPnlPercent: round(pnlPercent),
      openedAt: position.openedAt,
      closedAt: new Date().toISOString(),
      exitReason,
      strategy: position.strategy,
      aiConfidence: position.aiConfidence,
      entryReason: position.entryReason,
      // Computed from the real risk/reward achieved, not a hardcoded string
      riskRewardAchieved: formatR(position.entryPrice, position.stopLoss, exitPrice, position.side),
      feesPaid: round(exitFee + entryFee),
      holdingMs: Date.now() - new Date(position.openedAt).getTime(),
    };

    db.trades.unshift(trade);
    db.positions.delete(positionId);
    riskEngine.recordTradeResult(position.userId, netPnl);

    db.logAudit(
      userId,
      'TRADE_CLOSE',
      `Closed ${position.mode} ${position.symbol} @ $${round6(exitPrice)} (${exitReason}). Net PnL ${netPnl >= 0 ? '+' : ''}$${round(netPnl)} (${round(pnlPercent)}%), fees $${round(exitFee + entryFee)}.`,
      netPnl < 0 ? 'WARNING' : 'INFO'
    );
    db.addNotification(
      `Position Closed (${exitReason})`,
      `${position.symbol} closed at $${round6(exitPrice)}. Net PnL: ${netPnl >= 0 ? '+' : ''}$${round(netPnl)} (${round(pnlPercent)}%).`,
      'TRADE'
    );

    return { success: true, trade };
  }

  /**
   * Monitor open positions using the candle's HIGH/LOW (not just its close), so
   * stops and targets that were touched intrabar are actually honoured.
   */
  async updatePositionsWithMarketPrices(): Promise<void> {
    this.ensureCapitalInitialized();
    for (const [id, pos] of Array.from(db.positions.entries())) {
      try {
        const bars = await binanceClient.getKlines(pos.symbol, '5m', 3);
        const latest = bars[bars.length - 1];
        if (!latest) continue;

        pos.currentPrice = round6(latest.close);
        pos.unrealizedPnlUsd = round(computePnl(pos.side, pos.entryPrice, latest.close, pos.quantity));
        pos.unrealizedPnlPercent = round(computePnlPercent(pos.side, pos.entryPrice, latest.close));
        pos.dataSource = binanceClient.lastDataSource;

        const high = Math.max(...bars.slice(-2).map((b) => b.high));
        const low = Math.min(...bars.slice(-2).map((b) => b.low));
        if (pos.side === 'BUY') {
          pos.highestSinceEntry = Math.max(pos.highestSinceEntry ?? pos.entryPrice, high);
        } else {
          pos.lowestSinceEntry = Math.min(pos.lowestSinceEntry ?? pos.entryPrice, low);
        }

        // ---- Partial take profit at TP1, then move the stop to break-even ----
        if (!pos.takeProfit1Filled && targetHit(pos, pos.takeProfit1, high, low)) {
          const partial = await this.closePartial(id, 0.5, pos.takeProfit1, 'TAKE_PROFIT');
          if (partial.success) {
            pos.takeProfit1Filled = true;
            if (!pos.stopLossAtBreakeven) {
              pos.stopLoss = round6(pos.entryPrice);
              pos.stopLossAtBreakeven = true;
            }
            db.addNotification(
              'Partial Take Profit Filled',
              `${pos.symbol}: closed 50% at TP1 $${round6(pos.takeProfit1)}. Stop moved to break-even; remainder runs to TP2 $${round6(pos.takeProfit2)}.`,
              'TRADE'
            );
            continue;
          }
        }

        // ---- Stop loss (worst-case ordering: checked before TP2) ----
        if (stopHit(pos, high, low)) {
          await this.closePosition(pos.userId, id, pos.stopLossAtBreakeven ? 'BREAKEVEN_STOP' : 'STOP_LOSS');
          continue;
        }

        // ---- Final target ----
        if (targetHit(pos, pos.takeProfit2, high, low)) {
          await this.closePosition(pos.userId, id, 'TAKE_PROFIT');
          continue;
        }

        // ---- Trailing stop: ratchet only, never loosen ----
        if (pos.trailingStopActive) {
          const atrBars = await binanceClient.getKlines(pos.symbol, '15m', 30);
          const atrVal = estimateAtr(atrBars);
          if (pos.side === 'BUY') {
            const activated = latest.close > pos.entryPrice * 1.015;
            if (activated && atrVal > 0) {
              const candidate = (pos.highestSinceEntry ?? latest.close) - 2.5 * atrVal;
              if (candidate > pos.stopLoss) {
                pos.stopLoss = round6(candidate);
                pos.trailingStopActive = true;
              }
            }
          } else {
            const activated = latest.close < pos.entryPrice * 0.985;
            if (activated && atrVal > 0) {
              const candidate = (pos.lowestSinceEntry ?? latest.close) + 2.5 * atrVal;
              if (candidate < pos.stopLoss) pos.stopLoss = round6(candidate);
            }
          }
        }

        // ---- Signal-driven exits for strategies like Turtle / RSI(2) / Supertrend ----
        if (pos.exitMode === 'SIGNAL' && pos.strategyId) {
          const strategy = getStrategy(pos.strategyId);
          if (strategy?.checkExit) {
            const bars = await binanceClient.getKlines(pos.symbol, '15m', 400);
            if (bars.length > strategy.minBars) {
              const bundle = buildBundle(bars, strategy.defaultParams as StrategyParams);
              const shouldExit = strategy.checkExit(bundle, bars.length - 1, strategy.defaultParams, {
                entryPrice: pos.entryPrice,
                entryIndex: bars.length - 2,
                stopLoss: pos.stopLoss,
                takeProfits: [pos.takeProfit1, pos.takeProfit2],
                highestSinceEntry: pos.highestSinceEntry ?? pos.entryPrice,
              });
              if (shouldExit) {
                await this.closePosition(pos.userId, id, 'SIGNAL_EXIT');
                continue;
              }
            }
          }
        }
      } catch {
        // Keep monitoring other positions even if one fails
      }
    }
  }

  /**
   * THE AUTONOMOUS TRADING LOOP.
   *
   * This did not exist before: nothing ever called openPosition automatically,
   * so `isEnabled`, `selectedSymbols`, `activeStrategies` and
   * `aiAnalysisIntervalSec` were dead settings and the "bot" never traded.
   */
  async runAutoTradingCycle(userId: string = 'usr_trader', now = Date.now()): Promise<{
    ran: boolean;
    reason?: string;
    signalsFound: number;
    ordersOpened: number;
    details: string[];
  }> {
    const settings = db.botSettings.get(userId);
    const details: string[] = [];

    if (!settings) return { ran: false, reason: 'NO_SETTINGS', signalsFound: 0, ordersOpened: 0, details };
    if (!settings.isEnabled) return { ran: false, reason: 'BOT_DISABLED', signalsFound: 0, ordersOpened: 0, details };
    if (db.systemHealth.globalKillSwitchActive)
      return { ran: false, reason: 'KILL_SWITCH_ACTIVE', signalsFound: 0, ordersOpened: 0, details };
    if (db.systemHealth.circuitBreakerTripped)
      return { ran: false, reason: 'CIRCUIT_BREAKER_TRIPPED', signalsFound: 0, ordersOpened: 0, details };
    if (db.systemHealth.tradingEngineStatus === 'EMERGENCY_STOPPED')
      return { ran: false, reason: 'EMERGENCY_STOPPED', signalsFound: 0, ordersOpened: 0, details };

    const intervalMs = Math.max(10, settings.aiAnalysisIntervalSec || 60) * 1000;
    if (now - this.lastAutoCycleAt < intervalMs) {
      return { ran: false, reason: 'INTERVAL_NOT_ELAPSED', signalsFound: 0, ordersOpened: 0, details };
    }
    this.lastAutoCycleAt = now;

    const openPositions = Array.from(db.positions.values()).filter((p) => p.userId === userId);
    const heldSymbols = new Set(openPositions.map((p) => p.symbol));

    let signalsFound = 0;
    let ordersOpened = 0;

    for (const symbol of settings.selectedSymbols) {
      if (heldSymbols.has(symbol)) continue;
      if (openPositions.length + ordersOpened >= settings.maxOpenTrades) {
        details.push(`${symbol}: skipped, max open trades reached`);
        break;
      }

      try {
        let bestSignal: {
          strategyId: string;
          timeframe: string;
          signal: StrategySignal;
          score: number;
        } | null = null;

        for (const strategyId of settings.activeStrategies) {
          const strategy = getStrategy(strategyId);
          if (!strategy) continue;

          // Evaluate each system on the timeframe it was designed for, not on one
          // global setting. This is the single largest performance lever measured
          // in scripts/validate.ts (section C): the same rules swing from losing
          // to winning purely by using the correct bar size.
          const timeframe = strategy.recommendedTimeframes?.[0] ?? settings.primaryTimeframe;
          const bars = await binanceClient.getKlines(symbol, timeframe, 600);
          if (bars.length < Math.max(strategy.minBars, 220)) {
            details.push(`${symbol}/${strategyId}: skipped, ${bars.length} ${timeframe} candles (need ${Math.max(strategy.minBars, 220)}+)`);
            continue;
          }

          const params = { ...strategy.defaultParams, ...(db.strategyParams?.get(strategyId) ?? {}) };
          const bundle = buildBundle(bars, params);
          const sig = strategy.evaluate(bundle, bars.length - 1, params);
          if (!sig) continue;

          signalsFound++;
          if (!bestSignal || sig.confidence > bestSignal.score) {
            bestSignal = { strategyId, timeframe, signal: sig, score: sig.confidence };
          }
        }

        if (!bestSignal) continue;

        if (bestSignal.score < settings.minAiConfidence) {
          details.push(
            `${symbol}: ${bestSignal.strategyId} signalled with confidence ${bestSignal.score} < required ${settings.minAiConfidence} — skipped`
          );
          continue;
        }

        const res = await this.openPosition(userId, {
          symbol,
          side: 'BUY',
          mode: settings.mode,
          stopLoss: bestSignal.signal.stopLoss,
          takeProfits: bestSignal.signal.takeProfits,
          strategyId: bestSignal.strategyId,
          strategyName: `${getStrategy(bestSignal.strategyId)?.name} [${bestSignal.timeframe}]`,
          aiConfidence: bestSignal.score,
          entryReason: bestSignal.signal.reason,
          exitMode: bestSignal.signal.exitMode,
        });

        if (res.success) {
          ordersOpened++;
          details.push(`${symbol}: OPENED via ${bestSignal.strategyId} on ${bestSignal.timeframe} (confidence ${bestSignal.score})`);
          this.logAuto(`[${new Date().toISOString()}] OPEN ${symbol} ${bestSignal.strategyId} ${bestSignal.timeframe} conf=${bestSignal.score}`);
        } else {
          details.push(`${symbol}: ${bestSignal.strategyId} signal rejected — ${res.error}`);
          this.logAuto(`[${new Date().toISOString()}] REJECT ${symbol} ${bestSignal.strategyId}: ${res.error}`);
        }
      } catch (err) {
        details.push(`${symbol}: cycle error ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    db.systemHealth.lastAutoCycleAt = new Date(now).toISOString();
    db.systemHealth.autoTradingActive = settings.isEnabled;
    return { ran: true, signalsFound, ordersOpened, details };
  }

  /** Allow the next auto cycle to run immediately (used by the manual trigger). */
  forceAutoCycle() {
    this.lastAutoCycleAt = 0;
  }

  private logAuto(line: string) {
    this.autoTradeLog.unshift(line);
    if (this.autoTradeLog.length > 200) this.autoTradeLog.pop();
  }

  /** Start the background loops (position management + autonomous trading). */
  startBackgroundLoops(positionIntervalMs = 10000, autoTradeIntervalMs = 15000) {
    if (this.autoLoopHandle) return;

    setInterval(async () => {
      try {
        await this.updatePositionsWithMarketPrices();
      } catch {
        /* keep looping */
      }
    }, positionIntervalMs);

    this.autoLoopHandle = setInterval(async () => {
      try {
        for (const userId of db.botSettings.keys()) {
          await this.runAutoTradingCycle(userId);
        }
      } catch {
        /* keep looping */
      }
    }, autoTradeIntervalMs);
  }

  stopBackgroundLoops() {
    if (this.autoLoopHandle) {
      clearInterval(this.autoLoopHandle);
      this.autoLoopHandle = null;
    }
  }
}

/** Simple ATR(14) estimate used for trailing-stop distance. */
function estimateAtr(bars: { high: number; low: number; close: number }[], period = 14): number {
  if (bars.length < period + 1) return 0;
  let sum = 0;
  for (let i = bars.length - period; i < bars.length; i++) {
    const prevClose = bars[i - 1].close;
    sum += Math.max(bars[i].high - bars[i].low, Math.abs(bars[i].high - prevClose), Math.abs(bars[i].low - prevClose));
  }
  return sum / period;
}

/** Express the achieved result as an honest R multiple, e.g. "+2.1R". */
function formatR(entry: number, stop: number, exit: number, side: 'BUY' | 'SELL'): string {
  const risk = side === 'BUY' ? entry - stop : stop - entry;
  if (!Number.isFinite(risk) || risk <= 0) return 'n/a';
  const reward = side === 'BUY' ? exit - entry : entry - exit;
  const r = reward / risk;
  return `${r >= 0 ? '+' : ''}${r.toFixed(2)}R`;
}

const round = (v: number) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : 0);
const round6 = (v: number) => (Number.isFinite(v) ? Math.round(v * 1e6) / 1e6 : 0);

export const tradingEngine = new TradingEngine();
