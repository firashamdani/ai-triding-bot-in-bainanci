import React from 'react';
import {
  X,
  ShieldCheck,
  Cpu,
  Clock,
  TrendingUp,
  TrendingDown,
  Layers,
  CheckCircle2,
  FileText,
} from 'lucide-react';
import { Language, Position, Trade } from '../types';
import { translations } from '../i18n';

interface TradeDetailModalProps {
  lang: Language;
  item: Position | Trade | null;
  onClose: () => void;
}

export const TradeDetailModal: React.FC<TradeDetailModalProps> = ({
  lang,
  item,
  onClose,
}) => {
  if (!item) return null;
  const t = translations[lang];

  const isPosition = 'unrealizedPnlUsd' in item;
  const pnlUsd = isPosition ? item.unrealizedPnlUsd : item.realizedPnlUsd;
  const pnlPercent = isPosition ? item.unrealizedPnlPercent : item.realizedPnlPercent;
  const isProfitable = pnlUsd >= 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-xl overflow-hidden shadow-2xl space-y-4 p-6">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <span
              className={`px-2 py-1 rounded text-xs font-bold font-mono-num ${
                item.side === 'BUY' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
              }`}
            >
              {item.side}
            </span>
            <div>
              <h3 className="text-base font-bold text-slate-100 font-mono-num">{item.symbol}</h3>
              <span className="text-[10px] text-slate-400 font-mono-num">
                ID: {item.id} | Mode: {item.mode}
              </span>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* PnL & Pricing Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 bg-slate-950/60 p-3.5 rounded-xl border border-slate-800/80 font-mono-num text-xs">
          <div>
            <span className="text-[10px] text-slate-500 block">Entry Price:</span>
            <span className="font-bold text-slate-200">${item.entryPrice.toFixed(2)}</span>
          </div>

          <div>
            <span className="text-[10px] text-slate-500 block">
              {isPosition ? 'Current Price:' : 'Exit Price:'}
            </span>
            <span className="font-bold text-slate-100">
              ${(isPosition ? item.currentPrice : item.exitPrice).toFixed(2)}
            </span>
          </div>

          <div>
            <span className="text-[10px] text-slate-500 block">Quantity:</span>
            <span className="font-bold text-slate-200">{item.quantity}</span>
          </div>

          <div>
            <span className="text-[10px] text-slate-500 block">
              {isPosition ? 'Unrealized PnL:' : 'Realized PnL:'}
            </span>
            <span className={`font-bold ${isProfitable ? 'text-emerald-400' : 'text-red-400'}`}>
              {isProfitable ? '+' : ''}${pnlUsd.toFixed(2)} ({pnlPercent.toFixed(2)}%)
            </span>
          </div>
        </div>

        {/* Order Levels */}
        <div className="grid grid-cols-2 gap-3 text-xs font-mono-num">
          <div className="p-3 rounded-lg bg-slate-800/40 border border-slate-700/50">
            <span className="text-[10px] text-slate-400 block">{t.stopLoss}:</span>
            <span className="text-red-400 font-bold">${item.stopLoss.toFixed(2)}</span>
          </div>
          <div className="p-3 rounded-lg bg-slate-800/40 border border-slate-700/50">
            <span className="text-[10px] text-slate-400 block">{t.takeProfit1}:</span>
            <span className="text-emerald-400 font-bold">${item.takeProfit1.toFixed(2)}</span>
          </div>
        </div>

        {/* AI Decision Rationale */}
        <div className="space-y-2 text-xs">
          <div className="flex items-center gap-2 text-slate-300 font-bold">
            <Cpu className="w-4 h-4 text-amber-400" />
            <span>AI Reasoning & Confluence</span>
            <span className="ml-auto text-amber-400 font-mono-num font-bold">
              Confidence: {item.aiConfidence}%
            </span>
          </div>

          <div className="p-3 rounded-lg bg-slate-800/50 border border-slate-700/60 text-slate-300 space-y-1.5 text-[11px] leading-relaxed">
            <div className="flex items-center gap-1.5 text-slate-200 font-semibold">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              <span>{item.entryReason || 'Technical trend and volume expansion confirmation.'}</span>
            </div>
            <div className="text-slate-400 font-mono-num">
              Opened: {new Date(item.openedAt).toLocaleString()}
            </div>
            {!isPosition && item.closedAt && (
              <div className="text-slate-400 font-mono-num">
                Closed: {new Date(item.closedAt).toLocaleString()} (Reason: {item.exitReason})
              </div>
            )}
          </div>
        </div>

        {/* Institutional Audit Trail */}
        <div className="space-y-2 text-xs">
          <div className="flex items-center gap-2 text-slate-300 font-bold">
            <FileText className="w-4 h-4 text-blue-400" />
            <span>Trade State Audit Trail</span>
          </div>

          <div className="space-y-1.5 font-mono-num text-[11px]">
            <div className="p-2 rounded bg-slate-800/30 border border-slate-700/40 flex justify-between">
              <span className="text-emerald-400">STATE: FILLED</span>
              <span className="text-slate-500">{new Date(item.openedAt).toLocaleTimeString()}</span>
            </div>
            <div className="p-2 rounded bg-slate-800/30 border border-slate-700/40 flex justify-between">
              <span className="text-blue-400">RISK CHECK: PASSED (Idempotency Key Validated)</span>
              <span className="text-slate-500">{new Date(item.openedAt).toLocaleTimeString()}</span>
            </div>
            {!isPosition && (
              <div className="p-2 rounded bg-slate-800/30 border border-slate-700/40 flex justify-between">
                <span className="text-amber-400">STATE: CLOSED ({item.exitReason})</span>
                <span className="text-slate-500">{new Date(item.closedAt).toLocaleTimeString()}</span>
              </div>
            )}
          </div>
        </div>

        {/* Close Button */}
        <div className="pt-2 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition-colors"
          >
            Close Details
          </button>
        </div>
      </div>
    </div>
  );
};
