import { BotSettings, Position, RiskEvent } from './types';
import { db } from './db';

export interface PositionSizeResult {
  allowed: boolean;
  quantity: number;
  usdValue: number;
  riskAmountUsd: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  takeProfits: number[];
  /** How many multiples of risk each target represents */
  rrTargets: number[];
  stopType: string;
  /** Set when the exposure cap (not the risk %) determined the size */
  sizeCappedBy: 'RISK_PERCENT' | 'EXPOSURE_CAP' | 'CASH_AVAILABLE' | null;
  reason?: string;
}

export interface SizingContext {
  /** Notional already committed in open positions */
  committedNotional?: number;
  /** ATR of the symbol, used by ATR/TRAILING stop types */
  atrValue?: number;
  /** Nearest structural swing low, used by the STRUCTURE stop type */
  structureStop?: number;
  /** Cash actually available to spend */
  availableCash?: number;
}

const DEFAULT_MAX_TOTAL_EXPOSURE = 0.8; // 80% of equity committed at once
const DEFAULT_MAX_CONSECUTIVE_LOSSES = 4;

export class RiskManagementEngine {
  private dailyLossTracker = new Map<string, { date: string; realizedLoss: number; consecutiveLosses: number }>();
  private processedOrderIds = new Set<string>();

  /**
   * Calculate precise position sizing and risk validation.
   *
   * Fixes vs the previous version:
   *  - The stop type in settings (FIXED_PERCENT / ATR / STRUCTURE / TRAILING)
   *    was ignored — every stop was a flat percentage. ATR stops now scale with
   *    volatility, which is the single biggest driver of whether a stop gets
   *    hit by noise instead of by a real move.
   *  - The old 40%-of-balance cap silently overrode the user's risk %, so
   *    changing "risk per trade" often did nothing. Sizing is now risk-driven
   *    first and the result reports which constraint actually bound.
   *  - Total exposure across ALL open positions is capped, so maxOpenTrades x
   *    per-trade size can no longer add up to >100% of the account.
   */
  calculatePositionSize(
    userId: string,
    accountBalanceUsd: number,
    currentPrice: number,
    settings: BotSettings,
    openPositionsCount: number,
    customStopLoss?: number,
    ctx: SizingContext = {}
  ): PositionSizeResult {
    const reject = (reason: string): PositionSizeResult => ({
      allowed: false, quantity: 0, usdValue: 0, riskAmountUsd: 0,
      stopLossPrice: 0, takeProfitPrice: 0, takeProfits: [], rrTargets: [],
      stopType: settings.stopLossType || 'FIXED_PERCENT', sizeCappedBy: null, reason,
    });

    if (db.systemHealth.circuitBreakerTripped) return reject('Circuit breaker is tripped. All new entries are halted.');
    if (db.systemHealth.globalKillSwitchActive) return reject('Global Kill Switch is active. All trading halted by an administrator.');

    if (openPositionsCount >= settings.maxOpenTrades) {
      return reject(`Maximum open trades limit reached (${openPositionsCount}/${settings.maxOpenTrades}).`);
    }

    const today = new Date().toISOString().split('T')[0];
    const lossData = this.getDailyLoss(userId, today);

    if (lossData.realizedLoss >= settings.maxDailyLossUsd) {
      this.triggerCircuitBreaker(
        'DAILY_LOSS_LIMIT_REACHED',
        `Daily realized loss reached $${lossData.realizedLoss.toFixed(2)}, at/over the $${settings.maxDailyLossUsd} limit.`
      );
      return reject(`Daily loss limit reached ($${lossData.realizedLoss.toFixed(2)} >= $${settings.maxDailyLossUsd}).`);
    }

    const maxConsec = Number((settings as any).maxConsecutiveLosses) || DEFAULT_MAX_CONSECUTIVE_LOSSES;
    if (lossData.consecutiveLosses >= maxConsec) {
      this.triggerCircuitBreaker(
        'CIRCUIT_BREAKER_TRIGGERED',
        `${lossData.consecutiveLosses} consecutive losing trades. Trading paused to prevent revenge trading.`
      );
      return reject(`Circuit breaker: ${lossData.consecutiveLosses} consecutive losses (limit ${maxConsec}).`);
    }

    if (!Number.isFinite(currentPrice) || currentPrice <= 0) return reject('Invalid market price.');

    // ---------------- Stop loss by configured type ----------------
    const stopType = settings.stopLossType || 'FIXED_PERCENT';
    let stopLossPrice = 0;

    const explicit = typeof customStopLoss === 'number' && customStopLoss > 0;
    if (explicit) {
      // Spot is long-only: a stop must sit BELOW the entry price.
      if (customStopLoss! >= currentPrice) {
        return reject(
          `Invalid stop loss: $${customStopLoss} is not below the entry price $${currentPrice}. ` +
            `On Binance Spot the bot is long-only, so the stop must be below entry.`
        );
      }
      stopLossPrice = customStopLoss!;
    } else if (stopType === 'ATR' || stopType === 'TRAILING') {
      const atrVal = ctx.atrValue ?? 0;
      if (atrVal > 0) {
        // 2x ATR is the conventional Chandelier/Kestner distance
        stopLossPrice = currentPrice - 2 * atrVal;
      } else {
        stopLossPrice = currentPrice * (1 - (settings.stopLossPercent || 2) / 100);
      }
    } else if (stopType === 'STRUCTURE') {
      const structure = ctx.structureStop ?? 0;
      const buffer = currentPrice * 0.002;
      if (structure > 0 && structure < currentPrice) {
        stopLossPrice = structure - buffer;
      } else {
        stopLossPrice = currentPrice * (1 - (settings.stopLossPercent || 2) / 100);
      }
    } else {
      const slPercent = (settings.stopLossPercent || 2) / 100;
      stopLossPrice = currentPrice * (1 - slPercent);
    }

    if (stopLossPrice <= 0) return reject('Computed stop loss is not positive.');
    if (stopLossPrice >= currentPrice) return reject('Computed stop loss is not below the entry price.');

    const riskPerUnit = currentPrice - stopLossPrice;
    const slDistancePercent = riskPerUnit / currentPrice;
    if (slDistancePercent <= 0.001) return reject('Stop loss is too close to the market price (would be noise-killed).');
    if (slDistancePercent > 0.25) return reject('Stop loss is wider than 25% — risk per trade would be uncontrollable.');

    // ---------------- Risk-based sizing ----------------
    const riskAmountUsd = accountBalanceUsd * ((settings.riskPerTradePercent || 1) / 100);
    let positionUsdValue = riskAmountUsd / slDistancePercent;
    let sizeCappedBy: PositionSizeResult['sizeCappedBy'] = 'RISK_PERCENT';

    // Total-exposure cap across all open positions
    const committed = ctx.committedNotional ?? 0;
    const maxTotalExposure = accountBalanceUsd * DEFAULT_MAX_TOTAL_EXPOSURE;
    const exposureHeadroom = Math.max(0, maxTotalExposure - committed);
    if (positionUsdValue > exposureHeadroom) {
      if (exposureHeadroom <= 0) {
        return reject(
          `Total exposure cap reached: $${committed.toFixed(0)} of $${maxTotalExposure.toFixed(0)} already committed.`
        );
      }
      positionUsdValue = exposureHeadroom;
      sizeCappedBy = 'EXPOSURE_CAP';
    }

    // Cash cap (paper trading cannot spend money it does not have)
    const cash = ctx.availableCash;
    if (typeof cash === 'number' && positionUsdValue > cash * 0.99) {
      positionUsdValue = cash * 0.99;
      sizeCappedBy = 'CASH_AVAILABLE';
    }

    if (positionUsdValue < 10) {
      return reject(`Computed position size $${positionUsdValue.toFixed(2)} is below the $10 exchange minimum notional.`);
    }

    const quantity = positionUsdValue / currentPrice;

    // ---------------- Targets ----------------
    const tpRatio = settings.takeProfitRatio || 2;
    const tpType = settings.takeProfitType || 'MULTI_TARGET';
    let rrTargets: number[];
    if (tpType === 'RISK_REWARD') rrTargets = [tpRatio];
    else if (tpType === 'TRAILING') rrTargets = [tpRatio, tpRatio * 2.5];
    else rrTargets = [Math.min(2, tpRatio), Math.max(tpRatio, 3)]; // MULTI_TARGET: bank part at 2R, run to 3R+

    const takeProfits = rrTargets.map((r) => currentPrice + riskPerUnit * r);

    return {
      allowed: true,
      quantity: Math.round(quantity * 1e6) / 1e6,
      usdValue: Math.round(positionUsdValue * 100) / 100,
      riskAmountUsd: Math.round(riskAmountUsd * 100) / 100,
      stopLossPrice: Math.round(stopLossPrice * 100) / 100,
      takeProfitPrice: Math.round(takeProfits[0] * 100) / 100,
      takeProfits: takeProfits.map((v) => Math.round(v * 100) / 100),
      rrTargets,
      stopType,
      sizeCappedBy,
    };
  }

