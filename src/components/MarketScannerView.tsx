import React, { useState } from 'react';
import {
  Activity,
  ArrowUpRight,
  ArrowDownRight,
  RefreshCw,
  Search,
  Filter,
  Cpu,
  Zap,
  CheckCircle,
  AlertCircle,
  HelpCircle,
} from 'lucide-react';
import { Language, MarketSymbol } from '../types';
import { translations } from '../i18n';

export interface ScannerItem {
  symbol: string;
  price: number;
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
  entryZone: string;
  riskRewardRatio: string;
  reasoning: string[];
}

interface MarketScannerViewProps {
  lang: Language;
  scannerItems: ScannerItem[];
  isLoading: boolean;
  onRefresh: () => void;
  onSelectSymbolForAi: (symbol: string) => void;
  onQuickTrade: (symbol: string, side: 'BUY' | 'SELL', confidence: number) => void;
}

export const MarketScannerView: React.FC<MarketScannerViewProps> = ({
  lang,
  scannerItems = [],
  isLoading,
  onRefresh,
  onSelectSymbolForAi,
  onQuickTrade,
}) => {
  const t = translations[lang];
  const [filterType, setFilterType] = useState<'ALL' | 'BUY_ONLY' | 'HIGH_CONFIDENCE'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  const safeItems = scannerItems || [];
  const filteredItems = safeItems.filter((item) => {
    if (!item) return false;
    if (searchQuery && !item.symbol.toLowerCase().includes(searchQuery.toLowerCase())) {
      return false;
    }
    if (filterType === 'BUY_ONLY') {
      return item.prediction === 'BUY' || item.prediction === 'STRONG_BUY';
    }
    if (filterType === 'HIGH_CONFIDENCE') {
      return item.confidenceScore >= 80;
    }
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Header and Controls */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-slate-900/90 border border-slate-800 p-4 rounded-xl">
        <div>
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-amber-400" />
            <h2 className="text-base font-bold text-slate-100">{t.scannerTitle}</h2>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">{t.scannerSubtitle}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          {/* Search */}
          <div className="relative flex-1 sm:w-48">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-500" />
            <input
              type="text"
              placeholder={lang === 'ar' ? 'بحث عن زوج...' : 'Search symbol...'}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-slate-800/80 border border-slate-700 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500/50"
            />
          </div>

          {/* Filter Pills */}
          <div className="flex items-center gap-1 bg-slate-800/80 p-1 rounded-lg border border-slate-700">
            <button
              onClick={() => setFilterType('ALL')}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                filterType === 'ALL' ? 'bg-amber-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {lang === 'ar' ? 'الكل' : 'All'}
            </button>
            <button
              onClick={() => setFilterType('BUY_ONLY')}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                filterType === 'BUY_ONLY' ? 'bg-emerald-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {lang === 'ar' ? 'إشارات شراء' : 'Buys Only'}
            </button>
            <button
              onClick={() => setFilterType('HIGH_CONFIDENCE')}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                filterType === 'HIGH_CONFIDENCE' ? 'bg-purple-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {lang === 'ar' ? 'ثقة عالية (≥80%)' : '≥80% Score'}
            </button>
          </div>

          {/* Refresh Button */}
          <button
            onClick={onRefresh}
            disabled={isLoading}
            className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-amber-400 border border-slate-700 transition-colors disabled:opacity-50"
            title="Scan symbols"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-amber-400' : ''}`} />
          </button>
        </div>
      </div>

      {/* Scanner Results Table */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-800/40 text-slate-400 border-b border-slate-800">
                <th className="text-left py-3 px-4 font-semibold">{t.symbol}</th>
                <th className="text-left py-3 px-3 font-semibold">{t.price}</th>
                <th className="text-left py-3 px-3 font-semibold">{t.signal}</th>
                <th className="text-left py-3 px-3 font-semibold">{t.aiScore}</th>
                <th className="text-left py-3 px-3 font-semibold">{t.trend} (4H)</th>
                <th className="text-left py-3 px-3 font-semibold">{t.marketStructure} (1H)</th>
                <th className="text-left py-3 px-3 font-semibold">{t.entryZone}</th>
                <th className="text-left py-3 px-3 font-semibold">{t.riskRewardRatio}</th>
                <th className="text-right py-3 px-4 font-semibold">{t.action}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center py-10 text-slate-500">
                    {isLoading ? 'Scanning Binance markets with AI engine...' : 'No symbols match filter.'}
                  </td>
                </tr>
              ) : (
                filteredItems.map((item) => {
                  const isBuy = item.prediction === 'STRONG_BUY' || item.prediction === 'BUY';
                  const isSell = item.prediction === 'STRONG_SELL' || item.prediction === 'SELL';

                  return (
                    <tr key={item.symbol} className="hover:bg-slate-800/30 transition-colors">
                      <td className="py-3 px-4 font-bold text-slate-100 flex items-center gap-2">
                        <button
                          onClick={() => onSelectSymbolForAi(item.symbol)}
                          className="hover:text-amber-400 font-mono-num"
                        >
                          {item.symbol}
                        </button>
                      </td>
                      <td className="py-3 px-3 font-mono-num text-slate-200 font-semibold">
                        ${item.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td className="py-3 px-3">
                        <span
                          className={`px-2 py-0.5 rounded font-bold font-mono-num text-[11px] ${
                            item.prediction === 'STRONG_BUY'
                              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                              : item.prediction === 'BUY'
                              ? 'bg-emerald-500/10 text-emerald-300'
                              : item.prediction === 'WAIT'
                              ? 'bg-slate-800 text-slate-400'
                              : item.prediction === 'SELL'
                              ? 'bg-red-500/10 text-red-300'
                              : 'bg-red-500/20 text-red-400 border border-red-500/40'
                          }`}
                        >
                          {item.prediction}
                        </span>
                      </td>
                      <td className="py-3 px-3">
                        <div className="flex items-center gap-2">
                          <div className="w-12 bg-slate-800 rounded-full h-2 overflow-hidden">
                            <div
                              className={`h-full ${
                                item.confidenceScore >= 80
                                  ? 'bg-emerald-500'
                                  : item.confidenceScore >= 65
                                  ? 'bg-amber-500'
                                  : 'bg-slate-600'
                              }`}
                              style={{ width: `${item.confidenceScore}%` }}
                            />
                          </div>
                          <span className="font-mono-num font-bold text-slate-200">
                            {item.confidenceScore}%
                          </span>
                        </div>
                      </td>
                      <td className="py-3 px-3">
                        <span
                          className={`font-semibold ${
                            item.factors.trend === 'BULLISH'
                              ? 'text-emerald-400'
                              : item.factors.trend === 'BEARISH'
                              ? 'text-red-400'
                              : 'text-slate-400'
                          }`}
                        >
                          {item.factors.trend}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-slate-300">
                        {item.factors.structure.replace('_', ' ')}
                      </td>
                      <td className="py-3 px-3">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                            item.factors.entryZone === 'OPTIMAL'
                              ? 'bg-emerald-500/15 text-emerald-400'
                              : item.factors.entryZone === 'RISKY'
                              ? 'bg-red-500/15 text-red-400'
                              : 'bg-slate-800 text-slate-300'
                          }`}
                        >
                          {item.factors.entryZone}
                        </span>
                      </td>
                      <td className="py-3 px-3 font-mono-num text-slate-300">
                        {item.riskRewardRatio}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => onSelectSymbolForAi(item.symbol)}
                            className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-amber-400 text-xs font-medium border border-slate-700 transition-colors"
                          >
                            {t.inspectAi}
                          </button>
                          {isBuy && (
                            <button
                              onClick={() => onQuickTrade(item.symbol, 'BUY', item.confidenceScore)}
                              className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-all shadow-md active:scale-95"
                            >
                              {lang === 'ar' ? 'تنفيذ' : 'Trade'}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
