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
  exitReason: 'TAKE_PROFIT' | 'STOP_LOSS' | 'TRAILING_STOP' | 'EMERGENCY_STOP' | 'MANUAL_CLOSE' | 'CIRCUIT_BREAKER';
  strategy: string;
  aiConfidence: number;
  entryReason: string;
  riskRewardAchieved: string;
  feesPaid: number;
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
  sharpeRatio: number;
  averageTradeProfit: number;
  averageTradeLoss: number;
  largestWin: number;
  largestLoss: number;
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
  robustnessVerdict: 'ROBUST' | 'MODERATE' | 'OVERFITTED';
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
  uptimeSeconds: number;
  lastSuccessfulMarketUpdate: string;
  activeErrorsCount: number;
  geminiAiAvailable: boolean;
}