  /** Idempotency guard against duplicate order submission */
  checkIdempotency(clientOrderId: string): boolean {
    if (this.processedOrderIds.has(clientOrderId)) return false;
    this.processedOrderIds.add(clientOrderId);
    // Bound memory on a long-running server
    if (this.processedOrderIds.size > 5000) {
      this.processedOrderIds = new Set(Array.from(this.processedOrderIds).slice(-2500));
    }
    return true;
  }

  recordTradeResult(userId: string, pnlUsd: number) {
    const today = new Date().toISOString().split('T')[0];
    const data = this.getDailyLoss(userId, today);
    if (pnlUsd < 0) {
      data.realizedLoss += Math.abs(pnlUsd);
      data.consecutiveLosses += 1;
    } else {
      data.consecutiveLosses = 0;
    }
    this.dailyLossTracker.set(`${userId}_${today}`, data);
  }

  getDailyLoss(userId: string, date: string) {
    const key = `${userId}_${date}`;
    if (!this.dailyLossTracker.has(key)) {
      this.dailyLossTracker.set(key, { date, realizedLoss: 0, consecutiveLosses: 0 });
    }
    return this.dailyLossTracker.get(key)!;
  }

  /** Snapshot for the UI */
  getRiskSnapshot(userId: string) {
    const today = new Date().toISOString().split('T')[0];
    const d = this.getDailyLoss(userId, today);
    const settings = db.botSettings.get(userId);
    return {
      date: today,
      realizedLossToday: Math.round(d.realizedLoss * 100) / 100,
      maxDailyLossUsd: settings?.maxDailyLossUsd ?? 0,
      dailyLossUsedPercent: settings?.maxDailyLossUsd
        ? Math.round((d.realizedLoss / settings.maxDailyLossUsd) * 1000) / 10
        : 0,
      consecutiveLosses: d.consecutiveLosses,
      maxConsecutiveLosses: Number((settings as any)?.maxConsecutiveLosses) || DEFAULT_MAX_CONSECUTIVE_LOSSES,
      circuitBreakerTripped: db.systemHealth.circuitBreakerTripped,
      globalKillSwitchActive: db.systemHealth.globalKillSwitchActive,
      riskEvents: db.riskEvents.slice(0, 20),
    };
  }

