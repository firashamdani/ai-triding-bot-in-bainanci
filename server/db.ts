import {
  User,
  ApiConnection,
  BotSettings,
  Strategy,
  MarketSymbol,
  AiPrediction,
  TradingSignal,
  Position,
  Trade,
  Order,
  RiskEvent,
  Backtest,
  AuditLog,
  AppNotification,
  SystemHealth
} from './types';
import { STRATEGIES, toDbStrategy } from './strategies';
import { getSyntheticPrice } from './marketData';
import { hashPassword } from './auth';

/**
 * Seeded demo credentials.
 *
 * They were hardcoded literals, which meant the admin password was readable out of
 * the committed source and identical on every deployment. They now come from the
 * environment. The literals remain only as a development fallback, and using them
 * in production prints a loud warning at boot.
 */
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@trading.ai';
const TRADER_EMAIL = process.env.TRADER_EMAIL ?? 'trader@trading.ai';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'Fras11998877@';
const TRADER_PASSWORD = process.env.TRADER_PASSWORD ?? 'Trader@AI2026!';

export const usingDefaultCredentials =
  !process.env.ADMIN_PASSWORD || !process.env.TRADER_PASSWORD;

if (process.env.NODE_ENV === 'production' && usingDefaultCredentials) {
  console.warn(
    '\n' +
      '============================================================================\n' +
      '  SECURITY: running with the DEFAULT demo credentials.\n' +
      '  ADMIN_PASSWORD / TRADER_PASSWORD are not set, so the published admin\n' +
      '  password from the public repository still works on this deployment.\n' +
      '  Set both environment variables before exposing this service.\n' +
      '============================================================================\n'
  );
}
import { binanceClient } from './binance';

// In-Memory Database store with relational indexing and persistent memory
class TradingDatabase {
  users: Map<string, User> = new Map();
  apiConnections: Map<string, ApiConnection> = new Map();
  botSettings: Map<string, BotSettings> = new Map();
  strategies: Map<string, Strategy> = new Map();
  /** Per-strategy parameter overrides (admin-tunable), merged over defaults */
  strategyParams: Map<string, Record<string, number | string | boolean>> = new Map();
  symbols: Map<string, MarketSymbol> = new Map();
  signals: TradingSignal[] = [];
  positions: Map<string, Position> = new Map();
  trades: Trade[] = [];
  orders: Order[] = [];
  riskEvents: RiskEvent[] = [];
  aiPredictions: AiPrediction[] = [];
  backtests: Backtest[] = [];
  auditLogs: AuditLog[] = [];
  notifications: AppNotification[] = [];

  // Global Admin toggles
  systemHealth: SystemHealth = {
    serverStatus: 'HEALTHY',
    databaseStatus: 'CONNECTED',
    binanceApiStatus: 'CONNECTED',
    aiEngineStatus: 'OPERATIONAL',
    tradingEngineStatus: 'RUNNING',
    circuitBreakerTripped: false,
    globalKillSwitchActive: false,
    registrationEnabled: false, // Per prompt: "Registration = Disabled في المرحلة الأولى"
    globalLiveTradingEnabled: false, // Per prompt: "Disabled افتراضيًا"
    tradingMode: 'PAPER', // Always boot in paper mode; LIVE requires an explicit admin switch
    uptimeSeconds: 0,
    lastSuccessfulMarketUpdate: new Date().toISOString(),
    activeErrorsCount: 0,
    geminiAiAvailable: !!process.env.GEMINI_API_KEY,
    marketDataSource: 'SIMULATED_OFFLINE',
    lastMarketDataError: null,
    lastLiveBinanceFetchAt: null,
    autoTradingActive: false,
  };

  private startTime = Date.now();

  constructor() {
    this.seedDefaults();
  }

