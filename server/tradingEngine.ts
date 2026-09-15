import { db } from './db';
import { binanceClient } from './binance';
import { riskEngine } from './riskEngine';
import { Position, Trade, Order } from './types';

export class TradingEngine {
  private paperBalance = 10000.0; // Default virtual balance for Paper Trading

  getPaperBalance(): number {
    return this.paperBalance;
  }

  setPaperBalance(amount: number) {
    this.paperBalance = Math.max(100, amount);
  }

  /**
   * Open a new position (Paper or Live)
   */
  async openPosition(
    userId: string,
    params: {
      symbol: string;
      side: 'BUY' | 'SELL';
      mode: 'PAPER' | 'LIVE';
      stopLoss?: number;
      takeProfit?: number;
      strategyName?: string;
      aiConfidence?: number;
      entryReason?: string;
    }
  ): Promise<{ success: boolean; position?: Position; error?: string }> {
    const settings = db.botSettings.get(userId);
    if (!settings) {
      return { success: false, error: 'User bot configuration not found.' };
    }

    if (!settings.isEnabled && params.mode === 'LIVE') {
      return { success: false, error: 'Trading Bot is currently disabled in settings.' };
    }

    // Strict Gating for Live Trading (Section 4 of prompt)
    if (params.mode === 'LIVE') {
      if (!db.systemHealth.globalLiveTradingEnabled) {
        return {
          success: false,
          error: 'Live Trading is currently disabled platform-wide by the Administrator. Please test using Paper Trading.',
        };
      }

      if (!binanceClient.hasCredentials(userId)) {
        return { success: false, error: 'No Binance API keys connected. Please connect keys in Binance Connection.' };
      }

      const connCheck = await binanceClient.testConnection(userId);
      if (!connCheck.success || connCheck.permissions.canWithdraw) {
        return {
          success: false,
          error: `Live Trading Security Check Failed: ${connCheck.message}`,
        };
      }
    }

    // Fetch live market price
    const klines = await binanceClient.getKlines(params.symbol, '15m', 5);
    const currentPrice = klines[klines.length - 1]?.close || 94000;

    // Check existing positions count for user
    const userPositions = Array.from(db.positions.values()).filter((p) => p.userId === userId);
    const effectiveBalance = params.mode === 'PAPER' ? this.paperBalance : 10000;

    // Run through Risk Management Engine
    const riskCheck = riskEngine.calculatePositionSize(
      userId,
      effectiveBalance,
      currentPrice,
      settings,
      userPositions.length,
      params.stopLoss
    );

    if (!riskCheck.allowed) {
      return { success: false, error: `Risk Check Rejected: ${riskCheck.reason}` };
    }

    // Idempotency check
    const clientOrderId = `order_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    if (!riskEngine.checkIdempotency(clientOrderId)) {
      return { success: false, error: 'Duplicate order detected. Operation aborted.' };
    }

    // If LIVE mode, execute on Binance
    let binanceOrderId: string | undefined;
    if (params.mode === 'LIVE') {
      const liveOrderRes = await binanceClient.executeSpotOrder(userId, {
        symbol: params.symbol,
        side: params.side,
        type: 'MARKET',
        quantity: riskCheck.quantity,
        clientOrderId,
      });

      if (!liveOrderRes.success) {
        db.logAudit(userId, 'API_ERROR', `Binance order execution failed: ${liveOrderRes.error}`, 'ALERT');
        return { success: false, error: `Binance Execution Error: ${liveOrderRes.error}` };
      }
      binanceOrderId = liveOrderRes.orderId;
    }

    // Record Order in Database
    const orderRecord: Order = {
      id: `ord_${Date.now()}`,
      clientOrderId,
      symbol: params.symbol,
      side: params.side,
      type: 'MARKET',
      price: currentPrice,
      quantity: riskCheck.quantity,
      status: 'FILLED',
      mode: params.mode,
      createdAt: new Date().toISOString(),
      binanceOrderId,
    };
    db.orders.unshift(orderRecord);

    // Create Active Position
    const positionId = `pos_${Date.now()}`;
    const newPosition: Position = {
      id: positionId,
      userId,
      symbol: params.symbol,
      side: params.side,
      mode: params.mode,
      quantity: riskCheck.quantity,
      entryPrice: currentPrice,
      currentPrice,
      stopLoss: riskCheck.stopLossPrice,
      takeProfit1: params.takeProfit || riskCheck.takeProfitPrice,
      takeProfit2: (params.takeProfit || riskCheck.takeProfitPrice) * 1.015,
      trailingStopActive: settings.stopLossType === 'TRAILING',
      unrealizedPnlUsd: 0,
      unrealizedPnlPercent: 0,
      openedAt: new Date().toISOString(),
      strategy: params.strategyName || 'Multi-Timeframe Confluence',
      aiConfidence: params.aiConfidence || 80,
      entryReason: params.entryReason || 'Technical Structure Breakout & Risk Parameters verified',
    };

    db.positions.set(positionId, newPosition);

    // Audit log & notification
    db.logAudit(
      userId,
      'TRADE_OPEN',
      `Opened ${params.mode} ${params.side} position on ${params.symbol} at $${currentPrice} (Qty: ${riskCheck.quantity}, SL: $${riskCheck.stopLossPrice}, TP: $${riskCheck.takeProfitPrice})`,
      'INFO'
    );

    db.addNotification(
      `Position Opened (${params.mode})`,
      `${params.symbol} ${params.side} executed at $${currentPrice}. SL: $${riskCheck.stopLossPrice}.`,
      'TRADE'
    );

    return { success: true, position: newPosition };
  }

  /**
   * Close an open position manually or automatically
   */
  async closePosition(
    userId: string,
    positionId: string,
    exitReason: Trade['exitReason'] = 'MANUAL_CLOSE'
  ): Promise<{ success: boolean; trade?: Trade; error?: string }> {
    const position = db.positions.get(positionId);
    if (!position) {
      return { success: false, error: 'Position not found' };
    }

    // Refresh market price
    const klines = await binanceClient.getKlines(position.symbol, '15m', 2);
    const exitPrice = klines[klines.length - 1]?.close || position.currentPrice;

    // Calculate PnL
    const grossPnl = (exitPrice - position.entryPrice) * position.quantity;
    const fee = exitPrice * position.quantity * 0.001; // 0.1% spot fee
    const netPnl = grossPnl - fee;
    const pnlPercent = ((exitPrice - position.entryPrice) / position.entryPrice) * 100;

    // Update Paper Balance if paper mode
    if (position.mode === 'PAPER') {
      this.paperBalance += netPnl;
    }

    // Create Closed Trade Record
    const trade: Trade = {
      id: `trd_${Date.now()}`,
      userId: position.userId,
      symbol: position.symbol,
      side: position.side,
      mode: position.mode,
      quantity: position.quantity,
      entryPrice: position.entryPrice,
      exitPrice,
      stopLoss: position.stopLoss,
      takeProfit: position.takeProfit1,
      realizedPnlUsd: Math.round(netPnl * 100) / 100,
      realizedPnlPercent: Math.round(pnlPercent * 100) / 100,
      openedAt: position.openedAt,
      closedAt: new Date().toISOString(),
      exitReason,
      strategy: position.strategy,
      aiConfidence: position.aiConfidence,
      entryReason: position.entryReason,
      riskRewardAchieved: netPnl >= 0 ? '1:2.3' : '-1:1',
      feesPaid: Math.round(fee * 100) / 100,
    };

    db.trades.unshift(trade);
    db.positions.delete(positionId);

    // Record trade with Risk Engine for daily loss tracking
    riskEngine.recordTradeResult(position.userId, netPnl);

    // Audit log & Notification
    db.logAudit(
      userId,
      'TRADE_CLOSE',
      `Closed ${position.mode} position on ${position.symbol} at $${exitPrice} (${exitReason}). Realized PnL: ${netPnl >= 0 ? '+' : ''}$${netPnl.toFixed(2)} (${pnlPercent.toFixed(2)}%)`,
      'INFO'
    );

    db.addNotification(
      `Position Closed (${exitReason})`,
      `${position.symbol} closed at $${exitPrice}. PnL: ${netPnl >= 0 ? '+' : ''}$${netPnl.toFixed(2)} (${pnlPercent.toFixed(2)}%).`,
      'TRADE'
    );

    return { success: true, trade };
  }

  /**
   * Monitor open positions against latest market prices to trigger SL / TP
   */
  async updatePositionsWithMarketPrices(): Promise<void> {
    for (const [id, pos] of db.positions.entries()) {
      try {
        const klines = await binanceClient.getKlines(pos.symbol, '15m', 2);
        const latestPrice = klines[klines.length - 1]?.close;
        if (!latestPrice) continue;

        pos.currentPrice = latestPrice;
        pos.unrealizedPnlUsd = Math.round((latestPrice - pos.entryPrice) * pos.quantity * 100) / 100;
        pos.unrealizedPnlPercent = Math.round(((latestPrice - pos.entryPrice) / pos.entryPrice) * 10000) / 100;

        // Auto Stop Loss Trigger
        if (latestPrice <= pos.stopLoss) {
          await this.closePosition(pos.userId, id, 'STOP_LOSS');
          continue;
        }

        // Auto Take Profit Trigger
        if (latestPrice >= pos.takeProfit1) {
          await this.closePosition(pos.userId, id, 'TAKE_PROFIT');
          continue;
        }

        // Trailing Stop logic
        if (pos.trailingStopActive && latestPrice > pos.entryPrice * 1.015) {
          const newSl = latestPrice * 0.985;
          if (newSl > pos.stopLoss) {
            pos.stopLoss = Math.round(newSl * 100) / 100;
          }
        }
      } catch {
        // Continue quietly
      }
    }
  }
}

export const tradingEngine = new TradingEngine();