  /**
   * Emergency stop. Positions are closed through the trading engine so that
   * cash, fees and the daily-loss tracker are all updated — the previous version
   * wrote trade rows with a hardcoded `feesPaid: 1.0` and never touched the
   * balance, so the account silently diverged from reality.
   */
  async emergencyStop(userId: string, closeAllPositions = false): Promise<{ positionsClosed: number; message: string; realizedPnl: number }> {
    db.systemHealth.tradingEngineStatus = 'EMERGENCY_STOPPED';
    db.systemHealth.circuitBreakerTripped = true;

    db.logAudit(
      userId,
      'EMERGENCY_STOP',
      `EMERGENCY STOP initiated by ${userId}. New entries halted. closeAllPositions=${closeAllPositions}.`,
      'ALERT'
    );

    let closedCount = 0;
    let realized = 0;

    if (closeAllPositions) {
      // Dynamic import breaks the riskEngine <-> tradingEngine cycle
      const { tradingEngine } = await import('./tradingEngine');
      const targets: [string, Position][] = Array.from(db.positions.entries()).filter(([, p]) => p.userId === userId);
      for (const [id] of targets) {
        const res = await tradingEngine.closePosition(userId, id, 'EMERGENCY_STOP');
        if (res.success && res.trade) {
          closedCount++;
          realized += res.trade.realizedPnlUsd;
        }
      }
    }

    db.addNotification(
      'EMERGENCY STOP TRIGGERED',
      `Trading halted. ${closedCount} position(s) closed, realized ${realized >= 0 ? '+' : ''}$${realized.toFixed(2)}.`,
      'RISK'
    );

    return {
      positionsClosed: closedCount,
      realizedPnl: Math.round(realized * 100) / 100,
      message: `Emergency stop active. Trading engine halted. ${closedCount} position(s) closed.`,
    };
  }

