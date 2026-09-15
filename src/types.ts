export type Language = 'ar' | 'en';

export type UserRole = 'ADMIN' | 'USER';

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  createdAt: string;
}

export type AppView =
  | 'LANDING'
  | 'DASHBOARD'
  | 'SCANNER'
  | 'AI_ANALYSIS'
  | 'TRADES'
  | 'BACKTEST'
  | 'BINANCE'
  | 'SETTINGS'
  | 'ADMIN'
  | 'HEALTH_DOCS';

export interface MarketSymbol {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  price: number;
  priceChange24h: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  minQty: number;
  stepSize: number;
  tickSize: number;
  status: 'TRADING' | 'HALTED';
}

export interface TechnicalIndicators {
  rsi14: number;
  macd: { macd: number; signal: number; histogram: number };
  ema9: number;
  ema21: number;
  ema50: number;
  ema200: number;
  atr14: number;
  vwap: number;
  bollinger: { upper: number; middle: number; lower: number };
  fractals: { swingHigh: number; swingLow: number };
  orderBlock: { type: 'BULLISH' | 'BEARISH' | 'NONE'; priceLevel: number };
  fibonacciLevels: { '0.382': number; '0.5': number; '0.618': number };
}

export interface AiPrediction {
  id: string;
  symbol: string;
  timestamp: string;
  timeframe: string;
  prediction: 'STRONG_BUY' | 'BUY' | 'WAIT' | 'SELL' | 'STRONG_SELL';
  confidenceScore: number;
  factors: {
    trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    momentum: 'STRONG' | 'MODERATE' | 'WEAK';
    volume: 'CONFIRMED' | 'UNCONFIRMED' | 'DIVERGENT';
    structure: 'BULLISH_BREAK' | 'BEARISH_BREAK' | 'CONSOLIDATION' | 'RANGE';
    entryZone: 'OPTIMAL' | 'FAIR' | 'RISKY';
    multiTimeframeAlignment: 'FULL_ALIGNMENT' | 'PARTIAL' | 'CONFLICT';
  };
  reasoning: string[];
  suggestedEntry: number;
  suggestedStopLoss: number;
  suggestedTp1: number;
  suggestedTp2: number;
  suggestedTp3: number;
  riskRewardRatio: string;
  actualOutcome?: 'PROFIT' | 'LOSS' | 'PENDING';
  /** Independent strategies that also signalled long on this bar */
  consensus?: {
    fired: { strategyId: string; name: string; confidence: number; reason: string }[];
    evaluated: number;
    agreement: number;
  };
  /** Binance Spot cannot short: SELL means "be flat", never "open a short" */
  longOnly?: boolean;
}

export interface Position {
  id: string;
  userId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  mode: 'PAPER' | 'LIVE';
  quantity: number;
  entryPrice: number;
  currentPrice: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  trailingStopActive: boolean;
  unrealizedPnlUsd: number;
  unrealizedPnlPercent: number;
  openedAt: string;
  strategy: string;
  aiConfidence: number;
  entryReason: string;
  strategyId?: string;
  exitMode?: 'TP_SL' | 'SIGNAL';
  entryNotional?: number;
  entryFeePaid?: number;
  highestSinceEntry?: number;
  lowestSinceEntry?: number;
  takeProfit1Filled?: boolean;
  stopLossAtBreakeven?: boolean;
  dataSource?: 'LIVE_BINANCE' | 'SIMULATED_OFFLINE';
}

export interface Trade {
  id: string;
  userId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  mode: 'PAPER' | 'LIVE';
  quantity: number;
  entryPrice: number;
  exitPrice: number;
  stopLoss: number;
  takeProfit: number;
  realizedPnlUsd: number;
  realizedPnlPercent: number;
  openedAt: string;
  closedAt: string;
  exitReason:
    | 'TAKE_PROFIT'
    | 'TAKE_PROFIT_1'
    | 'TAKE_PROFIT_2'
    | 'STOP_LOSS'
    | 'BREAKEVEN_STOP'
    | 'TRAILING_STOP'
    | 'SIGNAL_EXIT'
    | 'EMERGENCY_STOP'
    | 'MANUAL_CLOSE'
    | 'CIRCUIT_BREAKER'
    | 'BACKTEST_END_CLOSE';
  strategy: string;
  aiConfidence: number;
  entryReason: string;
  riskRewardAchieved: string;
  feesPaid: number;
  /** True for rows seeded at startup to populate the demo UI */
  isDemoSeed?: boolean;
  isPartialClose?: boolean;
  holdingMs?: number;
}

