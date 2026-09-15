import { BotSettings, Position, RiskEvent } from './types';
import { db } from './db';

export interface PositionSizeResult {
  allowed: boolean;
  quantity: number;
  usdValue: number;
  riskAmountUsd: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  reason?: string;
}

export class RiskManagementEngine {
  private dailyLossTracker = new Map<string, { date: string; realizedLoss: number; consecutiveLosses: number }>();
  private processedOrderIds = new Set<string>(); // Idempotency protection

  /**
   * Calculate precise position sizing and risk validation
   */
  calculatePositionSize(
    userId: string,
    accountBalanceUsd: number,
    currentPrice: number,
    settings: BotSettings,
    openPositionsCount: number,
    customStopLoss?: number
  ): PositionSizeResult {
    // 1. Check Circuit Breaker & Kill Switch
    if (db.systemHealth.circuitBreakerTripped || db.systemHealth.globalKillSwitchActive) {
      return {
        allowed: false,
        quantity: 0,
        usdValue: 0,
        riskAmountUsd: 0,
        stopLossPrice: 0,
        takeProfitPrice: 0,
        reason: 'Circuit Breaker or Global Kill Switch is active. All trading halted.',
      };
    }

    // 2. Max Open Trades Check
    if (openPositionsCount >= settings.maxOpenTrades) {
      return {
        allowed: false,
        quantity: 0,
        usdValue: 0,
        riskAmountUsd: 0,
        stopLossPrice: 0,
        takeProfitPrice: 0,
        reason: `Maximum open trades limit reached (${openPositionsCount}/${settings.maxOpenTrades}).`,
      };
    }

    // 3. Daily Loss Check
    const today = new Date().toISOString().split('T')[0];
    const userLossData = this.getDailyLoss(userId, today);
    if (userLossData.realizedLoss >= settings.maxDailyLossUsd) {
      this.triggerCircuitBreaker(
        'DAILY_LOSS_LIMIT_REACHED',
        `Daily loss reached $${userLossData.realizedLoss.toFixed(2)} exceeding limit of $${settings.maxDailyLossUsd}.`
      );
      return {
        allowed: false,
        quantity: 0,
        usdValue: 0,
        riskAmountUsd: 0,
        stopLossPrice: 0,
        takeProfitPrice: 0,
        reason: `Daily loss limit exceeded ($${userLossData.realizedLoss.toFixed(2)} >= $${settings.maxDailyLossUsd}).`,
      };
    }

    // 4. Consecutive Losses Circuit Breaker (e.g. 4 consecutive losses)
    if (userLossData.consecutiveLosses >= 4) {
      this.triggerCircuitBreaker(
        'CIRCUIT_BREAKER_TRIGGERED',
        `4 consecutive losing trades detected. Circuit breaker triggered to prevent revenge trading.`
      );
      return {
        allowed: false,
        quantity: 0,
        usdValue: 0,
        riskAmountUsd: 0,
        stopLossPrice: 0,
        takeProfitPrice: 0,
        reason: 'Circuit breaker triggered due to 4 consecutive losing trades.',
      };
    }

    // 5. Calculate Stop Loss Price based on selected type
    if (customStopLoss !== undefined && customStopLoss !== null && customStopLoss > 0) {
      if (customStopLoss >= currentPrice) {
        return {
          allowed: false,
          quantity: 0,
          usdValue: 0,
          riskAmountUsd: 0,
          stopLossPrice: 0,
          takeProfitPrice: 0,
          reason: `Invalid Stop Loss: Stop loss ($${customStopLoss}) cannot be higher than or equal to buy entry price ($${currentPrice}).`,
        };
      }
    }

    let stopLossPrice = 0;
    if (customStopLoss && customStopLoss > 0 && customStopLoss < currentPrice) {
      stopLossPrice = customStopLoss;
    } else {
      const slPercent = (settings.stopLossPercent || 2.0) / 100;
      stopLossPrice = currentPrice * (1 - slPercent);
    }

    const slDistancePercent = (currentPrice - stopLossPrice) / currentPrice;
    if (slDistancePercent <= 0.001) {
      return {
        allowed: false,
        quantity: 0,
        usdValue: 0,
        riskAmountUsd: 0,
        stopLossPrice: 0,
        takeProfitPrice: 0,
        reason: 'Stop loss is too close to current market price.',
      };
    }

    // 6. Risk-based position sizing formula:
    // Risk Amount = Balance * (Risk% / 100)
    // Position Size ($) = Risk Amount / SL Distance %
    const riskAmountUsd = accountBalanceUsd * (settings.riskPerTradePercent / 100);
    let positionUsdValue = riskAmountUsd / slDistancePercent;

    // Cap position size at max 40% of balance for prudent diversification
    const maxAllowedPositionUsd = accountBalanceUsd * 0.4;
    if (positionUsdValue > maxAllowedPositionUsd) {
      positionUsdValue = maxAllowedPositionUsd;
    }

    const quantity = positionUsdValue / currentPrice;

    // 7. Calculate Take Profit Price
    const riskDistance = currentPrice - stopLossPrice;
    const tpRatio = settings.takeProfitRatio || 2.0;
    const takeProfitPrice = currentPrice + riskDistance * tpRatio;

    return {
      allowed: true,
      quantity: Math.round(quantity * 10000) / 10000,
      usdValue: Math.round(positionUsdValue * 100) / 100,
      riskAmountUsd: Math.round(riskAmountUsd * 100) / 100,
      stopLossPrice: Math.round(stopLossPrice * 100) / 100,
      takeProfitPrice: Math.round(takeProfitPrice * 100) / 100,
    };
  }