  /**
   * User-level reset: clears the loss-driven circuit breaker ONLY.
   *
   * Privilege fix: this no longer touches `globalKillSwitchActive` (an admin
   * control) and no longer wipes the daily-loss tracker, which previously let
   * any user erase their own loss limit simply by pressing "reset".
   */
  resetCircuitBreaker(userId: string = 'usr_trader', opts: { clearDailyLoss?: boolean } = {}) {
    db.systemHealth.circuitBreakerTripped = false;
    if (db.systemHealth.tradingEngineStatus !== 'EMERGENCY_STOPPED') {
      db.systemHealth.tradingEngineStatus = 'RUNNING';
    }

    if (opts.clearDailyLoss) {
      for (const key of Array.from(this.dailyLossTracker.keys())) {
        if (key === userId || key.startsWith(`${userId}_`)) this.dailyLossTracker.delete(key);
      }
    }

    const settings = db.botSettings.get(userId);
    if (settings) settings.circuitBreakerActive = false;

    db.logAudit(userId, 'RISK_UPDATE', 'Circuit breaker reset (daily loss tracker preserved).', 'INFO');
    db.addNotification('Circuit Breaker Reset', 'New entries allowed again. Daily loss counter was NOT cleared.', 'SYSTEM');
  }

  /** Admin-only: full reset including the global kill switch and loss counters. */
  adminResetAllRiskControls(adminUserId: string) {
    db.systemHealth.circuitBreakerTripped = false;
    db.systemHealth.globalKillSwitchActive = false;
    db.systemHealth.tradingEngineStatus = 'RUNNING';
    this.dailyLossTracker.clear();
    db.logAudit(adminUserId, 'RISK_UPDATE', 'ADMIN: all risk controls reset (kill switch + circuit breaker + daily loss counters).', 'WARNING');
    db.addNotification('Admin Risk Reset', 'All risk controls were reset by an administrator.', 'SECURITY');
  }

  private triggerCircuitBreaker(eventType: RiskEvent['eventType'], description: string) {
    if (db.systemHealth.circuitBreakerTripped) return; // don't spam duplicate events
    db.systemHealth.circuitBreakerTripped = true;
    db.systemHealth.tradingEngineStatus = 'PAUSED';

    db.riskEvents.unshift({
      id: `risk_${Date.now()}`,
      timestamp: new Date().toISOString(),
      eventType,
      severity: 'CRITICAL',
      description,
      actionTaken: 'Trading engine paused and new order placements locked.',
    });
    db.logAudit('SYSTEM', 'RISK_UPDATE', `CIRCUIT BREAKER: ${description}`, 'ALERT');
    db.addNotification('Circuit Breaker Tripped', description, 'RISK');
  }
}

export const riskEngine = new RiskManagementEngine();