  private seedDefaults() {
    // 1. Seed Users (Admin & Trader)
    const adminUser: User = {
      id: 'usr_admin',
      email: ADMIN_EMAIL,
      name: 'Super Admin',
      role: 'ADMIN',
      passwordHash: hashPassword(ADMIN_PASSWORD),
      createdAt: new Date().toISOString(),
      isActive: true,
    };
    const demoTrader: User = {
      id: 'usr_trader',
      email: TRADER_EMAIL,
      name: 'Pro Trader',
      role: 'USER',
      passwordHash: hashPassword(TRADER_PASSWORD),
      createdAt: new Date().toISOString(),
      isActive: true,
    };
    this.users.set(adminUser.id, adminUser);
    this.users.set(demoTrader.id, demoTrader);

    // 2. Seed Strategies — sourced from the strategy registry so the UI, the
    //    live bot and the backtester can never drift apart again.
    STRATEGIES.forEach((def) => {
      const s = toDbStrategy(def) as Strategy;
      this.strategies.set(s.id, s);
      this.strategyParams.set(s.id, { ...def.defaultParams });
    });

    // 3. Seed Symbols
    const defaultSymbols: MarketSymbol[] = [
      {
        symbol: 'BTCUSDT',
        baseAsset: 'BTC',
        quoteAsset: 'USDT',
        price: 94250.0,
        priceChange24h: 3.42,
        high24h: 95400.0,
        low24h: 91100.0,
        volume24h: 34120.5,
        minQty: 0.0001,
        stepSize: 0.0001,
        tickSize: 0.01,
        status: 'TRADING',
      },
      {
        symbol: 'ETHUSDT',
        baseAsset: 'ETH',
        quoteAsset: 'USDT',
        price: 3340.5,
        priceChange24h: 4.15,
        high24h: 3410.0,
        low24h: 3205.0,
        volume24h: 185200.0,
        minQty: 0.001,
        stepSize: 0.001,
        tickSize: 0.01,
        status: 'TRADING',
      },
      {
        symbol: 'SOLUSDT',
        baseAsset: 'SOL',
        quoteAsset: 'USDT',
        price: 198.8,
        priceChange24h: 6.85,
        high24h: 204.5,
        low24h: 185.0,
        volume24h: 890400.0,
        minQty: 0.01,
        stepSize: 0.01,
        tickSize: 0.01,
        status: 'TRADING',
      },
      {
        symbol: 'BNBUSDT',
        baseAsset: 'BNB',
        quoteAsset: 'USDT',
        price: 645.2,
        priceChange24h: 1.95,
        high24h: 652.0,
        low24h: 633.0,
        volume24h: 94100.0,
        minQty: 0.01,
        stepSize: 0.01,
        tickSize: 0.01,
        status: 'TRADING',
      },
      {
        symbol: 'XRPUSDT',
        baseAsset: 'XRP',
        quoteAsset: 'USDT',
        price: 2.38,
        priceChange24h: -1.25,
        high24h: 2.52,
        low24h: 2.31,
        volume24h: 4500000.0,
        minQty: 1,
        stepSize: 0.1,
        tickSize: 0.0001,
        status: 'TRADING',
      },
      {
        symbol: 'ADAUSDT',
        baseAsset: 'ADA',
        quoteAsset: 'USDT',
        price: 0.88,
        priceChange24h: 2.4,
        high24h: 0.92,
        low24h: 0.85,
        volume24h: 1200000.0,
        minQty: 1,
        stepSize: 0.1,
        tickSize: 0.0001,
        status: 'TRADING',
      },
    ];
    defaultSymbols.forEach((sym) => this.symbols.set(sym.symbol, sym));

    // 4. Default Bot Settings for Trader
    const defaultSettings: BotSettings = {
      id: 'cfg_trader',
      userId: demoTrader.id,
      botName: 'Binance Alpha Quant Bot',
      isEnabled: true,
      mode: 'PAPER', // Default Paper
      selectedSymbols: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'],
      // Only the strategies that passed EVERY validation filter (positive net
      // return, PF > 1.05, out-of-sample walk-forward, and parameter robustness)
      // in scripts/validate.ts are enabled by default. See docs/BOT_AUDIT.md.
      activeStrategies: ['strat_turtle', 'strat_dual_momentum'],
      // 4h is the timeframe both validated strategies were designed for. Running
      // a daily-bar system on 15m multiplies trade count (and fee drag) with no
      // added edge — measured: Turtle went from +9.45% on 4h to -4.52% on 1h.
      primaryTimeframe: '4h',
      secondaryTimeframes: ['1h', '4h', '1d'],
      riskPerTradePercent: 1.0,
      maxDailyLossUsd: 150,
      maxDrawdownPercent: 6.0,
      maxOpenTrades: 3,
      stopLossType: 'ATR',
      stopLossPercent: 1.8,
      takeProfitType: 'MULTI_TARGET',
      takeProfitRatio: 2.5,
      minAiConfidence: 62,
      aiAnalysisIntervalSec: 60,
      maxConsecutiveLosses: 4,
      maxTotalExposurePercent: 80,
      circuitBreakerActive: false,
      updatedAt: new Date().toISOString(),
    };
    this.botSettings.set(demoTrader.id, defaultSettings);

    // 5. Default Connection State
    const defaultConnection: ApiConnection = {
      id: 'conn_trader',
      userId: demoTrader.id,
      exchange: 'BINANCE',
      isTestnet: true,
      apiKeyMasked: 'vm81••••••••••••••••••••••••9kQ2',
      encryptedSecret: 'ENC_STORED_ON_SERVER_ONLY',
      status: 'CONNECTED',
      lastPingTime: new Date().toISOString(),
      permissions: {
        canRead: true,
        canTrade: true,
        canWithdraw: false, // Strictly false!
      },
      balances: [
        { asset: 'USDT', free: 12450.0, locked: 0, usdValue: 12450.0 },
        { asset: 'BTC', free: 0.15, locked: 0, usdValue: 14137.5 },
        { asset: 'ETH', free: 2.5, locked: 0, usdValue: 8351.25 },
        { asset: 'SOL', free: 15.0, locked: 0, usdValue: 2982.0 },
      ],
      updatedAt: new Date().toISOString(),
    };
    this.apiConnections.set(demoTrader.id, defaultConnection);

    // 6. Pre-seed one sample paper position.
    //    Entry price is derived from the SAME simulated feed the engine reads, so
    //    the demo position does not show an instant fantasy +23% PnL.
    const seedBtc = getSyntheticPrice('BTCUSDT');
    const seedEntry = Math.round(seedBtc * 0.985 * 100) / 100;
    const seedQty = 0.012;
    const seedAtr = Math.round(seedEntry * 0.018 * 100) / 100;
    const samplePosition1: Position = {
      id: 'pos_1',
      userId: demoTrader.id,
      symbol: 'BTCUSDT',
      side: 'BUY',
      mode: 'PAPER',
      quantity: seedQty,
      entryPrice: seedEntry,
      currentPrice: seedBtc,
      stopLoss: Math.round((seedEntry - 2 * seedAtr) * 100) / 100,
      takeProfit1: Math.round((seedEntry + 2 * (seedEntry - (seedEntry - 2 * seedAtr))) * 100) / 100,
      takeProfit2: Math.round((seedEntry + 3 * (seedEntry - (seedEntry - 2 * seedAtr))) * 100) / 100,
      trailingStopActive: true,
      unrealizedPnlUsd: Math.round((seedBtc - seedEntry) * seedQty * 100) / 100,
      unrealizedPnlPercent: Math.round(((seedBtc - seedEntry) / seedEntry) * 10000) / 100,
      openedAt: new Date(Date.now() - 3600000 * 4).toISOString(),
      strategy: 'Supertrend (10,3) + EMA200 filter',
      strategyId: 'strat_supertrend',
      exitMode: 'SIGNAL',
      aiConfidence: 68,
      entryReason: 'Supertrend flipped bullish with price above EMA200 (demo position seeded at startup).',
      entryNotional: Math.round(seedEntry * seedQty * 100) / 100,
      entryFeePaid: Math.round(seedEntry * seedQty * 0.001 * 100) / 100,
      highestSinceEntry: seedBtc,
      lowestSinceEntry: seedEntry,
      takeProfit1Filled: false,
      stopLossAtBreakeven: false,
      dataSource: 'SIMULATED_OFFLINE',
    };
    this.positions.set(samplePosition1.id, samplePosition1);

    // 7. Seed Past Trades
    const sampleTrade1: Trade = {
      id: 'trd_1',
      userId: demoTrader.id,
      symbol: 'ETHUSDT',
      side: 'BUY',
      mode: 'PAPER',
      quantity: 1.5,
      entryPrice: 3210.0,
      exitPrice: 3340.0,
      stopLoss: 3150.0,
      takeProfit: 3330.0,
      realizedPnlUsd: 195.0,
      realizedPnlPercent: 4.05,
      openedAt: new Date(Date.now() - 86400000 * 2).toISOString(),
      closedAt: new Date(Date.now() - 86400000 * 1.5).toISOString(),
      exitReason: 'TAKE_PROFIT',
      strategy: 'Fibonacci Pullback & Golden Pocket',
      aiConfidence: 82,
      entryReason: 'Touch of 0.618 Fib on 1H with Bullish RSI divergence',
      riskRewardAchieved: '1:2.1',
      feesPaid: 2.85,
    };
    const sampleTrade2: Trade = {
      id: 'trd_2',
      userId: demoTrader.id,
      symbol: 'SOLUSDT',
      side: 'BUY',
      mode: 'PAPER',
      quantity: 8,
      entryPrice: 182.5,
      exitPrice: 196.0,
      stopLoss: 177.0,
      takeProfit: 195.0,
      realizedPnlUsd: 108.0,
      realizedPnlPercent: 7.39,
      openedAt: new Date(Date.now() - 86400000).toISOString(),
      closedAt: new Date(Date.now() - 3600000 * 8).toISOString(),
      exitReason: 'TAKE_PROFIT',
      strategy: 'Volatility Breakout',
      aiConfidence: 86,
      entryReason: 'High volume surge above 20-day high with Bollinger band squeeze release',
      riskRewardAchieved: '1:2.4',
      feesPaid: 1.95,
    };
    this.trades.push(sampleTrade1, sampleTrade2);

    // 8. Seed Audit Logs
    this.logAudit(
      demoTrader.id,
      'LOGIN',
      'User logged in securely with session encryption',
      'INFO'
    );
    this.logAudit(
      demoTrader.id,
      'BINANCE_CONNECT',
      'Connected to Binance Testnet. Verified read & trade permissions. Withdrawal capability rejected.',
      'INFO'
    );

    // 9. Seed Notifications
    this.notifications.push(
      {
        id: 'notif_1',
        timestamp: new Date().toISOString(),
        title: 'Trade Filled (Take Profit)',
        message: 'SOLUSDT closed at $196.00 with realized profit of +$108.00 (+7.39%).',
        type: 'TRADE',
        read: false,
      },
      {
        id: 'notif_2',
        timestamp: new Date(Date.now() - 3600000 * 3).toISOString(),
        title: 'Safety Check Passed',
        message: 'Risk management engine validated limits. Account balance within safe drawdown limits.',
        type: 'SYSTEM',
        read: true,
      }
    );
  }

