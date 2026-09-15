import React, { useState, useEffect } from 'react';
import {
  Sliders,
  ShieldCheck,
  ShieldAlert,
  Save,
  CheckCircle2,
  AlertTriangle,
  Flame,
  Zap,
  RotateCcw,
} from 'lucide-react';
import { Language, BotSettings, Strategy } from '../types';
import { translations } from '../i18n';

interface BotSettingsViewProps {
  lang: Language;
  settings: BotSettings | null;
  strategies: Strategy[];
  circuitBreakerTripped: boolean;
  onSaveSettings: (settings: BotSettings) => Promise<void>;
  onEmergencyStop: () => void;
  onResetCircuitBreaker: () => void;
  isLoading: boolean;
}

export const BotSettingsView: React.FC<BotSettingsViewProps> = ({
  lang,
  settings,
  strategies,
  circuitBreakerTripped,
  onSaveSettings,
  onEmergencyStop,
  onResetCircuitBreaker,
  isLoading,
}) => {
  const t = translations[lang];

  const [localSettings, setLocalSettings] = useState<BotSettings | null>(settings);
  const [successMsg, setSuccessMsg] = useState('');

  useEffect(() => {
    if (settings) setLocalSettings(settings);
  }, [settings]);

  if (!localSettings) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSaveSettings(localSettings);
    setSuccessMsg('Settings saved successfully and active on backend engine.');
    setTimeout(() => setSuccessMsg(''), 4000);
  };

  const allSymbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT'];

  const toggleSymbol = (sym: string) => {
    const list = localSettings.selectedSymbols || [];
    if (list.includes(sym)) {
      setLocalSettings({ ...localSettings, selectedSymbols: list.filter((s) => s !== sym) });
    } else {
      setLocalSettings({ ...localSettings, selectedSymbols: [...list, sym] });
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-slate-900/90 border border-slate-800 p-5 rounded-xl">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
            <Sliders className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-100">{t.botSettingsTitle}</h2>
            <p className="text-xs text-slate-400">{t.botSettingsSubtitle}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {circuitBreakerTripped && (
            <button
              onClick={onResetCircuitBreaker}
              className="px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              <span>{t.resetCircuit}</span>
            </button>
          )}

          <button
            onClick={onEmergencyStop}
            className="px-3.5 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white font-bold text-xs flex items-center gap-1.5 shadow-lg shadow-red-900/30 transition-all active:scale-95"
          >
            <ShieldAlert className="w-4 h-4" />
            <span>{t.emergencyStop}</span>
          </button>
        </div>
      </div>

      {successMsg && (
        <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/40 text-emerald-400 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" />
          <span>{successMsg}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* General & Execution */}
          <div className="bg-slate-900/90 border border-slate-800 p-5 rounded-xl space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
              <Zap className="w-4 h-4 text-amber-400" />
              <span>{t.generalSettings}</span>
            </h3>

            <div className="space-y-3 text-xs">
              <div>
                <label className="text-slate-400 block mb-1">Bot Name:</label>
                <input
                  type="text"
                  value={localSettings.botName}
                  onChange={(e) => setLocalSettings({ ...localSettings, botName: e.target.value })}
                  className="w-full p-2.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 font-semibold"
                />
              </div>

              <div className="p-3 rounded-lg bg-slate-800/40 border border-slate-700/60 flex items-center justify-between">
                <div>
                  <span className="font-semibold text-slate-200 block">Enable Automated Bot Engine</span>
                  <span className="text-[10px] text-slate-400">Allow bot to scan, calculate signals and execute orders</span>
                </div>
                <input
                  type="checkbox"
                  checked={localSettings.isEnabled}
                  onChange={(e) => setLocalSettings({ ...localSettings, isEnabled: e.target.checked })}
                  className="w-4 h-4 rounded text-amber-500"
                />
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Active Trading Markets:</label>
                <div className="flex gap-2">
                  <div className="px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 font-bold text-xs">
                    Binance Spot (Active)
                  </div>
                  <div className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-500 border border-slate-700 text-xs">
                    Futures / Margin (Phase 2 - Modular)
                  </div>
                </div>
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Watched Symbols:</label>
                <div className="flex flex-wrap gap-2">
                  {allSymbols.map((sym) => {
                    const active = (localSettings.selectedSymbols || []).includes(sym);
                    return (
                      <button
                        type="button"
                        key={sym}
                        onClick={() => toggleSymbol(sym)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold font-mono-num transition-colors ${
                          active
                            ? 'bg-amber-500 text-slate-950 shadow-md'
                            : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {sym}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-400 block mb-1">{t.minConfidenceThreshold}:</label>
                  <input
                    type="number"
                    min="50"
                    max="95"
                    value={localSettings.minAiConfidence}
                    onChange={(e) =>
                      setLocalSettings({ ...localSettings, minAiConfidence: Number(e.target.value) })
                    }
                    className="w-full p-2.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 font-mono-num"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Analysis Interval (Seconds):</label>
                  <input
                    type="number"
                    min="5"
                    max="300"
                    value={localSettings.aiAnalysisIntervalSec}
                    onChange={(e) =>
                      setLocalSettings({ ...localSettings, aiAnalysisIntervalSec: Number(e.target.value) })
                    }
                    className="w-full p-2.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 font-mono-num"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Risk Management Engine */}
          <div className="bg-slate-900/90 border border-slate-800 p-5 rounded-xl space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span>{t.riskParameters}</span>
            </h3>

            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-400 block mb-1">{t.riskPerTrade}:</label>
                  <input
                    type="number"
                    step="0.1"
                    min="0.2"
                    max="5.0"
                    value={localSettings.riskPerTradePercent}
                    onChange={(e) =>
                      setLocalSettings({ ...localSettings, riskPerTradePercent: Number(e.target.value) })
                    }
                    className="w-full p-2.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 font-mono-num"
                  />
                  <span className="text-[10px] text-slate-500">Institutional standard: 1.0% - 2.0%</span>
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">{t.maxDailyLoss}:</label>
                  <input
                    type="number"
                    min="10"
                    value={localSettings.maxDailyLossUsd}
                    onChange={(e) =>
                      setLocalSettings({ ...localSettings, maxDailyLossUsd: Number(e.target.value) })
                    }
                    className="w-full p-2.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 font-mono-num"
                  />
                  <span className="text-[10px] text-slate-500">Auto trips circuit breaker</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-400 block mb-1">{t.maxPositionsCount}:</label>
                  <input
                    type="number"
                    min="1"
                    max="10"
                    value={localSettings.maxOpenTrades}
                    onChange={(e) =>
                      setLocalSettings({ ...localSettings, maxOpenTrades: Number(e.target.value) })
                    }
                    className="w-full p-2.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 font-mono-num"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">{t.maxDrawdownLimit}:</label>
                  <input
                    type="number"
                    min="5"
                    max="30"
                    value={localSettings.maxDrawdownPercent}
                    onChange={(e) =>
                      setLocalSettings({ ...localSettings, maxDrawdownPercent: Number(e.target.value) })
                    }
                    className="w-full p-2.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 font-mono-num"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-400 block mb-1">{t.stopLossType}:</label>
                  <select
                    value={localSettings.stopLossType}
                    onChange={(e) =>
                      setLocalSettings({ ...localSettings, stopLossType: e.target.value as any })
                    }
                    className="w-full p-2.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-100"
                  >
                    <option value="FIXED_PERCENT">Fixed Percentage (e.g. 2%)</option>
                    <option value="ATR">ATR Volatility (1.5x ATR)</option>
                    <option value="STRUCTURE">Market Structure (Swing High/Low)</option>
                    <option value="TRAILING">Trailing Stop Loss</option>
                  </select>
                </div>

                <div>
                  <label className="text-slate-400 block mb-1">{t.takeProfitType}:</label>
                  <select
                    value={localSettings.takeProfitType}
                    onChange={(e) =>
                      setLocalSettings({ ...localSettings, takeProfitType: e.target.value as any })
                    }
                    className="w-full p-2.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-100"
                  >
                    <option value="MULTI_TARGET">Multi-Target (TP1 1.5R, TP2 2.5R)</option>
                    <option value="RISK_REWARD">Fixed Risk/Reward (1:2.0)</option>
                    <option value="TRAILING">Trailing Take Profit</option>
                  </select>
                </div>
              </div>

              {/* Sizing Formula Explanation */}
              <div className="p-3 rounded-lg bg-slate-800/40 border border-slate-700/50 text-[11px] text-slate-400">
                <span className="font-bold text-slate-300 block mb-0.5">Automated Sizing Formula:</span>
                <code className="text-amber-400 font-mono-num">
                  Position Size ($) = (Account Balance × Risk %) ÷ (Entry Price - Stop Loss Price)
                </code>
              </div>
            </div>
          </div>
        </div>

        {/* Submit Button */}
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={isLoading}
            className="px-6 py-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center gap-2 shadow-lg shadow-amber-500/20 transition-all active:scale-95 disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            <span>{t.saveSettings}</span>
          </button>
        </div>
      </form>
    </div>
  );
};