  /**
   * Idempotency Check: Prevent duplicate order execution
   */
  checkIdempotency(clientOrderId: string): boolean {
    if (this.processedOrderIds.has(clientOrderId)) {
      return false; // Duplicate!
    }
    this.processedOrderIds.add(clientOrderId);
    return true;
  }

  /**
   * Register trade outcome to update daily loss and streak counters
   */
  recordTradeResult(userId: string, pnlUsd: number) {
    const today = new Date().toISOString().split('T')[0];
    const data = this.getDailyLoss(userId, today);

    if (pnlUsd < 0) {
      data.realizedLoss += Math.abs(pnlUsd);
      data.consecutiveLosses += 1;
    } else {
      data.consecutiveLosses = 0; // Reset streak on win
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

  /**
   * Emergency Stop: Halts all trading and optionally closes positions
   */
  emergencyStop(userId: string, closeAllPositions: boolean = false): {
    positionsClosed: number;
    message: string;
  } {
    db.systemHealth.tradingEngineStatus = 'EMERGENCY_STOPPED';
    db.systemHealth.circuitBreakerTripped = true;

    db.logAudit(
      userId,
      'EMERGENCY_STOP',
      `EMERGENCY STOP initiated by user ${userId}. All new trade openings halted. Close open positions: ${closeAllPositions}.`,
      'ALERT'
    );

    let closedCount = 0;
    if (closeAllPositions) {
      for (const [id, pos] of db.positions.entries()) {
        if (pos.userId === userId) {
          // Convert to closed trade
          const pnlUsd = (pos.currentPrice - pos.entryPrice) * pos.quantity;
          const pnlPercent = ((pos.currentPrice - pos.entryPrice) / pos.entryPrice) * 100;

          db.trades.unshift({
            id: `trd_${Date.now()}_${closedCount}`,
            userId: pos.userId,
            symbol: pos.symbol,
            side: pos.side,
            mode: pos.mode,
            quantity: pos.quantity,
            entryPrice: pos.entryPrice,
            exitPrice: pos.currentPrice,
            stopLoss: pos.stopLoss,
            takeProfit: pos.takeProfit1,
            realizedPnlUsd: Math.round(pnlUsd * 100) / 100,
            realizedPnlPercent: Math.round(pnlPercent * 100) / 100,
            openedAt: pos.openedAt,
            closedAt: new Date().toISOString(),
            exitReason: 'EMERGENCY_STOP',
            strategy: pos.strategy,
            aiConfidence: pos.aiConfidence,
            entryReason: pos.entryReason,
            riskRewardAchieved: '0:0',
            feesPaid: 1.0,
          });

          db.positions.delete(id);
          closedCount++;
        }
      }
    }

    db.addNotification(
      'EMERGENCY STOP TRIGGERED',
      `Trading paused immediately. ${closedCount} active positions closed.`,
      'RISK'
    );

    return {
      positionsClosed: closedCount,
      message: `Emergency stop active. Trading engine halted. ${closedCount} positions closed.`,
    };
  }

  /**
   * Reset Circuit Breaker (Admin or User action with confirmation)
   */
  resetCircuitBreaker(userId: string = 'usr_trader') {
    db.systemHealth.circuitBreakerTripped = false;
    db.systemHealth.globalKillSwitchActive = false;
    db.systemHealth.tradingEngineStatus = 'RUNNING';
    
    // Clear all daily loss tracking records for this user
    for (const key of this.dailyLossTracker.keys()) {
      if (key === userId || key.startsWith(`${userId}_`)) {
        this.dailyLossTracker.delete(key);
      }
    }

    const settings = db.botSettings.get(userId);
    if (settings) {
      settings.circuitBreakerActive = false;
    }

    db.logAudit(userId, 'RISK_UPDATE', 'Circuit breaker reset by user/admin.', 'INFO');
    db.addNotification('Circuit Breaker Reset', 'Trading engine resumed normal operations.', 'SYSTEM');
  }

  private triggerCircuitBreaker(eventType: RiskEvent['eventType'], description: string) {
    db.systemHealth.circuitBreakerTripped = true;
    db.systemHealth.tradingEngineStatus = 'PAUSED';

    const event: RiskEvent = {
      id: `risk_${Date.now()}`,
      timestamp: new Date().toISOString(),
      eventType,
      severity: 'CRITICAL',
      description,
      actionTaken: 'Trading engine paused and new order placements locked.',
    };

    db.riskEvents.unshift(event);
    db.logAudit('SYSTEM', 'RISK_UPDATE', `CIRCUIT BREAKER: ${description}`, 'ALERT');
    db.addNotification('Circuit Breaker Tripped', description, 'RISK');
  }
}

export const riskEngine = new RiskManagementEngine();
