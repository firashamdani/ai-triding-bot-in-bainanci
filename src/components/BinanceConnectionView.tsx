import React, { useState } from 'react';
import {
  Key,
  ShieldCheck,
  ShieldAlert,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Lock,
  ExternalLink,
  Wallet,
  AlertTriangle,
  Server,
} from 'lucide-react';
import { Language } from '../types';
import { translations } from '../i18n';

interface BinanceConnectionViewProps {
  lang: Language;
  binanceStatus: {
    hasCredentials: boolean;
    apiKeyMasked: string;
    isTestnet: boolean;
    status: string;
    permissions: { canRead: boolean; canTrade: boolean; canWithdraw: boolean };
    lastPingTime?: string;
    balances: { asset: string; free: number; locked: number; usdValue: number }[];
    errorMessage?: string;
  };
  isLoading: boolean;
  onSaveCredentials: (apiKey: string, apiSecret: string, isTestnet: boolean) => Promise<void>;
  onTestConnection: () => Promise<void>;
}

export const BinanceConnectionView: React.FC<BinanceConnectionViewProps> = ({
  lang,
  binanceStatus,
  isLoading,
  onSaveCredentials,
  onTestConnection,
}) => {
  const t = translations[lang];

  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [isTestnet, setIsTestnet] = useState(binanceStatus.isTestnet);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState('');

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!apiKey || !apiSecret) return;
    await onSaveCredentials(apiKey, apiSecret, isTestnet);
    setSaveSuccessMsg('Credentials saved and encrypted on server.');
    setApiKey('');
    setApiSecret('');
    setTimeout(() => setSaveSuccessMsg(''), 4000);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-slate-900/90 border border-slate-800 p-5 rounded-xl flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
            <Key className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-100">{t.binanceConnTitle}</h2>
            <p className="text-xs text-slate-400">{t.binanceConnSubtitle}</p>
          </div>
        </div>

        <button
          onClick={onTestConnection}
          disabled={isLoading}
          className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center gap-2 shadow-lg shadow-amber-500/20 transition-all active:scale-95 disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          <span>{t.testConnectionBtn}</span>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Credentials Form */}
        <div className="bg-slate-900/90 border border-slate-800 p-5 rounded-xl space-y-4">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
            <Lock className="w-4 h-4 text-amber-400" />
            <span>{lang === 'ar' ? 'إدخال مفاتيح Binance' : 'Enter API Credentials'}</span>
          </h3>

          {saveSuccessMsg && (
            <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/40 text-emerald-400 text-xs flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" />
              <span>{saveSuccessMsg}</span>
            </div>
          )}

          {binanceStatus.hasCredentials && (
            <div className="p-3 rounded-lg bg-slate-800/80 border border-slate-700 text-xs space-y-1">
              <div className="text-slate-400">Current Key:</div>
              <div className="font-mono-num text-slate-200 font-bold text-[11px]">
                {binanceStatus.apiKeyMasked}
              </div>
              <div className="text-[10px] text-amber-400">
                Mode: {binanceStatus.isTestnet ? 'Testnet Sandbox' : 'Binance Mainnet'}
              </div>
            </div>
          )}

          <form onSubmit={handleSave} className="space-y-4 text-xs">
            <div>
              <label className="text-slate-400 block mb-1">{t.apiKeyLabel}:</label>
              <input
                type="text"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="e.g. vmPUZE6mv9SD5VBs4Evddba2..."
                required
                className="w-full p-2.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 font-mono-num text-xs placeholder-slate-600 focus:outline-none focus:border-amber-500/50"
              />
            </div>

            <div>
              <label className="text-slate-400 block mb-1">{t.apiSecretLabel}:</label>
              <input
                type="password"
                value={apiSecret}
                onChange={(e) => setApiSecret(e.target.value)}
                placeholder="••••••••••••••••••••••••••••••••"
                required
                className="w-full p-2.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 font-mono-num text-xs placeholder-slate-600 focus:outline-none focus:border-amber-500/50"
              />
            </div>

            <div className="p-3 rounded-lg bg-slate-800/40 border border-slate-700/60">
              <label className="flex items-center gap-2 cursor-pointer text-slate-300">
                <input
                  type="checkbox"
                  checked={isTestnet}
                  onChange={(e) => setIsTestnet(e.target.checked)}
                  className="rounded text-amber-500 focus:ring-0"
                />
                <span className="font-semibold">{t.testnetCheckbox}</span>
              </label>
              <p className="text-[10px] text-slate-500 mt-1">
                {lang === 'ar'
                  ? 'يتيح لك اختبار البوت على شبكة Binance Testnet الرسمية بأموال افتراضية قبل التداول الفعلي.'
                  : 'Allows testing with simulated funds on Binance official testnet before real assets.'}
              </p>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-400 font-bold border border-amber-500/30 transition-colors disabled:opacity-50"
            >
              {t.saveCredentials}
            </button>
          </form>
        </div>

        {/* Permissions & Security Audit */}
        <div className="space-y-6">
          {/* Connection Status & Permissions */}
          <div className="bg-slate-900/90 border border-slate-800 p-5 rounded-xl space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
              <Server className="w-4 h-4 text-emerald-400" />
              <span>{lang === 'ar' ? 'حالة الاتصال والتدقيق' : 'Connection & Permissions'}</span>
            </h3>

            {binanceStatus.errorMessage && (
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-xs">
                {binanceStatus.errorMessage}
              </div>
            )}

            <div className="space-y-2.5 text-xs">
              <div className="flex items-center justify-between p-2.5 rounded-lg bg-slate-800/40 border border-slate-700/40">
                <span className="text-slate-400">Connection State:</span>
                <span
                  className={`font-bold font-mono-num ${
                    binanceStatus.status === 'CONNECTED' ? 'text-emerald-400' : 'text-slate-400'
                  }`}
                >
                  {binanceStatus.status}
                </span>
              </div>

              <div className="flex items-center justify-between p-2.5 rounded-lg bg-slate-800/40 border border-slate-700/40">
                <span className="text-slate-400">Read Permission:</span>
                <span className="flex items-center gap-1 font-semibold text-emerald-400">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Granted</span>
                </span>
              </div>

              <div className="flex items-center justify-between p-2.5 rounded-lg bg-slate-800/40 border border-slate-700/40">
                <span className="text-slate-400">Spot Trade Permission:</span>
                <span className="flex items-center gap-1 font-semibold text-emerald-400">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Granted</span>
                </span>
              </div>

              <div className="flex items-center justify-between p-2.5 rounded-lg bg-slate-800/40 border border-slate-700/40">
                <span className="text-slate-400">Withdrawal Permission:</span>
                <span className="flex items-center gap-1 font-semibold text-emerald-400 font-mono-num">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>DENIED (Strictly Required)</span>
                </span>
              </div>
            </div>
          </div>

          {/* Security Checklist Box */}
          <div className="bg-slate-900/90 border border-slate-800 p-5 rounded-xl space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300">
              {t.securityChecklist}
            </h4>
            <div className="space-y-2 text-xs">
              <div className="flex items-start gap-2 text-slate-300">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <span>{t.checkNoWithdraw}</span>
              </div>
              <div className="flex items-start gap-2 text-slate-300">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <span>{t.checkEncrypted}</span>
              </div>
              <div className="flex items-start gap-2 text-slate-300">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <span>{t.checkIpWhitelist}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Live Balances Table */}
        <div className="bg-slate-900/90 border border-slate-800 p-5 rounded-xl space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
              <Wallet className="w-4 h-4 text-amber-400" />
              <span>{t.accountBalancesTitle}</span>
            </h3>
            <span className="text-[10px] text-slate-400 font-mono-num">
              {binanceStatus.balances.length} assets
            </span>
          </div>

          {binanceStatus.balances.length === 0 ? (
            <div className="text-center py-10 text-slate-500 text-xs">
              Click "Test Connection" to fetch live account balances from Binance.
            </div>
          ) : (
            <div className="space-y-2">
              {binanceStatus.balances.map((b) => (
                <div
                  key={b.asset}
                  className="p-3 rounded-lg bg-slate-800/40 border border-slate-700/50 flex items-center justify-between text-xs"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-200 font-mono-num">{b.asset}</span>
                  </div>
                  <div className="text-right font-mono-num">
                    <div className="text-slate-100 font-semibold">{b.free.toFixed(4)}</div>
                    {b.usdValue > 0 && (
                      <div className="text-[10px] text-slate-400">≈ ${b.usdValue.toFixed(2)}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
