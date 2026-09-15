import React, { useState } from 'react';
import {
  Cpu,
  TrendingUp,
  TrendingDown,
  Layers,
  ShieldAlert,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  Compass,
  Zap,
  BarChart,
  RefreshCw,
} from 'lucide-react';
import { Language, AiPrediction, TechnicalIndicators } from '../types';
import { translations } from '../i18n';

interface AiAnalysisViewProps {
  lang: Language;
  selectedSymbol: string;
  onSymbolChange: (symbol: string) => void;
  prediction: AiPrediction | null;
  indicators: TechnicalIndicators | null;
  isLoading: boolean;
  onReanalyze: () => void;
  onExecuteTrade: (params: {
    symbol: string;
    side: 'BUY' | 'SELL';
    stopLoss: number;
    takeProfit: number;
    aiConfidence: number;
    entryReason: string;
  }) => void;
}

export const AiAnalysisView: React.FC<AiAnalysisViewProps> = ({
  lang,
  selectedSymbol,
  onSymbolChange,
  prediction,
  indicators,
  isLoading,
  onReanalyze,
  onExecuteTrade,
}) => {
  const t = translations[lang];
  const [minConfidence, setMinConfidence] = useState(75);

  const symbolsList = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT'];

  const getPredictionColor = (pred?: string) => {
    switch (pred) {
      case 'STRONG_BUY':
        return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/50';
      case 'BUY':
        return 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30';
      case 'WAIT':
        return 'bg-slate-800 text-slate-300 border-slate-700';
      case 'SELL':
        return 'bg-red-500/10 text-red-300 border-red-500/30';
      case 'STRONG_SELL':
        return 'bg-red-500/20 text-red-400 border-red-500/50';
      default:
        return 'bg-slate-800 text-slate-400 border-slate-700';
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Symbol Selector & Control Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-slate-900/90 border border-slate-800 p-4 rounded-xl">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
            <Cpu className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-100">{t.aiStudioTitle}</h2>
            <p className="text-xs text-slate-400">{t.aiStudioSubtitle}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Symbol Select */}
          <div className="flex items-center gap-1.5 bg-slate-800/80 p-1 rounded-lg border border-slate-700">
            {symbolsList.map((sym) => (
              <button
                key={sym}
                onClick={() => onSymbolChange(sym)}
                className={`px-2.5 py-1 rounded text-xs font-bold font-mono-num transition-colors ${
                  selectedSymbol === sym
                    ? 'bg-amber-500 text-slate-950 shadow-md'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {sym.replace('USDT', '')}
              </button>
            ))}
          </div>

          {/* Re-analyze Button */}
          <button
            onClick={onReanalyze}
            disabled={isLoading}
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-amber-400' : ''}`} />
            <span>{lang === 'ar' ? 'تحديث التحليل' : 'Re-Analyze'}</span>
          </button>
        </div>
      </div>

      {prediction && (
        <>
          {/* Main Decision Banner */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Decision & Score */}
            <div className="p-5 rounded-xl bg-slate-900/90 border border-slate-800 flex flex-col justify-between space-y-4">
              <div>
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-2">
                  {lang === 'ar' ? 'القرار الخوارزمي النهائي' : 'Algorithmic Decision'}
                </span>
                <div
                  className={`inline-block px-4 py-2 rounded-xl text-lg font-extrabold font-mono-num border ${getPredictionColor(
                    prediction.prediction
                  )}`}
                >
                  {prediction.prediction}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-slate-400">{t.confidenceScore}:</span>
                  <span className="font-mono-num font-bold text-lg text-amber-400">
                    {prediction.confidenceScore}%
                  </span>
                </div>
                <div className="w-full bg-slate-800 rounded-full h-3 overflow-hidden p-0.5 border border-slate-700">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      prediction.confidenceScore >= 80
                        ? 'bg-gradient-to-r from-emerald-500 to-green-400'
                        : prediction.confidenceScore >= 65
                        ? 'bg-gradient-to-r from-amber-500 to-yellow-400'
                        : 'bg-gradient-to-r from-slate-600 to-slate-500'
                    }`}
                    style={{ width: `${prediction.confidenceScore}%` }}
                  />
                </div>
                <div className="flex justify-between text-[10px] text-slate-500 mt-1 font-mono-num">
                  <span>Min: 50%</span>
                  <span>Threshold: {minConfidence}%</span>
                  <span>Max: 100%</span>
                </div>
              </div>
            </div>

            {/* Multi-Timeframe Confluence Grid */}
            <div className="p-5 rounded-xl bg-slate-900/90 border border-slate-800 space-y-3">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">
                {lang === 'ar' ? 'توافق الأطر الزمنية' : 'Multi-Timeframe Alignment'}
              </span>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="p-2.5 rounded-lg bg-slate-800/60 border border-slate-700/50">
                  <span className="text-[10px] text-slate-400 block">{t.macroTrend}</span>
                  <span
                    className={`font-bold font-mono-num ${
                      prediction.factors.trend === 'BULLISH'
                        ? 'text-emerald-400'
                        : prediction.factors.trend === 'BEARISH'
                        ? 'text-red-400'
                        : 'text-slate-300'
                    }`}
                  >
                    {prediction.factors.trend}
                  </span>
                </div>

                <div className="p-2.5 rounded-lg bg-slate-800/60 border border-slate-700/50">
                  <span className="text-[10px] text-slate-400 block">{t.marketStructure}</span>
                  <span className="font-bold font-mono-num text-slate-200">
                    {prediction.factors.structure.replace('_', ' ')}
                  </span>
                </div>

                <div className="p-2.5 rounded-lg bg-slate-800/60 border border-slate-700/50">
                  <span className="text-[10px] text-slate-400 block">{t.volume}</span>
                  <span
                    className={`font-bold font-mono-num ${
                      prediction.factors.volume === 'CONFIRMED' ? 'text-emerald-400' : 'text-slate-400'
                    }`}
                  >
                    {prediction.factors.volume}
                  </span>
                </div>

                <div className="p-2.5 rounded-lg bg-slate-800/60 border border-slate-700/50">
                  <span className="text-[10px] text-slate-400 block">{t.entryZone}</span>
                  <span
                    className={`font-bold font-mono-num ${
                      prediction.factors.entryZone === 'OPTIMAL' ? 'text-emerald-400' : 'text-slate-300'
                    }`}
                  >
                    {prediction.factors.entryZone}
                  </span>
                </div>
              </div>
            </div>

            {/* Suggested Order Levels & Execution */}
            <div className="p-5 rounded-xl bg-slate-900/90 border border-slate-800 space-y-3 flex flex-col justify-between">
              <div>
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-2">
                  {lang === 'ar' ? 'معايير الدخول والوقف المحسوبة' : 'Calculated Trade Levels'}
                </span>
                <div className="space-y-1.5 text-xs font-mono-num">
                  <div className="flex justify-between">
                    <span className="text-slate-400">{t.suggestedEntry}:</span>
                    <span className="font-bold text-slate-100">${prediction.suggestedEntry.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">{t.stopLoss}:</span>
                    <span className="font-bold text-red-400">${prediction.suggestedStopLoss.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">{t.takeProfit1}:</span>
                    <span className="font-bold text-emerald-400">${prediction.suggestedTp1.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">{t.riskRewardRatio}:</span>
                    <span className="font-bold text-amber-400">{prediction.riskRewardRatio}</span>
                  </div>
                </div>
              </div>

              <button
                onClick={() =>
                  onExecuteTrade({
                    symbol: prediction.symbol,
                    side: prediction.prediction.includes('SELL') ? 'SELL' : 'BUY',
                    stopLoss: prediction.suggestedStopLoss,
                    takeProfit: prediction.suggestedTp1,
                    aiConfidence: prediction.confidenceScore,
                    entryReason: prediction.reasoning[0] || 'Technical confluence verified',
                  })
                }
                className="w-full py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-emerald-900/20 transition-all active:scale-95"
              >
                <Zap className="w-4 h-4 fill-white" />
                <span>{t.openPositionBtn}</span>
              </button>
            </div>
          </div>

          {/* Detailed Technical Indicators Grid */}
          {indicators && (
            <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 space-y-4">
              <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                <BarChart className="w-4 h-4 text-amber-400" />
                <span>
                  {lang === 'ar' ? 'المؤشرات الفنية المحسوبة للزوج' : 'Technical Indicators Breakdown'} (15M)
                </span>
              </h3>

              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                <div className="p-3 rounded-lg bg-slate-800/60 border border-slate-700/50">
                  <span className="text-[10px] text-slate-400 block">RSI (14)</span>
                  <span className="text-sm font-bold font-mono-num text-slate-100">{indicators.rsi14}</span>
                </div>
                <div className="p-3 rounded-lg bg-slate-800/60 border border-slate-700/50">
                  <span className="text-[10px] text-slate-400 block">EMA 9 / 21</span>
                  <span className="text-sm font-bold font-mono-num text-slate-100">
                    ${indicators.ema9.toFixed(1)} / ${indicators.ema21.toFixed(1)}
                  </span>
                </div>
                <div className="p-3 rounded-lg bg-slate-800/60 border border-slate-700/50">
                  <span className="text-[10px] text-slate-400 block">EMA 50 / 200</span>
                  <span className="text-sm font-bold font-mono-num text-slate-100">
                    ${indicators.ema50.toFixed(1)} / ${indicators.ema200.toFixed(1)}
                  </span>
                </div>
                <div className="p-3 rounded-lg bg-slate-800/60 border border-slate-700/50">
                  <span className="text-[10px] text-slate-400 block">ATR (14) Volatility</span>
                  <span className="text-sm font-bold font-mono-num text-slate-100">${indicators.atr14.toFixed(2)}</span>
                </div>
                <div className="p-3 rounded-lg bg-slate-800/60 border border-slate-700/50">
                  <span className="text-[10px] text-slate-400 block">VWAP</span>
                  <span className="text-sm font-bold font-mono-num text-slate-100">${indicators.vwap.toFixed(2)}</span>
                </div>
                <div className="p-3 rounded-lg bg-slate-800/60 border border-slate-700/50">
                  <span className="text-[10px] text-slate-400 block">Order Block</span>
                  <span className="text-sm font-bold font-mono-num text-amber-400">
                    {indicators.orderBlock.type} (${indicators.orderBlock.priceLevel.toFixed(1)})
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* AI Quantitative Reasoning List */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 space-y-3">
            <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
              <Compass className="w-4 h-4 text-blue-400" />
              <span>{t.reasoningList}</span>
            </h3>

            <div className="space-y-2">
              {prediction.reasoning.map((reason, idx) => (
                <div
                  key={idx}
                  className="p-3 rounded-lg bg-slate-800/40 border border-slate-700/40 text-xs text-slate-300 flex items-start gap-2.5"
                >
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <span className="leading-relaxed">{reason}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