export interface BotSettings {
  id: string;
  userId: string;
  botName: string;
  isEnabled: boolean;
  mode: 'PAPER' | 'LIVE';
  selectedSymbols: string[];
  activeStrategies: string[];
  primaryTimeframe: '1m' | '5m' | '15m' | '1h' | '4h' | '1d';
  secondaryTimeframes: ('5m' | '15m' | '1h' | '4h' | '1d')[];
  riskPerTradePercent: number;
  maxDailyLossUsd: number;
  maxDrawdownPercent: number;
  maxOpenTrades: number;
  stopLossType: 'FIXED_PERCENT' | 'ATR' | 'STRUCTURE' | 'TRAILING';
  stopLossPercent: number;
  takeProfitType: 'MULTI_TARGET' | 'RISK_REWARD' | 'TRAILING';
  takeProfitRatio: number;
  minAiConfidence: number;
  aiAnalysisIntervalSec: number;
  circuitBreakerActive: boolean;
  /** Stop trading after this many consecutive losses (circuit breaker) */
  maxConsecutiveLosses?: number;
  /** Cap on total committed notional as a % of equity across all open positions */
  maxTotalExposurePercent?: number;
  updatedAt: string;
}

export interface Strategy {
  id: string;
  name: string;
  nameAr: string;
  description: string;
  descriptionAr: string;
  category: 'TREND' | 'BREAKOUT' | 'PULLBACK' | 'MOMENTUM' | 'MEAN_REVERSION' | 'FRACTAL';
  isActive: boolean;
  /** Where the strategy comes from (paper/book/system), shown in the UI */
  reference?: string;
  /** TP_SL = fixed targets; SIGNAL = strategy decides the exit */
  exitMode?: 'TP_SL' | 'SIGNAL';
  /** Timeframes the system was designed for — using the wrong one inflates fee drag */
  recommendedTimeframes?: string[];
  parameters: Record<string, number | string | boolean>;
}

export interface Backtest {
  id: string;
  userId: string;
  symbol: string;
  timeframe: string;
  startDate: string;
  endDate: string;
  strategyId: string;
  initialBalance: number;
  finalBalance: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  netProfit: number;
  netReturnPercent: number;
  maxDrawdownPercent: number;
  profitFactor: number;
  grossProfit?: number;
  grossLoss?: number;
  /** True when every trade won — profitFactor is then a sentinel, not a ratio */
  hasNoLosingTrades?: boolean;
  sharpeRatio: number;
  averageTradeProfit: number;
  averageTradeLoss: number;
  largestWin: number;
  largestLoss: number;
  strategyName?: string;
  maxDrawdownUsd?: number;
  sortinoRatio?: number;
  expectancyPerTrade?: number;
  averageRMultiple?: number;
  averageHoldingBars?: number;
  tradesPerMonth?: number;
  timeInMarketPercent?: number;
  exitBreakdown?: Record<string, number>;
  totalFeesPaid?: number;
  feeDragPercent?: number;
  dataQuality?: 'LIVE_BINANCE' | 'SIMULATED_OFFLINE' | 'CACHED';
  notes?: string[];
  createdAt: string;
  equityCurve: { time: string; equity: number }[];
  trades: {
    id: string;
    symbol: string;
    side: 'BUY' | 'SELL';
    entryPrice: number;
    exitPrice: number;
    pnl: number;
    pnlPercent: number;
    entryTime: string;
    exitTime: string;
    reason: string;
  }[];
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

export interface AuditLog {
  id: string;
  timestamp: string;
  userId: string;
  action: string;
  details: string;
  severity: 'INFO' | 'WARNING' | 'ALERT';
}

export interface AppNotification {
  id: string;
  timestamp: string;
  title: string;
  message: string;
  type: 'TRADE' | 'RISK' | 'SYSTEM' | 'SECURITY';
  read: boolean;
}

export interface SystemHealth {
  serverStatus: 'HEALTHY' | 'DEGRADED' | 'DOWN';
  databaseStatus: 'CONNECTED';
  binanceApiStatus: 'CONNECTED' | 'DISCONNECTED' | 'ERROR';
  aiEngineStatus: 'OPERATIONAL' | 'OFFLINE';
  tradingEngineStatus: 'RUNNING' | 'PAUSED' | 'EMERGENCY_STOPPED';
  circuitBreakerTripped: boolean;
  globalKillSwitchActive: boolean;
  registrationEnabled: boolean;
  globalLiveTradingEnabled: boolean;
  tradingMode?: 'PAPER' | 'LIVE';
  uptimeSeconds: number;
  lastSuccessfulMarketUpdate: string;
  activeErrorsCount: number;
  geminiAiAvailable: boolean;
  lastAutoCycleAt?: string;
  autoTradingActive?: boolean;
  marketDataSource?: 'LIVE_BINANCE' | 'SIMULATED_OFFLINE';
  lastMarketDataError?: string | null;
  lastLiveBinanceFetchAt?: string | null;
}