  logAudit(userId: string, action: AuditLog['action'], details: string, severity: AuditLog['severity'] = 'INFO') {
    const entry: AuditLog = {
      id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      timestamp: new Date().toISOString(),
      userId,
      action,
      details,
      severity,
    };
    this.auditLogs.unshift(entry);
    // Keep max 500 logs
    if (this.auditLogs.length > 500) {
      this.auditLogs.pop();
    }
  }

  addNotification(title: string, message: string, type: AppNotification['type']) {
    const notif: AppNotification = {
      id: `notif_${Date.now()}`,
      timestamp: new Date().toISOString(),
      title,
      message,
      type,
      read: false,
    };
    this.notifications.unshift(notif);
    if (this.notifications.length > 100) this.notifications.pop();
  }

  getHealth(): SystemHealth {
    this.systemHealth.uptimeSeconds = Math.floor((Date.now() - this.startTime) / 1000);
    this.systemHealth.lastSuccessfulMarketUpdate = new Date().toISOString();
    // Report honestly whether prices are real Binance data or the offline simulation
    this.systemHealth.marketDataSource = binanceClient.lastDataSource;
    this.systemHealth.lastMarketDataError = binanceClient.lastFetchError;
    this.systemHealth.lastLiveBinanceFetchAt = binanceClient.lastLiveFetchAt
      ? new Date(binanceClient.lastLiveFetchAt).toISOString()
      : null;
    this.systemHealth.binanceApiStatus = binanceClient.lastDataSource === 'LIVE_BINANCE' ? 'CONNECTED' : 'DISCONNECTED';
    return this.systemHealth;
  }
}

export const db = new TradingDatabase();
