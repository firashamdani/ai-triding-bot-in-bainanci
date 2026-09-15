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

// In-Memory Database store with relational indexing and persistent memory
class TradingDatabase {
  users: Map<string, User> = new Map();
  apiConnections: Map<string, ApiConnection> = new Map();
  botSettings: Map<string, BotSettings> = new Map();
  strategies: Map<string, Strategy> = new Map();
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
    uptimeSeconds: 0,
    lastSuccessfulMarketUpdate: new Date().toISOString(),
    activeErrorsCount: 0,
    geminiAiAvailable: !!process.env.GEMINI_API_KEY,
  };

  private startTime = Date.now();

  constructor() {
    this.seedDefaults();
  }

  private seedDefaults() {
    // 1. Seed Users (Admin & Trader)
    const adminUser: User = {
      id: 'usr_admin',
      email: 'admin@trading.ai',
      name: 'Super Admin',
      role: 'ADMIN',
      passwordHash: 'Admin@AI2026!',
      createdAt: new Date().toISOString(),
      isActive: true,
    };
    const demoTrader: User = {
      id: 'usr_trader',
      email: 'trader@trading.ai',
      name: 'Pro Trader',
      role: 'USER',
      passwordHash: 'Trader@AI2026!',
      createdAt: new Date().toISOString(),
      isActive: true,
    };
    this.users.set(adminUser.id, adminUser);
    this.users.set(demoTrader.id, demoTrader);

    // 2. Seed Strategies
    const defaultStrategies: Strategy[] = [
      {
        id: 'strat_trend',
        name: 'Trend Following (EMA & MACD Confluence)',
        nameAr: 'تتبع الاتجاه (تلاقي المتوسطات المتحركة والماكد)',
        description: 'Multi-EMA alignment (9/21/50/200) with MACD momentum confirmation for swing trading.',
        descriptionAr: 'توافق المتوسطات المتحركة (9/21/50/200) مع تأكيد الزخم عبر MACD للتداول مع الاتجاه.',
        category: 'TREND',
        isActive: true,
        parameters: { emaFast: 9, emaSlow: 21, emaTrend: 200, rsiThreshold: 50 },
      },
      {
        id: 'strat_breakout',
        name: 'Volatility Breakout & Volume Expansion',
        nameAr: 'اختراق التقلب مع تمدد السيولة والحجم',
        description: 'Identifies consolidation ranges and enters upon high-volume expansion outside Bollinger & ATR bands.',
        descriptionAr: 'رصد مناطق التجميع والدخول عند اختراق نطاق البولينجر مع انفجار في حجم التداول.',
        category: 'BREAKOUT',
        isActive: true,
        parameters: { volumeMultiplier: 1.8, atrLookback: 14 },
      },
      {
        id: 'strat_pullback',
        name: 'Fibonacci Pullback & Liquidity Sweeps',
        nameAr: 'ارتداد فيبوناتشي واقتناص السيولة',
        description: 'Enters in the direction of the dominant trend on 0.5 - 0.618 golden pocket retracements.',
        descriptionAr: 'دخول مع الاتجاه الرئيسي عند الارتداد إلى مستويات التصحيح الذهبية 0.5 - 0.618.',
        category: 'PULLBACK',
        isActive: true,
        parameters: { fibMin: 0.5, fibMax: 0.618, rsiMin: 40, rsiMax: 60 },
      },
      {
        id: 'strat_momentum',
        name: 'RSI Divergence & Momentum Surge',
        nameAr: 'الزخم والانفراج الإيجابي/السلبي لمؤشر RSI',
        description: 'Captures accelerated impulse waves when price action confirms RSI momentum crossovers.',
        descriptionAr: 'اقتناص موجات الاندفاع السريعة عند تأكيد مؤشر القوة النسبية لانعكاس الزخم.',
        category: 'MOMENTUM',
        isActive: true,
        parameters: { rsiOverbought: 70, rsiOversold: 30 },
      },
      {
        id: 'strat_fractal',
        name: 'Fractal & Multi-Timeframe Market Structure',
        nameAr: 'هندسة الفركتال وبنية السوق متعددة الأطر',
        description: 'Identifies Swing Highs/Lows, Order Blocks, and self-similar market structure breaks.',
        descriptionAr: 'تحديد قمم وقيعان السوينغ (Swing High/Low) والكتل السعرية مع كسر بنية السوق (BOS).',
        category: 'FRACTAL',
        isActive: true,
        parameters: { swingLookback: 5, requireConfirmation: true },
      },
    ];

    defaultStrategies.forEach((s) => this.strategies.set(s.id, s));

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
      activeStrategies: ['strat_trend', 'strat_fractal', 'strat_pullback'],
      primaryTimeframe: '15m',
      secondaryTimeframes: ['1h', '4h', '1d'],
      riskPerTradePercent: 1.0,
      maxDailyLossUsd: 150,
      maxDrawdownPercent: 6.0,
      maxOpenTrades: 3,
      stopLossType: 'ATR',
      stopLossPercent: 1.8,
      takeProfitType: 'MULTI_TARGET',
      takeProfitRatio: 2.5,
      minAiConfidence: 75,
      aiAnalysisIntervalSec: 30,
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

    // 6. Pre-seed Sample Paper Positions
    const samplePosition1: Position = {
      id: 'pos_1',
      userId: demoTrader.id,
      symbol: 'BTCUSDT',
      side: 'BUY',
      mode: 'PAPER',
      quantity: 0.05,
      entryPrice: 76500.0,
      currentPrice: 76800.0,
      stopLoss: 73500.0,
      takeProfit1: 81000.0,
      takeProfit2: 83500.0,
      trailingStopActive: true,
      unrealizedPnlUsd: (76800 - 76500) * 0.05,
      unrealizedPnlPercent: ((76800 - 76500) / 76500) * 100,
      openedAt: new Date(Date.now() - 3600000 * 4).toISOString(),
      strategy: 'Trend Following & Market Structure',
      aiConfidence: 84,
      entryReason: 'Bullish 4H/1H alignment + Swing Low support rebound + Volume confirmation',
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
    return this.systemHealth;
  }
}

export const db = new TradingDatabase();
