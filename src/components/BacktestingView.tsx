import React, { useState } from 'react';
import {
  Terminal,
  TrendingUp,
  TrendingDown,
  BarChart2,
  Calendar,
  DollarSign,
  Percent,
  Play,
  CheckCircle2,
  AlertTriangle,
  Layers,
  ArrowRight,
} from 'lucide-react';
import { Language, Backtest, WalkForwardResult } from '../types';
import { translations } from '../i18n';

interface BacktestingViewProps {
  lang: Language;
  onRunBacktest: (params: {
    symbol: string;
    timeframe: string;
    strategyId: string;
    initialBalance: number;
    riskPerTradePercent: number;
    stopLossPercent: number;
    takeProfitRatio: number;
    periodDays: number;
  }) => Promise<void>;
  onRunWalkForward: (params: {
    symbol: string;
    timeframe: string;
    strategyId: string;
    initialBalance: number;
  }) => Promise<void>;
  backtestResult: Backtest | null;
  walkForwardResult: WalkForwardResult | null;
  isLoading: boolean;
}

export const BacktestingView: React.FC<BacktestingViewProps> = ({
  lang,
  onRunBacktest,
  onRunWalkForward,
  backtestResult,
  walkForwardResult,
  isLoading,
}) => {
  const t = translations[lang];

  // Defensive unwrapping to support both direct object and wrapped responses
  const result: Backtest | null = (backtestResult as any)?.backtest || backtestResult;
  const wfResult: WalkForwardResult | null = (walkForwardResult as any)?.walkForward || walkForwardResult;

  const [activeTab, setActiveTab] = useState<'STANDARD' | 'WALK_FORWARD' | 'PAPER_VS_LIVE'>('STANDARD');

  // Form parameters
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [timeframe, setTimeframe] = useState('15m');
  const [strategyId, setStrategyId] = useState('strat_trend');
  const [initialBalance, setInitialBalance] = useState(10000);
  const [riskPerTradePercent, setRiskPerTradePercent] = useState(1.0);
  const [stopLossPercent, setStopLossPercent] = useState(2.0);
  const [takeProfitRatio, setTakeProfitRatio] = useState(2.0);
  const [periodDays, setPeriodDays] = useState(60);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (activeTab === 'STANDARD') {
      onRunBacktest({
        symbol,
        timeframe,
        strategyId,
        initialBalance,
        riskPerTradePercent,
        stopLossPercent,
        takeProfitRatio,
        periodDays,
      });
    } else if (activeTab === 'WALK_FORWARD') {
      onRunWalkForward({
        symbol,
        timeframe,
        strategyId,
        initialBalance,
      });
    }
  };

  // Helper to render Equity SVG curve
  const renderEquityCurve = (curve: { time: string; equity: number }[]) => {
    if (!curve || curve.length < 2) return null;

    const equities = curve.map((c) => c.equity);
    const minVal = Math.min(...equities) * 0.98;
    const maxVal = Math.max(...equities) * 1.02;
    const range = maxVal - minVal || 1;

    const width = 800;
    const height = 240;

    const points = curve
      .map((c, i) => {
        const x = (i / (curve.length - 1)) * width;
        const y = height - ((c.equity - minVal) / range) * height;
        return `${x},${y}`;
      })
      .join(' ');

    const lastVal = equities[equities.length - 1];
    const isProfitable = lastVal >= curve[0].equity;

    return (
      <div className="relative w-full overflow-hidden bg-slate-950/60 rounded-xl p-4 border border-slate-800">
        <div className="flex justify-between items-center text-xs text-slate-400 mb-2 font-mono-num">
          <span>{curve[0].time} (${curve[0].equity})</span>
          <span className={isProfitable ? 'text-emerald-400 font-bold' : 'text-red-400 font-bold'}>
            {curve[curve.length - 1].time} (${lastVal.toFixed(2)})
          </span>
        </div>
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-44 overflow-visible">
          <defs>
            <linearGradient id="equityGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={isProfitable ? '#10b981' : '#ef4444'} stopOpacity="0.3" />
              <stop offset="100%" stopColor={isProfitable ? '#10b981' : '#ef4444'} stopOpacity="0.0" />
            </linearGradient>
          </defs>
          {/* Baseline */}
          <line
            x1="0"
            y1={height - ((curve[0].equity - minVal) / range) * height}
            x2={width}
            y2={height - ((curve[0].equity - minVal) / range) * height}
            stroke="#334155"
            strokeDasharray="4 4"
            strokeWidth="1"
          />
          {/* Fill Area */}
          <polygon
            points={`0,${height} ${points} ${width},${height}`}
            fill="url(#equityGrad)"
          />
          {/* Stroke Line */}
          <polyline
            points={points}
            fill="none"
            stroke={isProfitable ? '#10b981' : '#ef4444'}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* View Header & Tabs */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-slate-900/90 border border-slate-800 p-4 rounded-xl">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/30 flex items-center justify-center text-purple-400">
            <Terminal className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-100">{t.backtestTitle}</h2>
            <p className="text-xs text-slate-400">{t.backtestSubtitle}</p>
          </div>
        </div>

        <div className="flex bg-slate-800 p-1 rounded-lg border border-slate-700 text-xs">
          <button
            onClick={() => setActiveTab('STANDARD')}
            className={`px-3 py-1.5 rounded-md font-semibold transition-colors ${
              activeTab === 'STANDARD' ? 'bg-purple-600 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {lang === 'ar' ? 'اختبار تاريخي شامل' : 'Standard Backtest'}
          </button>
          <button
            onClick={() => setActiveTab('WALK_FORWARD')}
            className={`px-3 py-1.5 rounded-md font-semibold transition-colors ${
              activeTab === 'WALK_FORWARD' ? 'bg-purple-600 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {t.walkForwardTab}
          </button>
          <button
            onClick={() => setActiveTab('PAPER_VS_LIVE')}
            className={`px-3 py-1.5 rounded-md font-semibold transition-colors ${
              activeTab === 'PAPER_VS_LIVE' ? 'bg-purple-600 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {t.paperVsLiveTab}
          </button>
        </div>
      </div>

      {/* Tab 1: Standard Backtest */}
      {activeTab === 'STANDARD' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Controls Form */}
          <div className="bg-slate-900/90 border border-slate-800 p-5 rounded-xl space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
              {lang === 'ar' ? 'معايير المحاكاة التاريخية' : 'Simulation Parameters'}
            </h3>

            <form onSubmit={handleSubmit} className="space-y-3 text-xs">
              <div>
                <label className="text-slate-400 block mb-1">{t.symbol}:</label>
                <select
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value)}
                  className="w-full p-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 font-mono-num"
                >
                  <option value="BTCUSDT">BTCUSDT (Bitcoin)</option>
                  <option value="ETHUSDT">ETHUSDT (Ethereum)</option>
                  <option value="SOLUSDT">SOLUSDT (Solana)</option>
                  <option value="BNBUSDT">BNBUSDT (BNB)</option>
                  <option value="XRPUSDT">XRPUSDT (Ripple)</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-slate-400 block mb-1">{t.timeframe}:</label>
                  <select
                    value={timeframe}
                    onChange={(e) => setTimeframe(e.target.value)}
                    className="w-full p-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 font-mono-num"
                  >
                    <option value="5m">5m</option>
                    <option value="15m">15m</option>
                    <option value="1h">1h</option>
                    <option value="4h">4h</option>
                  </select>
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">{t.periodDays}:</label>
                  <select
                    value={periodDays}
                    onChange={(e) => setPeriodDays(Number(e.target.value))}
                    className="w-full p-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 font-mono-num"
                  >
                    <option value={30}>30 Days</option>
                    <option value={60}>60 Days</option>
                    <option value={90}>90 Days</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-slate-400 block mb-1">{t.strategy}:</label>
                <select
                  value={strategyId}
                  onChange={(e) => setStrategyId(e.target.value)}
                  className="w-full p-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 font-mono-num"
                >
                  <option value="strat_trend">Multi-Timeframe Trend & EMA Cross</option>
                  <option value="strat_breakout">Market Structure Breakout (BOS)</option>
                  <option value="strat_fractal">Fractal Liquidity Hunt</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-slate-400 block mb-1">{t.initialCapital}:</label>
                  <input
                    type="number"
                    value={initialBalance}
                    onChange={(e) => setInitialBalance(Number(e.target.value))}
                    className="w-full p-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 font-mono-num"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">{t.riskPerTrade}:</label>
                  <input
                    type="number"
                    step="0.1"
                    value={riskPerTradePercent}
                    onChange={(e) => setRiskPerTradePercent(Number(e.target.value))}
                    className="w-full p-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 font-mono-num"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-slate-400 block mb-1">Stop Loss (%):</label>
                  <input
                    type="number"
                    step="0.1"
                    value={stopLossPercent}
                    onChange={(e) => setStopLossPercent(Number(e.target.value))}
                    className="w-full p-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 font-mono-num"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Target Ratio (R:R):</label>
                  <input
                    type="number"
                    step="0.1"
                    value={takeProfitRatio}
                    onChange={(e) => setTakeProfitRatio(Number(e.target.value))}
                    className="w-full p-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 font-mono-num"
                  />
                </div>
              </div>

              <div className="p-2.5 rounded-lg bg-slate-800/40 border border-slate-700/50 text-[11px] text-slate-400 space-y-1">
                <div>Spot Fee: 0.1% per trade</div>
                <div>Slippage Model: 0.05% entry/exit</div>
                <div>Zero Look-ahead Bias: Enforced</div>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-2.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-purple-900/30 transition-all active:scale-95 disabled:opacity-50"
              >
                <Play className="w-4 h-4 fill-white" />
                <span>{isLoading ? 'Simulating...' : t.runBacktest}</span>
              </button>
            </form>
          </div>

          {/* Results Summary & Equity Curve */}
          <div className="lg:col-span-2 space-y-6">
            {result ? (
              <>
                {/* Metric Cards */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800">
                    <span className="text-slate-400 text-xs block">{t.netProfit}</span>
                    <span
                      className={`text-lg font-bold font-mono-num ${
                        (result.netProfit ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'
                      }`}
                    >
                      {(result.netProfit ?? 0) >= 0 ? '+' : ''}${(result.netProfit ?? 0).toFixed(2)}
                    </span>
                    <span className="text-[10px] text-slate-400 block font-mono-num">
                      {(result.netReturnPercent ?? 0) >= 0 ? '+' : ''}{(result.netReturnPercent ?? 0).toFixed(1)}% Return
                    </span>
                  </div>

                  <div className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800">
                    <span className="text-slate-400 text-xs block">{t.winRate}</span>
                    <span className="text-lg font-bold font-mono-num text-purple-400">
                      {(result.winRate ?? 0).toFixed(1)}%
                    </span>
                    <span className="text-[10px] text-slate-400 block font-mono-num">
                      {result.winningTrades ?? 0}W / {result.losingTrades ?? 0}L ({result.totalTrades ?? 0} total)
                    </span>
                  </div>

                  <div className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800">
                    <span className="text-slate-400 text-xs block">{t.profitFactor}</span>
                    <span className="text-lg font-bold font-mono-num text-slate-100">
                      {(result.profitFactor ?? 0).toFixed(2)}
                    </span>
                    <span className="text-[10px] text-slate-400 block font-mono-num">
                      Sharpe: {(result.sharpeRatio ?? 0).toFixed(2)}
                    </span>
                  </div>

                  <div className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800">
                    <span className="text-slate-400 text-xs block">{t.maxDrawdown}</span>
                    <span className="text-lg font-bold font-mono-num text-red-400">
                      -{(result.maxDrawdownPercent ?? 0).toFixed(1)}%
                    </span>
                    <span className="text-[10px] text-slate-400 block font-mono-num">
                      Safe capital threshold
                    </span>
                  </div>
                </div>

                {/* Equity Curve */}
                <div className="space-y-2">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                    {t.equityCurveTitle}
                  </h3>
                  {renderEquityCurve(result.equityCurve || [])}
                </div>

                {/* Detailed Breakdown */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs bg-slate-900/60 p-3 rounded-xl border border-slate-800 font-mono-num">
                  <div>
                    <span className="text-slate-400 text-[10px] block">{t.avgWin}:</span>
                    <span className="text-emerald-400 font-semibold">+${(result.averageTradeProfit ?? 0).toFixed(2)}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 text-[10px] block">{t.avgLoss}:</span>
                    <span className="text-red-400 font-semibold">-${Math.abs(result.averageTradeLoss ?? 0).toFixed(2)}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 text-[10px] block">{t.largestWin}:</span>
                    <span className="text-emerald-400 font-semibold">+${(result.largestWin ?? 0).toFixed(2)}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 text-[10px] block">{t.largestLoss}:</span>
                    <span className="text-red-400 font-semibold">-${Math.abs(result.largestLoss ?? 0).toFixed(2)}</span>
                  </div>
                </div>
              </>
            ) : (
              <div className="p-12 text-center text-slate-500 bg-slate-900/40 rounded-xl border border-slate-800 text-xs">
                Configure parameters and click "{t.runBacktest}" to start historical simulation.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 2: Walk-Forward Testing */}
      {activeTab === 'WALK_FORWARD' && (
        <div className="bg-slate-900/90 border border-slate-800 p-6 rounded-xl space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-slate-100">
                {lang === 'ar' ? 'فحص التوافق الزائد والموثوقية (Walk-Forward Analysis)' : 'Walk-Forward Out-of-Sample Robustness Test'}
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                {lang === 'ar'
                  ? 'يقسم المحرك البيانات إلى 70% للتدريب (In-Sample) و 30% للاختبار على بيانات غير مرئية (Out-of-Sample) لكشف منحنى التوافق الزائد.'
                  : 'Splits historical candles into 70% In-Sample and 30% Out-of-Sample to prevent curve-fitting and guarantee real-world edge.'}
              </p>
            </div>
            <button
              onClick={handleSubmit}
              disabled={isLoading}
              className="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs flex items-center gap-2 shadow-md transition-all active:scale-95 disabled:opacity-50"
            >
              <Play className="w-4 h-4 fill-white" />
              <span>{isLoading ? 'Testing...' : (lang === 'ar' ? 'بدء فحص Walk-Forward' : 'Run Walk-Forward')}</span>
            </button>
          </div>

          {wfResult ? (
            <div className="space-y-6">
              {/* Verdict Banner */}
              <div
                className={`p-4 rounded-xl border flex items-center justify-between ${
                  wfResult.robustnessVerdict === 'ROBUST'
                    ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-300'
                    : wfResult.robustnessVerdict === 'MODERATE'
                    ? 'bg-amber-500/10 border-amber-500/40 text-amber-300'
                    : wfResult.robustnessVerdict === 'INSUFFICIENT_DATA'
                    ? 'bg-sky-500/10 border-sky-500/40 text-sky-300'
                    : 'bg-red-500/10 border-red-500/40 text-red-300'
                }`}
              >
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="w-5 h-5" />
                  <div>
                    <span className="text-xs font-bold uppercase tracking-wider block">
                      {lang === 'ar' ? 'حكم المتانة: ' : 'Robustness Verdict: '}
                      {wfResult.robustnessVerdict === 'INSUFFICIENT_DATA'
                        ? (lang === 'ar' ? 'بيانات غير كافية' : 'INSUFFICIENT DATA')
                        : wfResult.robustnessVerdict === 'ROBUST'
                        ? (lang === 'ar' ? 'قوية' : 'ROBUST')
                        : wfResult.robustnessVerdict === 'MODERATE'
                        ? (lang === 'ar' ? 'متوسطة' : 'MODERATE')
                        : (lang === 'ar' ? 'مُفرطة التخصيص' : 'OVERFITTED')}
                    </span>
                    <span className="text-xs text-slate-300">
                      {lang === 'ar'
                        ? `نسبة الكفاءة (شارب خارج العينة / داخل العينة): ${wfResult.efficiencyRatio}`
                        : `Efficiency Ratio (Out-of-sample Sharpe / In-sample Sharpe): ${wfResult.efficiencyRatio}`}
                    </span>
                  </div>
                </div>
                <div className="text-xs font-bold font-mono-num text-end">
                  {wfResult.robustnessVerdict === 'ROBUST'
                    ? (lang === 'ar' ? 'خطر تخصيص منخفض' : 'Low Overfitting Risk')
                    : wfResult.robustnessVerdict === 'MODERATE'
                    ? (lang === 'ar' ? 'تعميم متوسط' : 'Moderate Generalization')
                    : wfResult.robustnessVerdict === 'INSUFFICIENT_DATA'
                    ? (lang === 'ar' ? 'ليست دليلاً على الفشل' : 'Not Evidence Of Failure')
                    : (lang === 'ar' ? 'تحذير تخصيص شديد' : 'Severe Overfitting Caution')}
                  {typeof wfResult.informativeFolds === 'number' && (
                    <span className="block font-normal text-[10px] text-slate-400 mt-1">
                      {lang === 'ar'
                        ? `نوافذ صالحة: ${wfResult.informativeFolds}/${wfResult.totalFolds} · خارج العينة مجمّع: ${wfResult.pooledOutOfSampleTrades ?? 0} صفقة، عامل ربح ${wfResult.pooledOutOfSampleProfitFactor ?? 0}`
                        : `Informative folds: ${wfResult.informativeFolds}/${wfResult.totalFolds} · Pooled OOS: ${wfResult.pooledOutOfSampleTrades ?? 0} trades, PF ${wfResult.pooledOutOfSampleProfitFactor ?? 0}`}
                    </span>
                  )}
                </div>
              </div>

              {/* Side-by-Side Comparison */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* In Sample */}
                <div className="p-4 rounded-xl bg-slate-800/40 border border-slate-700/60 space-y-3">
                  <div className="flex justify-between items-center pb-2 border-b border-slate-700">
                    <span className="text-xs font-bold text-slate-200">In-Sample Data (70%)</span>
                    <span className="text-[10px] text-slate-400 font-mono-num">Training Window</span>
                  </div>
                  <div className="space-y-1 text-xs font-mono-num">
                    <div className="flex justify-between">
                      <span className="text-slate-400">Total Trades:</span>
                      <span className="text-slate-200">{wfResult.inSample?.totalTrades ?? 0}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Win Rate:</span>
                      <span className="text-emerald-400">{(wfResult.inSample?.winRate ?? 0).toFixed(1)}%</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Profit Factor:</span>
                      <span className="text-slate-200">{(wfResult.inSample?.profitFactor ?? 0).toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Sharpe Ratio:</span>
                      <span className="text-amber-400">{(wfResult.inSample?.sharpeRatio ?? 0).toFixed(2)}</span>
                    </div>
                  </div>
                </div>

                {/* Out of Sample */}
                <div className="p-4 rounded-xl bg-slate-800/40 border border-slate-700/60 space-y-3">
                  <div className="flex justify-between items-center pb-2 border-b border-slate-700">
                    <span className="text-xs font-bold text-slate-200">Out-of-Sample Data (30%)</span>
                    <span className="text-[10px] text-emerald-400 font-mono-num font-bold">Unseen Testing</span>
                  </div>
                  <div className="space-y-1 text-xs font-mono-num">
                    <div className="flex justify-between">
                      <span className="text-slate-400">Total Trades:</span>
                      <span className="text-slate-200">{wfResult.outOfSample?.totalTrades ?? 0}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Win Rate:</span>
                      <span className="text-emerald-400">{(wfResult.outOfSample?.winRate ?? 0).toFixed(1)}%</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Profit Factor:</span>
                      <span className="text-slate-200">{(wfResult.outOfSample?.profitFactor ?? 0).toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Sharpe Ratio:</span>
                      <span className="text-amber-400">{(wfResult.outOfSample?.sharpeRatio ?? 0).toFixed(2)}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-10 text-center text-slate-500 text-xs">
              Click "Run Walk-Forward" to evaluate strategy robustness against unseen market regimes.
            </div>
          )}
        </div>
      )}

      {/* Tab 3: Paper vs Live Comparison */}
      {activeTab === 'PAPER_VS_LIVE' && (
        <div className="bg-slate-900/90 border border-slate-800 p-6 rounded-xl space-y-6">
          <div>
            <h3 className="text-base font-bold text-slate-100">
              {lang === 'ar' ? 'مصفوفة مقارنة التداول التجريبي مقابل الحقيقي' : 'Paper Trading vs. Live Trading Comparison Matrix'}
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              {lang === 'ar'
                ? 'فهم الفروقات الجوهرية بين بيئة المحاكاة وبيئة التنفيذ الحقيقية على منصة Binance'
                : 'Key factors that differentiate simulated sandbox execution from live order book fills.'}
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-800/60 text-slate-300 border-b border-slate-700">
                  <th className="text-left py-3 px-4 font-semibold">Factor</th>
                  <th className="text-left py-3 px-4 font-semibold text-emerald-400">Paper Trading</th>
                  <th className="text-left py-3 px-4 font-semibold text-amber-400">Live Trading</th>
                  <th className="text-left py-3 px-4 font-semibold">System Safeguard</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 text-slate-300">
                <tr>
                  <td className="py-3 px-4 font-bold text-slate-200">Execution Speed</td>
                  <td className="py-3 px-4">Instantaneous (Simulated)</td>
                  <td className="py-3 px-4 font-mono-num">20ms - 80ms network roundtrip</td>
                  <td className="py-3 px-4 text-slate-400">Latency ping & timeout guards</td>
                </tr>
                <tr>
                  <td className="py-3 px-4 font-bold text-slate-200">Order Slippage</td>
                  <td className="py-3 px-4 font-mono-num">0.05% modeled</td>
                  <td className="py-3 px-4">Subject to live order book depth</td>
                  <td className="py-3 px-4 text-slate-400">Max slippage rejection threshold</td>
                </tr>
                <tr>
                  <td className="py-3 px-4 font-bold text-slate-200">Trading Fees</td>
                  <td className="py-3 px-4 font-mono-num">0.10% deducted mathematically</td>
                  <td className="py-3 px-4 font-mono-num">Deducted in BNB / quote asset</td>
                  <td className="py-3 px-4 text-slate-400">Account balance sufficiency checks</td>
                </tr>
                <tr>
                  <td className="py-3 px-4 font-bold text-slate-200">Emotional Factor</td>
                  <td className="py-3 px-4">Zero emotional stress</td>
                  <td className="py-3 px-4">Potential panic / intervention</td>
                  <td className="py-3 px-4 text-slate-400">Automated Circuit Breaker & Kill Switch</td>
                </tr>
                <tr>
                  <td className="py-3 px-4 font-bold text-slate-200">Capital at Risk</td>
                  <td className="py-3 px-4 text-emerald-400 font-bold">$0 Real Risk</td>
                  <td className="py-3 px-4 text-amber-400 font-bold">Real Account USDT</td>
                  <td className="py-3 px-4 text-slate-400">1-2% position sizing formula limit</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
