import React, { useState } from 'react';
import {
  ShieldAlert,
  Users,
  Cpu,
  Power,
  Lock,
  Unlock,
  CheckCircle2,
  AlertTriangle,
  FileText,
  Search,
  Filter,
} from 'lucide-react';
import { Language, AuditLog, SystemHealth, User } from '../types';
import { translations } from '../i18n';

interface AdminViewProps {
  lang: Language;
  systemHealth: SystemHealth | null;
  totalUsers?: number;
  activeBots?: number;
  paperPositions?: number;
  livePositions?: number;
  totalTradesCount?: number;
  users?: User[];
  auditLogs?: AuditLog[];
  onToggleKillSwitch: (active: boolean) => Promise<void>;
  onToggleLiveTrading: (enabled: boolean) => Promise<void>;
  onToggleRegistration: (enabled: boolean) => Promise<void>;
  isLoading: boolean;
}

export const AdminView: React.FC<AdminViewProps> = ({
  lang,
  systemHealth,
  totalUsers = 0,
  activeBots = 0,
  paperPositions = 0,
  livePositions = 0,
  totalTradesCount = 0,
  users = [],
  auditLogs = [],
  onToggleKillSwitch,
  onToggleLiveTrading,
  onToggleRegistration,
  isLoading,
}) => {
  const t = translations[lang];

  const [logFilter, setLogFilter] = useState<'ALL' | 'ALERT' | 'WARNING' | 'INFO'>('ALL');
  const [searchLog, setSearchLog] = useState('');

  const safeLogs = auditLogs || [];
  const filteredLogs = safeLogs.filter((log) => {
    if (!log) return false;
    if (logFilter !== 'ALL' && log.severity !== logFilter) return false;
    if (searchLog && !log.details?.toLowerCase().includes(searchLog.toLowerCase()) && !log.action?.toLowerCase().includes(searchLog.toLowerCase())) {
      return false;
    }
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-slate-900/90 border border-slate-800 p-5 rounded-xl flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
            <ShieldAlert className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-100">{t.adminTitle}</h2>
            <p className="text-xs text-slate-400">{t.adminSubtitle}</p>
          </div>
        </div>
      </div>

      {/* Global Safety & Master Controls */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Global Kill Switch */}
        <div className="p-5 rounded-xl bg-slate-900/90 border border-slate-800 flex flex-col justify-between space-y-4">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold uppercase text-slate-200">{t.globalKillSwitch}</span>
              <Power className={`w-4 h-4 ${systemHealth?.globalKillSwitchActive ? 'text-red-400' : 'text-slate-500'}`} />
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">{t.killSwitchDesc}</p>
          </div>

          <button
            onClick={() => onToggleKillSwitch(!systemHealth?.globalKillSwitchActive)}
            disabled={isLoading}
            className={`w-full py-2.5 rounded-lg text-xs font-bold transition-all shadow-lg active:scale-95 ${
              systemHealth?.globalKillSwitchActive
                ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                : 'bg-red-600 hover:bg-red-500 text-white shadow-red-900/30'
            }`}
          >
            {systemHealth?.globalKillSwitchActive
              ? (lang === 'ar' ? 'فك تجميد النظام (Disengage Kill Switch)' : 'Disengage Kill Switch')
              : (lang === 'ar' ? 'تفعيل الإيقاف العام (Engage Kill Switch)' : 'Engage Kill Switch')}
          </button>
        </div>

        {/* Global Live Trading Gate */}
        <div className="p-5 rounded-xl bg-slate-900/90 border border-slate-800 flex flex-col justify-between space-y-4">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold uppercase text-slate-200">{t.toggleLiveTradingGlobally}</span>
              {systemHealth?.globalLiveTradingEnabled ? (
                <Unlock className="w-4 h-4 text-emerald-400" />
              ) : (
                <Lock className="w-4 h-4 text-amber-400" />
              )}
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              {lang === 'ar'
                ? 'التحكم الإداري في إتاحة التداول الحقيقي للمستخدمين أو حظرها للاختبار فقط.'
                : 'Master permission gate for allowing real Binance Spot execution across the platform.'}
            </p>
          </div>

          <button
            onClick={() => onToggleLiveTrading(!systemHealth?.globalLiveTradingEnabled)}
            disabled={isLoading}
            className={`w-full py-2.5 rounded-lg text-xs font-bold transition-all shadow-md active:scale-95 ${
              systemHealth?.globalLiveTradingEnabled
                ? 'bg-amber-600 hover:bg-amber-500 text-white'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'
            }`}
          >
            {systemHealth?.globalLiveTradingEnabled
              ? (lang === 'ar' ? 'تعطيل التداول الحقيقي للمنصة' : 'Disable Live Trading Globally')
              : (lang === 'ar' ? 'تفعيل التداول الحقيقي للمنصة' : 'Enable Live Trading Globally')}
          </button>
        </div>

        {/* User Registration Gate */}
        <div className="p-5 rounded-xl bg-slate-900/90 border border-slate-800 flex flex-col justify-between space-y-4">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold uppercase text-slate-200">{t.toggleRegistration}</span>
              <Users className="w-4 h-4 text-blue-400" />
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              {lang === 'ar'
                ? 'السماح للجمهور بإنشاء حسابات جديدة أو حصر المنصة للمدعوين وحسابات الاختبار.'
                : 'Control whether public user registration is open or restricted during current phase.'}
            </p>
          </div>

          <button
            onClick={() => onToggleRegistration(!systemHealth?.registrationEnabled)}
            disabled={isLoading}
            className={`w-full py-2.5 rounded-lg text-xs font-bold transition-all shadow-md active:scale-95 ${
              systemHealth?.registrationEnabled
                ? 'bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700'
                : 'bg-blue-600 hover:bg-blue-500 text-white'
            }`}
          >
            {systemHealth?.registrationEnabled
              ? (lang === 'ar' ? 'تعطيل تسجيل المستخدمين' : 'Disable Registration')
              : (lang === 'ar' ? 'إتاحة تسجيل المستخدمين' : 'Enable Registration')}
          </button>
        </div>
      </div>

      {/* Platform Counters */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800">
          <span className="text-slate-400 text-xs block">Total Registered Users</span>
          <span className="text-xl font-bold font-mono-num text-slate-100">{totalUsers}</span>
        </div>
        <div className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800">
          <span className="text-slate-400 text-xs block">Active Running Bots</span>
          <span className="text-xl font-bold font-mono-num text-emerald-400">{activeBots}</span>
        </div>
        <div className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800">
          <span className="text-slate-400 text-xs block">Paper Trading Positions</span>
          <span className="text-xl font-bold font-mono-num text-blue-400">{paperPositions}</span>
        </div>
        <div className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800">
          <span className="text-slate-400 text-xs block">Live Trading Positions</span>
          <span className="text-xl font-bold font-mono-num text-amber-400">{livePositions}</span>
        </div>
        <div className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800 col-span-2 sm:col-span-1">
          <span className="text-slate-400 text-xs block">Total Trades Executed</span>
          <span className="text-xl font-bold font-mono-num text-purple-400">{totalTradesCount}</span>
        </div>
      </div>

      {/* Audit Logs Stream */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 space-y-4 shadow-xl">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-amber-400" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">
              {t.auditLogsTitle}
            </h3>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex bg-slate-800 p-1 rounded-lg border border-slate-700 text-xs">
              {(['ALL', 'ALERT', 'WARNING', 'INFO'] as const).map((sev) => (
                <button
                  key={sev}
                  onClick={() => setLogFilter(sev)}
                  className={`px-2 py-0.5 rounded text-[11px] font-semibold transition-colors ${
                    logFilter === sev ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {sev}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="max-h-80 overflow-y-auto space-y-2">
          {filteredLogs.length === 0 ? (
            <p className="text-center py-8 text-xs text-slate-500">No audit logs recorded matching filter.</p>
          ) : (
            filteredLogs.map((log) => (
              <div
                key={log.id}
                className="p-3 rounded-lg bg-slate-800/40 border border-slate-700/50 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
              >
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2 font-mono-num">
                    <span
                      className={`px-1.5 py-0.2 rounded text-[9px] font-bold ${
                        log.severity === 'ALERT'
                          ? 'bg-red-500/20 text-red-400 border border-red-500/40'
                          : log.severity === 'WARNING'
                          ? 'bg-amber-500/20 text-amber-400'
                          : 'bg-blue-500/10 text-blue-400'
                      }`}
                    >
                      {log.severity}
                    </span>
                    <span className="font-bold text-slate-200">{log.action}</span>
                    <span className="text-[10px] text-slate-500">User: {log.userId}</span>
                  </div>
                  <p className="text-slate-300 text-[11px] leading-relaxed">{log.details}</p>
                </div>
                <div className="text-[10px] text-slate-500 font-mono-num whitespace-nowrap">
                  {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
