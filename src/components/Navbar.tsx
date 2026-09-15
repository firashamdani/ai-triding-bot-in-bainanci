import React, { useState } from 'react';
import {
  ShieldAlert,
  Globe,
  Bell,
  Cpu,
  Zap,
  CheckCircle2,
  AlertTriangle,
  Menu,
  X,
  LogOut,
  Layers,
  BarChart3,
  Sliders,
  Terminal,
  Activity,
  Key,
} from 'lucide-react';
import { AppView, Language, User, AppNotification, SystemHealth } from '../types';
import { translations } from '../i18n';

interface NavbarProps {
  currentView: AppView;
  setCurrentView: (view: AppView) => void;
  lang: Language;
  setLang: (lang: Language) => void;
  currentUser: User | null;
  onLogout: () => void;
  onOpenLogin: () => void;
  onEmergencyStopClick: () => void;
  tradingMode: 'PAPER' | 'LIVE';
  onToggleTradingMode: () => void;
  binanceStatus?: {
    hasCredentials: boolean;
    isTestnet: boolean;
    status: string;
    lastPingMs?: number;
  };
  systemHealth?: SystemHealth | null;
  notifications?: AppNotification[];
  onMarkNotificationsRead?: () => void;
  onSwitchRole?: (newRole: 'ADMIN' | 'USER') => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentView,
  setCurrentView,
  lang,
  setLang,
  currentUser,
  onLogout,
  onOpenLogin,
  onEmergencyStopClick,
  tradingMode,
  onToggleTradingMode,
  binanceStatus = { hasCredentials: true, isTestnet: true, status: 'CONNECTED' },
  systemHealth = null,
  notifications = [],
  onMarkNotificationsRead = () => {},
  onSwitchRole,
}) => {
  const t = translations[lang];
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  const safeNotifications = notifications || [];
  const unreadCount = safeNotifications.filter((n) => !n?.read).length;

  const navItems: { view: AppView; label: string; icon: React.ReactNode; adminOnly?: boolean }[] = [
    { view: 'DASHBOARD', label: t.navDashboard, icon: <BarChart3 className="w-4 h-4" /> },
    { view: 'SCANNER', label: t.navScanner, icon: <Activity className="w-4 h-4" /> },
    { view: 'AI_ANALYSIS', label: t.navAiAnalysis, icon: <Cpu className="w-4 h-4" /> },
    { view: 'TRADES', label: t.navTrades, icon: <Layers className="w-4 h-4" /> },
    { view: 'BACKTEST', label: t.navBacktest, icon: <Terminal className="w-4 h-4" /> },
    { view: 'BINANCE', label: t.navBinance, icon: <Key className="w-4 h-4" /> },
    { view: 'SETTINGS', label: t.navSettings, icon: <Sliders className="w-4 h-4" /> },
    { view: 'ADMIN', label: t.navAdmin, icon: <ShieldAlert className="w-4 h-4" />, adminOnly: true },
    { view: 'HEALTH_DOCS', label: t.navHealthDocs, icon: <Zap className="w-4 h-4" /> },
  ];

  return (
    <header className="sticky top-0 z-40 bg-[#0d111a]/95 backdrop-blur-md border-b border-slate-800">
      <div className="max-w-7xl mx-auto px-3 sm:px-6">
        <div className="flex items-center justify-between h-16">
          {/* Logo & Brand */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => setCurrentView('LANDING')}
              className="flex items-center gap-2.5 text-left focus:outline-none group"
            >
              <div className="w-9 h-9 rounded-lg bg-gradient-to-tr from-amber-500 to-yellow-300 p-0.5 shadow-lg shadow-amber-500/20 group-hover:scale-105 transition-transform">
                <div className="w-full h-full bg-[#0b0e14] rounded-[7px] flex items-center justify-center">
                  <span className="font-bold text-amber-400 text-sm font-mono-num">AI</span>
                </div>
              </div>
              <div>
                <span className="text-sm font-bold text-slate-100 tracking-tight block">
                  BINANCE <span className="text-amber-400">AI</span>
                </span>
                <span className="text-[10px] text-slate-400 hidden sm:block">Algorithmic Station</span>
              </div>
            </button>

            {/* Mode Indicator & Switcher */}
            {currentUser && (
              <button
                onClick={onToggleTradingMode}
                className={`ml-2 px-2.5 py-1 rounded-full text-xs font-semibold flex items-center gap-1.5 transition-all ${
                  tradingMode === 'LIVE'
                    ? 'bg-red-500/20 text-red-400 border border-red-500/40 hover:bg-red-500/30'
                    : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 hover:bg-emerald-500/30'
                }`}
                title="Click to toggle between Paper and Live Trading"
              >
                <span className={`w-2 h-2 rounded-full ${tradingMode === 'LIVE' ? 'bg-red-400 animate-pulse' : 'bg-emerald-400'}`} />
                {tradingMode === 'LIVE' ? t.liveMode : t.paperMode}
              </button>
            )}

            {/* Binance Connection Status Indicator */}
            {currentUser && (
              <div className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-900 border border-slate-800 text-[11px] text-slate-300 font-mono-num">
                <span className="text-amber-400 font-bold">Binance:</span>
                {binanceStatus.hasCredentials ? (
                  <span className="text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" />
                    {binanceStatus.isTestnet ? t.testnet : t.mainnet}
                  </span>
                ) : (
                  <span className="text-slate-400">{t.disconnected}</span>
                )}
              </div>
            )}

            {/* Circuit Breaker Alert */}
            {systemHealth?.circuitBreakerTripped && (
              <div className="hidden md:flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-500/20 border border-amber-500/50 text-[11px] text-amber-300 animate-pulse">
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>{t.circuitBreaker}: {t.tripped}</span>
              </div>
            )}
          </div>

          {/* Desktop Navigation Links */}
          {currentUser && (
            <nav className="hidden xl:flex items-center gap-1">
              {navItems.map((item) => {
                if (item.adminOnly && currentUser.role !== 'ADMIN') return null;
                const isActive = currentView === item.view;
                return (
                  <button
                    key={item.view}
                    onClick={() => setCurrentView(item.view)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      isActive
                        ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                    }`}
                  >
                    {item.icon}
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
          )}

          {/* Action Tools & User Menu */}
          <div className="flex items-center gap-2">
            {/* Language Switcher */}
            <button
              onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}
              className="px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs font-medium text-slate-300 hover:text-slate-100 flex items-center gap-1.5 transition-colors"
              title="Toggle Language / تبديل اللغة"
            >
              <Globe className="w-3.5 h-3.5 text-amber-400" />
              <span>{lang === 'ar' ? 'EN' : 'العربية'}</span>
            </button>

            {/* Notifications Dropdown */}
            {currentUser && (
              <div className="relative">
                <button
                  onClick={() => {
                    setNotificationsOpen(!notificationsOpen);
                    if (!notificationsOpen && unreadCount > 0) {
                      onMarkNotificationsRead();
                    }
                  }}
                  className="p-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:text-slate-100 relative transition-colors"
                  aria-label="Notifications"
                >
                  <Bell className="w-4 h-4" />
                  {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 w-4 h-4 bg-amber-500 text-black font-bold text-[10px] rounded-full flex items-center justify-center">
                      {unreadCount}
                    </span>
                  )}
                </button>

                {notificationsOpen && (
                  <div className={`absolute top-full mt-2 w-80 bg-slate-900 border border-slate-800 rounded-xl shadow-2xl p-3 z-50 ${lang === 'ar' ? 'left-0' : 'right-0'}`}>
                    <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                      <span className="text-xs font-bold text-slate-200">System Notifications</span>
                      <span className="text-[10px] text-slate-400 font-mono-num">{safeNotifications.length} alerts</span>
                    </div>
                    <div className="max-h-64 overflow-y-auto mt-2 space-y-2">
                      {safeNotifications.length === 0 ? (
                        <p className="text-xs text-slate-500 text-center py-4">No recent notifications</p>
                      ) : (
                        safeNotifications.slice(0, 10).map((n) => (
                          <div key={n.id} className="p-2 rounded-lg bg-slate-800/60 text-xs border border-slate-700/50">
                            <div className="flex items-center justify-between text-[10px] text-slate-400 mb-0.5">
                              <span className="font-semibold text-amber-400">{n.type}</span>
                              <span className="font-mono-num">{new Date(n.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                            </div>
                            <p className="font-semibold text-slate-200 text-[11px]">{n.title}</p>
                            <p className="text-slate-400 text-[11px] mt-0.5">{n.message}</p>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* EMERGENCY STOP BUTTON */}
            {currentUser && (
              <button
                onClick={onEmergencyStopClick}
                className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-red-600 to-rose-700 hover:from-red-500 hover:to-rose-600 text-white font-bold text-xs flex items-center gap-1.5 shadow-lg shadow-red-900/30 active:scale-95 transition-all"
                title="Immediate kill switch for trading engine"
              >
                <ShieldAlert className="w-4 h-4 animate-bounce" />
                <span className="hidden sm:inline font-mono-num">{t.emergencyStop}</span>
              </button>
            )}

            {/* User Profile or Login */}
            {currentUser ? (
              <div className="flex items-center gap-2 pl-2 border-l border-slate-800">
                <div className="text-right hidden sm:block">
                  <div className="text-xs font-bold text-slate-200 flex items-center gap-1 justify-end">
                    {currentUser.name}
                    {currentUser.role === 'ADMIN' ? (
                      <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/40 text-[9px] font-mono-num font-bold">
                        ADMIN
                      </span>
                    ) : (
                      <span className="px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 border border-blue-500/40 text-[9px] font-mono-num font-bold">
                        USER
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-slate-400 font-mono-num">{currentUser.email}</div>
                </div>

                {/* Quick Role Switcher Button */}
                {onSwitchRole && (
                  <button
                    onClick={() => onSwitchRole(currentUser.role === 'ADMIN' ? 'USER' : 'ADMIN')}
                    className={`px-2 py-1 rounded-lg text-[10px] font-mono-num font-bold border transition-all flex items-center gap-1 shadow-sm ${
                      currentUser.role === 'ADMIN'
                        ? 'bg-amber-500/15 text-amber-300 border-amber-500/40 hover:bg-amber-500/25'
                        : 'bg-blue-500/15 text-blue-300 border-blue-500/40 hover:bg-blue-500/25'
                    }`}
                    title={
                      lang === 'ar'
                        ? `الرتبة الحالية: ${currentUser.role}. انقر للتبديل إلى ${currentUser.role === 'ADMIN' ? 'USER' : 'ADMIN'}`
                        : `Current role: ${currentUser.role}. Click to switch to ${currentUser.role === 'ADMIN' ? 'USER' : 'ADMIN'}`
                    }
                  >
                    <span>{currentUser.role === 'ADMIN' ? '👑 Admin' : '👤 Trader'}</span>
                    <span className="text-[9px] opacity-60">⇄</span>
                  </button>
                )}

                <button
                  onClick={onLogout}
                  className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-red-400 transition-colors"
                  title="Logout"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <button
                onClick={onOpenLogin}
                className="px-4 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs shadow-md transition-all"
              >
                {t.loginToDashboard}
              </button>
            )}

            {/* Mobile Menu Button */}
            {currentUser && (
              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="xl:hidden p-2 rounded-lg bg-slate-900 text-slate-400 hover:text-slate-200"
              >
                {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </button>
            )}
          </div>
        </div>

        {/* Mobile Navigation Drawer */}
        {mobileMenuOpen && currentUser && (
          <div className="xl:hidden py-3 border-t border-slate-800 grid grid-cols-2 sm:grid-cols-3 gap-2">
            {navItems.map((item) => {
              if (item.adminOnly && currentUser.role !== 'ADMIN') return null;
              const isActive = currentView === item.view;
              return (
                <button
                  key={item.view}
                  onClick={() => {
                    setCurrentView(item.view);
                    setMobileMenuOpen(false);
                  }}
                  className={`flex items-center gap-2 p-2.5 rounded-lg text-xs font-medium ${
                    isActive ? 'bg-amber-500/20 text-amber-400' : 'bg-slate-900 text-slate-300'
                  }`}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </header>
  );
};
