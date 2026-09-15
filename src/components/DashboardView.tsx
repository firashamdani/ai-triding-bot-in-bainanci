import React from 'react';
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Activity,
  Cpu,
  ShieldCheck,
  AlertTriangle,
  Play,
  Pause,
  ArrowUpRight,
  ArrowDownRight,
  CheckCircle2,
  XCircle,
  ExternalLink,
  Percent,
} from 'lucide-react';
import {
  Language,
  Position,
  Trade,
  MarketSymbol,
  BotSettings,
  SystemHealth,
} from '../types';
import { translations } from '../i18n';

interface DashboardViewProps {
  lang: Language;
  tradingMode: 'PAPER' | 'LIVE';
  paperBalance?: number;
  totalEquity?: number;
  unrealizedPnl?: number;
  realizedPnl?: number;
  positions?: Position[];
  trades?: Trade[];
  tickers?: MarketSymbol[];
  symbols?: MarketSymbol[];
  botRunning?: boolean;
  botSettings?: BotSettings | null;
  systemHealth?: SystemHealth | null;
  onToggleBot?: () => void;
  onResetCircuitBreaker?: () => void;
  onClosePosition?: (id: string) => void;
  onSelectSymbolForAi?: (symbol: string) => void;
  onViewTradeAudit?: (trade: Trade | Position) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  lang,
  tradingMode = 'PAPER',
  paperBalance = 10000,
  totalEquity = 10000,
  unrealizedPnl = 0,
  realizedPnl = 0,
  positions = [],
  trades = [],
  tickers = [],
  symbols = [],
  botRunning = true,
  botSettings = null,
  systemHealth = null,
  onToggleBot = () => {},
  onResetCircuitBreaker = () => {},
  onClosePosition = (_id?: string) => {},
  onSelectSymbolForAi = (_symbol?: string) => {},
  onViewTradeAudit = (_trade?: any) => {},
}) => {
  const t = translations[lang];

  const safeTrades = trades || [];
  const safePositions = positions || [];
  const safeTickers = tickers.length > 0 ? tickers : (symbols || []);
  const safePaperBalance = typeof paperBalance === 'number' && !isNaN(paperBalance) ? paperBalance : 10000;
  const safeTotalEquity = typeof totalEquity === 'number' && !isNaN(totalEquity) ? totalEquity : safePaperBalance;
  const safeUnrealizedPnl = typeof unrealizedPnl === 'number' && !isNaN(unrealizedPnl) ? unrealizedPnl : 0;
  const safeRealizedPnl = typeof realizedPnl === 'number' && !isNaN(realizedPnl) ? realizedPnl : 0;

  const winningTrades = safeTrades.filter((t) => t && t.realizedPnlUsd > 0).length;
  const losingTrades = safeTrades.filter((t) => t && t.realizedPnlUsd <= 0).length;
  const winRate = safeTrades.length > 0 ? (winningTrades / safeTrades.length) * 100 : 0;

  return (
    <div className="space-y-6">
      {/* Top Warning Banner if Circuit Breaker Tripped */}
      {systemHealth?.circuitBreakerTripped && (
        <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/40 flex flex-wrap items-center justify-between gap-3 animate-pulse">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
            <div>
              <p className="text-xs font-bold text-amber-300">
                {lang === 'ar'
                  ? 'قاطع الدائرة الآلي مفعل: تم تعليق تنفيذ الصفقات الجديدة تلقائياً لحماية رأس المال'
                  : 'Automated Circuit Breaker Tripped: New order execution is paused to safeguard capital'}
              </p>
              <p className="text-[11px] text-amber-400/80">
                {lang === 'ar'
                  ? 'تم رصد خسارة يومية أو حركات تقلب غير اعتيادية. يمكنك المراجعة وإعادة الضبط.'
                  : 'Daily loss limit or rapid volatility threshold exceeded. Review settings and reset.'}
              </p>
            </div>
          </div>
          <button
            onClick={onResetCircuitBreaker}
            className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition-colors"
          >
            {t.resetCircuit}
          </button>
        </div>
      )}

      {/* Account Metric Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
        {/* Balance Card */}
        <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
            <span>{t.accountBalance}</span>
            <DollarSign className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-lg sm:text-2xl font-bold text-slate-100 font-mono-num">
            ${safePaperBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="text-[10px] text-slate-400 mt-1 flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />
            <span>{tradingMode === 'LIVE' ? t.liveMode : t.paperMode}</span>
          </div>
        </div>

        {/* Total Equity */}
        <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
            <span>{t.equity}</span>
            <Activity className="w-4 h-4 text-blue-400" />
          </div>
          <div className="text-lg sm:text-2xl font-bold text-slate-100 font-mono-num">
            ${safeTotalEquity.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="text-[10px] text-slate-400 mt-1">
            {lang === 'ar' ? 'الرصيد + الصفقات الحالية' : 'Balance + Open Positions'}
          </div>
        </div>

        {/* Unrealized PnL */}
        <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
            <span>{t.unrealizedPnl}</span>
            {safeUnrealizedPnl >= 0 ? (
              <TrendingUp className="w-4 h-4 text-emerald-400" />
            ) : (
              <TrendingDown className="w-4 h-4 text-red-400" />
            )}
          </div>
          <div className={`text-lg sm:text-2xl font-bold font-mono-num ${safeUnrealizedPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {safeUnrealizedPnl >= 0 ? '+' : ''}${safeUnrealizedPnl.toFixed(2)}
          </div>
          <div className="text-[10px] text-slate-400 mt-1">
            {safePositions.length} {lang === 'ar' ? 'مراكز نشطة' : 'open positions'}
          </div>
        </div>

        {/* Realized PnL */}
        <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
            <span>{t.realizedPnl}</span>
            {safeRealizedPnl >= 0 ? (
              <TrendingUp className="w-4 h-4 text-emerald-400" />
            ) : (
              <TrendingDown className="w-4 h-4 text-red-400" />
            )}
          </div>
          <div className={`text-lg sm:text-2xl font-bold font-mono-num ${safeRealizedPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {safeRealizedPnl >= 0 ? '+' : ''}${safeRealizedPnl.toFixed(2)}
          </div>
          <div className="text-[10px] text-slate-400 mt-1">
            {safeTrades.length} {lang === 'ar' ? 'صفقات مغلقة' : 'closed trades'}
          </div>
        </div>

        {/* Win Rate */}
        <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 col-span-2 lg:col-span-1">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
            <span>{t.winRate}</span>
            <Percent className="w-4 h-4 text-purple-400" />
          </div>
          <div className="text-lg sm:text-2xl font-bold text-purple-400 font-mono-num">
            {winRate.toFixed(1)}%
          </div>
          <div className="text-[10px] text-slate-400 mt-1 flex items-center justify-between">
            <span className="text-emerald-400 font-mono-num">{winningTrades}W</span>
            <span className="text-red-400 font-mono-num">{losingTrades}L</span>
          </div>
        </div>
      </div>

      {/* Live Market Tickers Carousel / Bar */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-3">
        <div className="flex items-center justify-between mb-2 px-1">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            {lang === 'ar' ? 'أسعار Binance Spot اللحظية' : 'Live Binance Spot Tickers'}
          </span>
          <span className="text-[10px] text-slate-400 font-mono-num">Auto-refresh 5s</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
          {safeTickers.slice(0, 6).map((ticker) => {
            const isPos = ticker.priceChange24h >= 0;
            return (
              <button
                key={ticker.symbol}
                onClick={() => onSelectSymbolForAi(ticker.symbol)}
                className="p-2.5 rounded-lg bg-slate-800/60 hover:bg-slate-800 border border-slate-700/50 text-left transition-all group"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-200 group-hover:text-amber-400 transition-colors">
                    {ticker.symbol}
                  </span>
                  {isPos ? (
                    <ArrowUpRight className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <ArrowDownRight className="w-3.5 h-3.5 text-red-400" />
                  )}
                </div>
                <div className="text-xs font-bold text-slate-100 font-mono-num mt-1">
                  ${ticker.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                <div className={`text-[10px] font-mono-num ${isPos ? 'text-emerald-400' : 'text-red-400'}`}>
                  {isPos ? '+' : ''}{ticker.priceChange24h.toFixed(2)}%
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Bot Control Card & Risk Parameters */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Bot Status & Quick Control */}
        <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <Cpu className="w-4 h-4 text-amber-400" />
              <span className="text-xs font-bold uppercase text-slate-200">{t.botStatus}</span>
            </div>
            <button
              onClick={onToggleBot}
              className={`px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1.5 transition-colors ${
                botSettings?.isEnabled
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 hover:bg-emerald-500/30'
                  : 'bg-slate-800 text-slate-400 border border-slate-700 hover:bg-slate-700'
              }`}
            >
              {botSettings?.isEnabled ? (
                <>
                  <Pause className="w-3 h-3" />
                  <span>{t.botActive}</span>
                </>
              ) : (
                <>
                  <Play className="w-3 h-3" />
                  <span>{t.botPaused}</span>
                </>
              )}
            </button>
          </div>

          <div className="space-y-2 text-xs">
            <div className="flex items-center justify-between text-slate-400">
              <span>{lang === 'ar' ? 'الاستراتيجية الفعالة' : 'Active Strategy'}:</span>
              <span className="text-slate-200 font-semibold font-mono-num">Multi-Timeframe Trend & Breakout</span>
            </div>
            <div className="flex items-center justify-between text-slate-400">
              <span>{lang === 'ar' ? 'حد ثقة الذكاء الاصطناعي' : 'Min AI Confidence'}:</span>
              <span className="text-amber-400 font-bold font-mono-num">{botSettings?.minAiConfidence || 75}%</span>
            </div>
            <div className="flex items-center justify-between text-slate-400">
              <span>{lang === 'ar' ? 'المخاطرة في كل صفقة' : 'Risk per Trade'}:</span>
              <span className="text-slate-200 font-semibold font-mono-num">{botSettings?.riskPerTradePercent || 1.0}%</span>
            </div>
            <div className="flex items-center justify-between text-slate-400">
              <span>{lang === 'ar' ? 'أقصى خسارة يومية' : 'Max Daily Loss'}:</span>
              <span className="text-red-400 font-semibold font-mono-num">${botSettings?.maxDailyLossUsd || 150}</span>
            </div>
          </div>
        </div>

        {/* Active Positions Summary */}
        <div className="lg:col-span-2 p-4 rounded-xl bg-slate-900/90 border border-slate-800 space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-emerald-400" />
              <span className="text-xs font-bold uppercase text-slate-200">{t.activePositions}</span>
              <span className="px-1.5 py-0.2 rounded bg-slate-800 text-[10px] text-slate-300 font-mono-num">
                {safePositions.length}
              </span>
            </div>
          </div>

          {safePositions.length === 0 ? (
            <div className="text-center py-8 text-slate-500 text-xs">
              <CheckCircle2 className="w-6 h-6 mx-auto mb-2 text-slate-600" />
              {t.noPositions}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-slate-400 border-b border-slate-800 pb-1">
                    <th className="text-left py-1 font-semibold">{t.symbol}</th>
                    <th className="text-left py-1 font-semibold">{t.side}</th>
                    <th className="text-left py-1 font-semibold">{t.entryPrice}</th>
                    <th className="text-left py-1 font-semibold">{t.price}</th>
                    <th className="text-left py-1 font-semibold">{t.stopLoss}</th>
                    <th className="text-left py-1 font-semibold">{t.takeProfit1}</th>
                    <th className="text-left py-1 font-semibold">{t.pnl}</th>
                    <th className="text-right py-1 font-semibold">{t.action}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {safePositions.map((pos) => {
                    const isPos = pos.unrealizedPnlUsd >= 0;
                    return (
                      <tr key={pos.id} className="hover:bg-slate-800/40 transition-colors">
                        <td className="py-2.5 font-bold text-slate-200">
                          <button
                            onClick={() => onViewTradeAudit(pos)}
                            className="hover:text-amber-400 flex items-center gap-1"
                          >
                            {pos.symbol}
                            <ExternalLink className="w-3 h-3 text-slate-500" />
                          </button>
                        </td>
                        <td className="py-2.5">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold font-mono-num ${
                              pos.side === 'BUY'
                                ? 'bg-emerald-500/20 text-emerald-400'
                                : 'bg-red-500/20 text-red-400'
                            }`}
                          >
                            {pos.side}
                          </span>
                        </td>
                        <td className="py-2.5 font-mono-num text-slate-300">${pos.entryPrice.toFixed(2)}</td>
                        <td className="py-2.5 font-mono-num text-slate-100 font-semibold">${pos.currentPrice.toFixed(2)}</td>
                        <td className="py-2.5 font-mono-num text-red-400/80">${pos.stopLoss.toFixed(2)}</td>
                        <td className="py-2.5 font-mono-num text-emerald-400/80">${pos.takeProfit1.toFixed(2)}</td>
                        <td className={`py-2.5 font-mono-num font-bold ${isPos ? 'text-emerald-400' : 'text-red-400'}`}>
                          {isPos ? '+' : ''}${pos.unrealizedPnlUsd.toFixed(2)} ({pos.unrealizedPnlPercent.toFixed(2)}%)
                        </td>
                        <td className="py-2.5 text-right">
                          <button
                            onClick={() => onClosePosition(pos.id)}
                            className="px-2 py-1 rounded bg-slate-800 hover:bg-red-500/20 text-slate-300 hover:text-red-400 border border-slate-700 hover:border-red-500/30 text-[10px] font-semibold transition-colors"
                          >
                            {t.closePosition}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
