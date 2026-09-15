import React, { useState } from 'react';
import {
  Layers,
  History,
  TrendingUp,
  TrendingDown,
  ExternalLink,
  Filter,
  CheckCircle2,
  XCircle,
  Clock,
  ShieldCheck,
} from 'lucide-react';
import { Language, Position, Trade } from '../types';
import { translations } from '../i18n';

interface TradesViewProps {
  lang: Language;
  positions?: Position[];
  trades?: Trade[];
  onClosePosition: (id: string) => void;
  onViewTradeAudit: (item: Position | Trade) => void;
}

export const TradesView: React.FC<TradesViewProps> = ({
  lang,
  positions = [],
  trades = [],
  onClosePosition,
  onViewTradeAudit,
}) => {
  const t = translations[lang];
  const [activeTab, setActiveTab] = useState<'POSITIONS' | 'HISTORY'>('POSITIONS');
  const [modeFilter, setModeFilter] = useState<'ALL' | 'PAPER' | 'LIVE'>('ALL');

  const safePositions = positions || [];
  const safeTrades = trades || [];

  const filteredPositions = safePositions.filter((p) => {
    if (!p) return false;
    if (modeFilter === 'ALL') return true;
    return p.mode === modeFilter;
  });

  const filteredTrades = safeTrades.filter((tr) => {
    if (!tr) return false;
    if (modeFilter === 'ALL') return true;
    return tr.mode === modeFilter;
  });

  return (
    <div className="space-y-6">
      {/* Header and Filter Controls */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-slate-900/90 border border-slate-800 p-4 rounded-xl">
        <div className="flex items-center gap-2">
          <div className="flex bg-slate-800 p-1 rounded-lg border border-slate-700">
            <button
              onClick={() => setActiveTab('POSITIONS')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors ${
                activeTab === 'POSITIONS' ? 'bg-amber-500 text-slate-950' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>{t.activePositions}</span>
              <span className="ml-1 px-1.5 py-0.2 rounded-full bg-slate-900/60 text-[10px] font-mono-num">
                {safePositions.length}
              </span>
            </button>
            <button
              onClick={() => setActiveTab('HISTORY')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors ${
                activeTab === 'HISTORY' ? 'bg-amber-500 text-slate-950' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <History className="w-3.5 h-3.5" />
              <span>{t.tradesHistory}</span>
              <span className="ml-1 px-1.5 py-0.2 rounded-full bg-slate-900/60 text-[10px] font-mono-num">
                {safeTrades.length}
              </span>
            </button>
          </div>
        </div>

        {/* Mode Filter */}
        <div className="flex items-center gap-1.5 bg-slate-800/80 p-1 rounded-lg border border-slate-700 text-xs">
          <span className="text-[10px] text-slate-400 px-2 font-semibold">Filter:</span>
          {(['ALL', 'PAPER', 'LIVE'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setModeFilter(m)}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                modeFilter === m ? 'bg-slate-700 text-white font-bold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {/* Positions Table */}
      {activeTab === 'POSITIONS' && (
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-800/40 text-slate-400 border-b border-slate-800">
                  <th className="text-left py-3 px-4 font-semibold">{t.symbol}</th>
                  <th className="text-left py-3 px-3 font-semibold">{t.side}</th>
                  <th className="text-left py-3 px-3 font-semibold">Mode</th>
                  <th className="text-left py-3 px-3 font-semibold">{t.quantity}</th>
                  <th className="text-left py-3 px-3 font-semibold">{t.entryPrice}</th>
                  <th className="text-left py-3 px-3 font-semibold">{t.price}</th>
                  <th className="text-left py-3 px-3 font-semibold">{t.stopLoss}</th>
                  <th className="text-left py-3 px-3 font-semibold">{t.takeProfit1}</th>
                  <th className="text-left py-3 px-3 font-semibold">{t.pnl}</th>
                  <th className="text-left py-3 px-3 font-semibold">AI Conf.</th>
                  <th className="text-right py-3 px-4 font-semibold">{t.action}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {filteredPositions.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="text-center py-10 text-slate-500">
                      {t.noPositions}
                    </td>
                  </tr>
                ) : (
                  filteredPositions.map((pos) => {
                    const isPos = pos.unrealizedPnlUsd >= 0;
                    return (
                      <tr key={pos.id} className="hover:bg-slate-800/30 transition-colors">
                        <td className="py-3 px-4 font-bold text-slate-100">
                          <button
                            onClick={() => onViewTradeAudit(pos)}
                            className="hover:text-amber-400 flex items-center gap-1.5"
                          >
                            <span>{pos.symbol}</span>
                            <ExternalLink className="w-3 h-3 text-slate-500" />
                          </button>
                        </td>
                        <td className="py-3 px-3">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold font-mono-num ${
                              pos.side === 'BUY' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                            }`}
                          >
                            {pos.side}
                          </span>
                        </td>
                        <td className="py-3 px-3">
                          <span
                            className={`px-1.5 py-0.2 rounded text-[9px] font-bold font-mono-num ${
                              pos.mode === 'LIVE' ? 'bg-red-500/20 text-red-400' : 'bg-slate-800 text-slate-400'
                            }`}
                          >
                            {pos.mode}
                          </span>
                        </td>
                        <td className="py-3 px-3 font-mono-num text-slate-300">{pos.quantity}</td>
                        <td className="py-3 px-3 font-mono-num text-slate-300">${pos.entryPrice.toFixed(2)}</td>
                        <td className="py-3 px-3 font-mono-num text-slate-100 font-semibold">${pos.currentPrice.toFixed(2)}</td>
                        <td className="py-3 px-3 font-mono-num text-red-400/80">${pos.stopLoss.toFixed(2)}</td>
                        <td className="py-3 px-3 font-mono-num text-emerald-400/80">${pos.takeProfit1.toFixed(2)}</td>
                        <td className={`py-3 px-3 font-mono-num font-bold ${isPos ? 'text-emerald-400' : 'text-red-400'}`}>
                          {isPos ? '+' : ''}${pos.unrealizedPnlUsd.toFixed(2)} ({pos.unrealizedPnlPercent.toFixed(2)}%)
                        </td>
                        <td className="py-3 px-3 font-mono-num text-amber-400 font-bold">{pos.aiConfidence}%</td>
                        <td className="py-3 px-4 text-right">
                          <button
                            onClick={() => onClosePosition(pos.id)}
                            className="px-2.5 py-1 rounded bg-slate-800 hover:bg-red-500/20 text-slate-300 hover:text-red-400 border border-slate-700 hover:border-red-500/30 text-xs font-semibold transition-colors"
                          >
                            {t.closePosition}
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* History Table */}
      {activeTab === 'HISTORY' && (
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-800/40 text-slate-400 border-b border-slate-800">
                  <th className="text-left py-3 px-4 font-semibold">{t.symbol}</th>
                  <th className="text-left py-3 px-3 font-semibold">{t.side}</th>
                  <th className="text-left py-3 px-3 font-semibold">Mode</th>
                  <th className="text-left py-3 px-3 font-semibold">{t.entryPrice}</th>
                  <th className="text-left py-3 px-3 font-semibold">Exit Price</th>
                  <th className="text-left py-3 px-3 font-semibold">{t.pnl}</th>
                  <th className="text-left py-3 px-3 font-semibold">Exit Reason</th>
                  <th className="text-left py-3 px-3 font-semibold">{t.entryTime}</th>
                  <th className="text-left py-3 px-3 font-semibold">{t.exitTime}</th>
                  <th className="text-right py-3 px-4 font-semibold">{t.action}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {filteredTrades.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="text-center py-10 text-slate-500">
                      {t.noTrades}
                    </td>
                  </tr>
                ) : (
                  filteredTrades.map((trade) => {
                    const isPos = trade.realizedPnlUsd >= 0;
                    return (
                      <tr key={trade.id} className="hover:bg-slate-800/30 transition-colors">
                        <td className="py-3 px-4 font-bold text-slate-100">
                          <button
                            onClick={() => onViewTradeAudit(trade)}
                            className="hover:text-amber-400 flex items-center gap-1.5"
                          >
                            <span>{trade.symbol}</span>
                            <ExternalLink className="w-3 h-3 text-slate-500" />
                          </button>
                        </td>
                        <td className="py-3 px-3">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold font-mono-num ${
                              trade.side === 'BUY' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                            }`}
                          >
                            {trade.side}
                          </span>
                        </td>
                        <td className="py-3 px-3">
                          <span
                            className={`px-1.5 py-0.2 rounded text-[9px] font-bold font-mono-num ${
                              trade.mode === 'LIVE' ? 'bg-red-500/20 text-red-400' : 'bg-slate-800 text-slate-400'
                            }`}
                          >
                            {trade.mode}
                          </span>
                        </td>
                        <td className="py-3 px-3 font-mono-num text-slate-300">${trade.entryPrice.toFixed(2)}</td>
                        <td className="py-3 px-3 font-mono-num text-slate-200 font-semibold">${trade.exitPrice.toFixed(2)}</td>
                        <td className={`py-3 px-3 font-mono-num font-bold ${isPos ? 'text-emerald-400' : 'text-red-400'}`}>
                          {isPos ? '+' : ''}${trade.realizedPnlUsd.toFixed(2)} ({trade.realizedPnlPercent.toFixed(2)}%)
                        </td>
                        <td className="py-3 px-3">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                              trade.exitReason === 'TAKE_PROFIT'
                                ? 'bg-emerald-500/15 text-emerald-400'
                                : trade.exitReason === 'STOP_LOSS'
                                ? 'bg-red-500/15 text-red-400'
                                : 'bg-slate-800 text-slate-300'
                            }`}
                          >
                            {trade.exitReason}
                          </span>
                        </td>
                        <td className="py-3 px-3 font-mono-num text-slate-400 text-[11px]">
                          {new Date(trade.openedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td className="py-3 px-3 font-mono-num text-slate-400 text-[11px]">
                          {new Date(trade.closedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <button
                            onClick={() => onViewTradeAudit(trade)}
                            className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-amber-400 text-xs font-medium border border-slate-700 transition-colors"
                          >
                            {t.viewDetails}
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
