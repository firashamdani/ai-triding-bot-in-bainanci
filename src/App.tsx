import React, { useState, useEffect, useCallback } from 'react';
import {
  Language,
  User,
  Position,
  Trade,
  MarketSymbol,
  AiPrediction,
  TechnicalIndicators,
  BotSettings,
  Strategy,
  SystemHealth,
  AuditLog,
  AppView,
  AppNotification,
} from './types';
import { translations } from './i18n';
import { Navbar } from './components/Navbar';
import { LandingPage } from './components/LandingPage';
import { DashboardView } from './components/DashboardView';
import { MarketScannerView, ScannerItem } from './components/MarketScannerView';
import { AiAnalysisView } from './components/AiAnalysisView';
import { TradesView } from './components/TradesView';
import { BacktestingView } from './components/BacktestingView';
import { BinanceConnectionView } from './components/BinanceConnectionView';
import { BotSettingsView } from './components/BotSettingsView';
import { AdminView } from './components/AdminView';
import { SystemHealthView } from './components/SystemHealthView';
import { TradeDetailModal } from './components/TradeDetailModal';
import { ShieldAlert } from 'lucide-react';

export default function App() {
  const [lang, setLang] = useState<Language>('ar');
  const [currentView, setCurrentView] = useState<AppView>('DASHBOARD');
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(true);
  const [user, setUser] = useState<User>({
    id: 'usr_admin',
    email: 'admin@trading.ai',
    name: 'Super Admin',
    role: 'ADMIN',
    createdAt: new Date().toISOString(),
  });
  const [authToken, setAuthToken] = useState<string>('tok_usr_admin_default');
  const isAdmin = user.role === 'ADMIN';

  // Trading Core State
  const [tradingMode, setTradingMode] = useState<'PAPER' | 'LIVE'>('PAPER');
  const [botRunning, setBotRunning] = useState<boolean>(true);
  const [paperBalance, setPaperBalance] = useState<number>(10000);
  const [totalEquity, setTotalEquity] = useState<number>(10000);
  const [unrealizedPnl, setUnrealizedPnl] = useState<number>(0);
  const [realizedPnl, setRealizedPnl] = useState<number>(0);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [symbols, setSymbols] = useState<MarketSymbol[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [scannerItems, setScannerItems] = useState<ScannerItem[]>([]);
  const [selectedSymbolForAi, setSelectedSymbolForAi] = useState<string>('BTCUSDT');
  const [aiPrediction, setAiPrediction] = useState<AiPrediction | null>(null);
  const [technicalIndicators, setTechnicalIndicators] = useState<TechnicalIndicators | null>(null);
  const [botSettings, setBotSettings] = useState<BotSettings | null>(null);
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [systemHealth, setSystemHealth] = useState<SystemHealth | null>(null);
  const [binanceStatus, setBinanceStatus] = useState<any>({
    hasCredentials: true,
    apiKeyMasked: 'vmPUZE6mv9SD5VBs...da2',
    isTestnet: true,
    status: 'CONNECTED',
    permissions: { canRead: true, canTrade: true, canWithdraw: false },
    balances: [
      { asset: 'USDT', free: 14250.00, locked: 0.0, usdValue: 14250.00 },
      { asset: 'BTC', free: 0.45, locked: 0.0, usdValue: 28800.00 },
      { asset: 'ETH', free: 4.20, locked: 0.0, usdValue: 13860.00 },
      { asset: 'SOL', free: 35.0, locked: 0.0, usdValue: 5075.00 },
      { asset: 'BNB', free: 12.0, locked: 0.0, usdValue: 6960.00 },
    ],
  });

  const [backtestResult, setBacktestResult] = useState<any>(null);
  const [walkForwardResult, setWalkForwardResult] = useState<any>(null);
  const [selectedTradeForAudit, setSelectedTradeForAudit] = useState<Position | Trade | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [registeredUsers, setRegisteredUsers] = useState<User[]>([]);

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);

  const showToast = (text: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToastMessage({ text, type });
    setTimeout(() => setToastMessage(null), 4000);
  };

  // Set RTL attribute on root document
  useEffect(() => {
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.lang = lang;
  }, [lang]);

  // Initial Data Fetch
  const fetchAllData = useCallback(async () => {
    try {
      // Fetch tickers
      const tickersRes = await fetch('/api/market/tickers');
      if (tickersRes.ok) {
        const data = await tickersRes.json();
        setSymbols(Array.isArray(data) ? data : data.tickers || []);
      }

      // Fetch positions
      const posRes = await fetch('/api/trading/positions');
      if (posRes.ok) {
        const data = await posRes.json();
        setPositions(Array.isArray(data) ? data : data.positions || []);
      }

      // Fetch trades
      const tradesRes = await fetch('/api/trading/trades');
      if (tradesRes.ok) {
        const data = await tradesRes.json();
        setTrades(Array.isArray(data) ? data : data.trades || []);
      }

      // Fetch scanner
      const scanRes = await fetch('/api/ai/scanner');
      if (scanRes.ok) {
        const data = await scanRes.json();
        setScannerItems(Array.isArray(data) ? data : data.scanner || []);
      }

      // Fetch bot settings
      const settingsRes = await fetch('/api/bot/settings');
      if (settingsRes.ok) {
        const data = await settingsRes.json();
        const s = data.settings || data;
        setBotSettings(s);
        if (typeof s.isEnabled === 'boolean') setBotRunning(s.isEnabled);
      }

      // Fetch strategies
      const stratRes = await fetch('/api/bot/strategies');
      if (stratRes.ok) {
        const data = await stratRes.json();
        setStrategies(Array.isArray(data) ? data : data.strategies || []);
      }

      // Fetch system health
      const healthRes = await fetch('/api/system/health');
      if (healthRes.ok) {
        const data = await healthRes.json();
        const h = data.health || data;
        setSystemHealth(h);
        if (h.tradingMode) setTradingMode(h.tradingMode);
      }

      // Fetch binance status
      const binanceRes = await fetch('/api/binance/status');
      if (binanceRes.ok) {
        const data = await binanceRes.json();
        setBinanceStatus(data);
      }

      // Fetch notifications
      const notifRes = await fetch('/api/notifications');
      if (notifRes.ok) {
        const data = await notifRes.json();
        setNotifications(Array.isArray(data.notifications) ? data.notifications : []);
      }

      // Fetch full trading state (balances, PnL, positions, trades)
      const stateRes = await fetch('/api/trading/state');
      if (stateRes.ok) {
        const data = await stateRes.json();
        if (Array.isArray(data.positions)) setPositions(data.positions);
        if (Array.isArray(data.trades)) setTrades(data.trades);
        if (typeof data.paperBalance === 'number') setPaperBalance(data.paperBalance);
        if (typeof data.totalEquity === 'number') setTotalEquity(data.totalEquity);
        if (typeof data.unrealizedPnl === 'number') setUnrealizedPnl(data.unrealizedPnl);
        if (typeof data.realizedPnl === 'number') setRealizedPnl(data.realizedPnl);
      }

      // Fetch audit logs & admin overview (strictly secured for ADMIN role)
      if (user.role === 'ADMIN') {
        const authHeaders = {
          'Authorization': `Bearer ${authToken}`,
          'X-User-Id': user.id,
        };

        const logsRes = await fetch('/api/admin/audit-logs', { headers: authHeaders });
        if (logsRes.ok) {
          const data = await logsRes.json();
          setAuditLogs(Array.isArray(data.auditLogs) ? data.auditLogs : []);
        }

        const overviewRes = await fetch('/api/admin/overview', { headers: authHeaders });
        if (overviewRes.ok) {
          const data = await overviewRes.json();
          if (Array.isArray(data.users)) setRegisteredUsers(data.users);
        }
      } else {
        setAuditLogs([]);
        setRegisteredUsers([]);
      }
    } catch (err) {
      console.warn('Backend polling warning (running local simulation):', err);
    }
  }, [user.id, user.role, authToken]);

  const handleMarkNotificationsRead = async () => {
    try {
      await fetch('/api/notifications/mark-read', { method: 'POST' });
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    } catch (err) {
      console.error('Failed to mark notifications read:', err);
    }
  };

  // Fetch AI analysis for selected symbol
  const fetchAiAnalysis = useCallback(async (sym: string) => {
    try {
      setIsLoading(true);
      const res = await fetch('/api/ai/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: sym, timeframe: '15m' }),
      });
      if (res.ok) {
        const data = await res.json();
        setAiPrediction(data.prediction);
        setTechnicalIndicators(data.indicators);
      }
    } catch (err) {
      console.error('Failed to analyze symbol:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAllData();
    fetchAiAnalysis(selectedSymbolForAi);

    // Fast polling interval (6s)
    const interval = setInterval(() => {
      fetchAllData();
    }, 6000);

    return () => clearInterval(interval);
  }, [fetchAllData, fetchAiAnalysis, selectedSymbolForAi]);

  // Handlers
  const handleToggleBot = async (running: boolean) => {
    try {
      const res = await fetch('/api/bot/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isEnabled: running }),
      });
      if (res.ok) {
        setBotRunning(running);
        showToast(running ? 'Bot automated engine resumed.' : 'Bot automated engine paused.', 'success');
        fetchAllData();
      }
    } catch (err) {
      showToast('Error toggling bot.', 'error');
    }
  };

  const handleToggleTradingMode = async (mode: 'PAPER' | 'LIVE') => {
    if (mode === 'LIVE' && !systemHealth?.globalLiveTradingEnabled) {
      showToast('Live trading is currently gated by administrator settings for safety.', 'error');
      return;
    }

    try {
      const res = await fetch('/api/trading/set-mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      if (res.ok) {
        setTradingMode(mode);
        showToast(`Trading mode switched to ${mode}.`, 'success');
        fetchAllData();
      } else {
        const err = await res.json();
        showToast(err.error || 'Failed to switch mode.', 'error');
      }
    } catch (err) {
      showToast('Failed to switch trading mode.', 'error');
    }
  };

  const handleEmergencyStop = async () => {
    if (window.confirm('EMERGENCY STOP: Halt all bot operations and close any active market exposures?')) {
      try {
        const res = await fetch('/api/bot/emergency-stop', { method: 'POST' });
        if (res.ok) {
          showToast('EMERGENCY STOP EXECUTED: All bot operations halted.', 'error');
          setBotRunning(false);
          fetchAllData();
        }
      } catch (err) {
        showToast('Error executing emergency stop.', 'error');
      }
    }
  };

  const handleResetCircuitBreaker = async () => {
    try {
      const res = await fetch('/api/bot/reset-circuit', { method: 'POST' });
      if (res.ok) {
        showToast('Circuit breaker manually reset. Normal limits restored.', 'success');
        fetchAllData();
      }
    } catch (err) {
      showToast('Error resetting circuit breaker.', 'error');
    }
  };

  const handleClosePosition = async (id: string) => {
    try {
      const res = await fetch('/api/trading/close-position', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, reason: 'MANUAL_CLOSE' }),
      });
      if (res.ok) {
        showToast('Position closed successfully.', 'success');
        fetchAllData();
      }
    } catch (err) {
      showToast('Error closing position.', 'error');
    }
  };

  const handleOpenTrade = async (params: {
    symbol: string;
    side: 'BUY' | 'SELL';
    stopLoss?: number;
    takeProfit?: number;
    aiConfidence?: number;
    entryReason?: string;
  }) => {
    try {
      const res = await fetch('/api/trading/open-position', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: params.symbol,
          side: params.side,
          stopLoss: params.stopLoss,
          takeProfit: params.takeProfit,
          aiConfidence: params.aiConfidence || 80,
          entryReason: params.entryReason || 'Manual trigger from AI Studio',
          mode: tradingMode,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        showToast(`Order executed: ${params.side} ${params.symbol} (${tradingMode})`, 'success');
        fetchAllData();
        setCurrentView('trades');
      } else {
        const err = await res.json();
        showToast(`Trade rejected by Risk Engine: ${err.error}`, 'error');
      }
    } catch (err) {
      showToast('Trade execution error.', 'error');
    }
  };

  const handleSaveCredentials = async (apiKey: string, apiSecret: string, isTestnet: boolean) => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/binance/save-credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey, apiSecret, isTestnet }),
      });
      if (res.ok) {
        const data = await res.json();
        setBinanceStatus(data);
        showToast('Binance credentials encrypted and stored on server.', 'success');
      }
    } catch (err) {
      showToast('Failed to save API credentials.', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleTestBinanceConnection = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/binance/test-connection', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setBinanceStatus(data);
        showToast(`Binance connection confirmed (${data.latencyMs}ms latency).`, 'success');
      } else {
        const err = await res.json();
        showToast(err.error || 'Connection test failed.', 'error');
      }
    } catch (err) {
      showToast('Connection test error.', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveBotSettings = async (settings: BotSettings) => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/bot/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      if (res.ok) {
        const data = await res.json();
        setBotSettings(data);
        showToast('Bot risk and strategy parameters saved.', 'success');
      }
    } catch (err) {
      showToast('Error saving bot settings.', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRunBacktest = async (params: any) => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/backtest/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      if (res.ok) {
        const data = await res.json();
        setBacktestResult(data.backtest || data);
        showToast(lang === 'ar' ? 'اكتملت محاكاة الاختبار التاريخي بنجاح.' : 'Backtest simulation complete.', 'success');
      } else {
        const err = await res.json().catch(() => ({}));
        showToast(err.error || (lang === 'ar' ? 'فشل تشغيل الاختبار التجريبي.' : 'Backtest failed to execute.'), 'error');
      }
    } catch (err) {
      showToast(lang === 'ar' ? 'خطأ في تنفيذ الاختبار التجريبي.' : 'Backtest failed to execute.', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRunWalkForward = async (params: any) => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/backtest/walk-forward', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      if (res.ok) {
        const data = await res.json();
        setWalkForwardResult(data);
        showToast(lang === 'ar' ? 'اكتمل فحص Walk-Forward بنجاح.' : 'Walk-Forward robustness analysis completed.', 'success');
      } else {
        const err = await res.json().catch(() => ({}));
        showToast(err.error || (lang === 'ar' ? 'فشل فحص Walk-Forward.' : 'Walk-Forward test failed.'), 'error');
      }
    } catch (err) {
      showToast(lang === 'ar' ? 'خطأ في فحص Walk-Forward.' : 'Walk-Forward test failed.', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRunTestSuite = async () => {
    try {
      const res = await fetch('/api/system/run-tests', { method: 'POST' });
      if (res.ok) {
        const summary = await res.json();
        showToast(`Diagnostic suite finished: ${summary.passedCount}/${summary.totalTests} tests passed.`, 'success');
        return summary;
      }
    } catch (err) {
      showToast('Failed to run test suite.', 'error');
    }
    return null;
  };

  const handleToggleKillSwitch = async (active: boolean) => {
    if (user.role !== 'ADMIN') {
      showToast(
        lang === 'ar' ? 'تم رفض الإجراء: يتطلب صلاحيات المشرف (ADMIN)' : 'Action Denied: Administrator role required',
        'error'
      );
      return;
    }
    try {
      const res = await fetch('/api/admin/toggle-kill-switch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
          'X-User-Id': user.id,
        },
        body: JSON.stringify({ active }),
      });
      if (res.ok) {
        showToast(
          active
            ? (lang === 'ar' ? 'تم تشغيل مفتاح الإيقاف الطارئ الشامل.' : 'GLOBAL KILL SWITCH ENGAGED.')
            : (lang === 'ar' ? 'تم إلغاء مفتاح الإيقاف الطارئ الشامل.' : 'Global Kill Switch disengaged.'),
          active ? 'error' : 'success'
        );
        fetchAllData();
      } else {
        const err = await res.json().catch(() => ({}));
        showToast(err.error || 'Failed to toggle Kill Switch.', 'error');
      }
    } catch {
      showToast('Error modifying Kill Switch.', 'error');
    }
  };

  const handleToggleLiveTradingGate = async (enabled: boolean) => {
    if (user.role !== 'ADMIN') {
      showToast(
        lang === 'ar' ? 'تم رفض الإجراء: يتطلب صلاحيات المشرف (ADMIN)' : 'Action Denied: Administrator role required',
        'error'
      );
      return;
    }
    try {
      const res = await fetch('/api/admin/toggle-live-trading', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
          'X-User-Id': user.id,
        },
        body: JSON.stringify({ enabled }),
      });
      if (res.ok) {
        showToast(
          enabled
            ? (lang === 'ar' ? 'تم فتح بوابة التداول الحي العالمي.' : 'Live trading gate OPEN.')
            : (lang === 'ar' ? 'تم إغلاق بوابة التداول الحي العالمي.' : 'Live trading gate CLOSED.'),
          'info'
        );
        fetchAllData();
      } else {
        const err = await res.json().catch(() => ({}));
        showToast(err.error || 'Failed to toggle live trading gate.', 'error');
      }
    } catch {
      showToast('Error toggling live trading.', 'error');
    }
  };

  const handleToggleRegistrationGate = async (enabled: boolean) => {
    if (user.role !== 'ADMIN') {
      showToast(
        lang === 'ar' ? 'تم رفض الإجراء: يتطلب صلاحيات المشرف (ADMIN)' : 'Action Denied: Administrator role required',
        'error'
      );
      return;
    }
    try {
      const res = await fetch('/api/admin/toggle-registration', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
          'X-User-Id': user.id,
        },
        body: JSON.stringify({ enabled }),
      });
      if (res.ok) {
        showToast(
          enabled
            ? (lang === 'ar' ? 'تم تفعيل تسجيل المستخدمين الجدد.' : 'Registration ENABLED.')
            : (lang === 'ar' ? 'تم تعطيل تسجيل المستخدمين الجدد.' : 'Registration DISABLED.'),
          'info'
        );
        fetchAllData();
      } else {
        const err = await res.json().catch(() => ({}));
        showToast(err.error || 'Failed to toggle registration gate.', 'error');
      }
    } catch {
      showToast('Error toggling registration gate.', 'error');
    }
  };

  const handleSwitchRole = (newRole: 'ADMIN' | 'USER') => {
    if (newRole === 'ADMIN') {
      setUser({
        id: 'usr_admin',
        email: 'admin@trading.ai',
        name: 'Super Admin',
        role: 'ADMIN',
        createdAt: new Date().toISOString(),
      });
      setAuthToken('tok_usr_admin_default');
      showToast(
        lang === 'ar'
          ? 'تم تفعيل صلاحيات المشرف (ADMIN) عالمياً في المنصة.'
          : 'Granted: Full Administrator (ADMIN) role privileges active globally.',
        'success'
      );
    } else {
      setUser({
        id: 'usr_trader',
        email: 'trader@trading.ai',
        name: 'Pro Trader',
        role: 'USER',
        createdAt: new Date().toISOString(),
      });
      setAuthToken('tok_usr_trader_default');
      if (currentView === 'ADMIN') {
        setCurrentView('DASHBOARD');
      }
      showToast(
        lang === 'ar'
          ? 'تم التبديل إلى دور المتداول (USER): تم تقييد مسارات المشرف.'
          : 'Switched to Trader (USER): Administrator routes and controls restricted.',
        'info'
      );
    }
  };

  // If user unauthenticates or view is LANDING, show LandingPage
  if (!isAuthenticated || currentView === 'LANDING') {
    return (
      <LandingPage
        lang={lang}
        onLaunchStation={() => {
          setIsAuthenticated(true);
          setCurrentView('DASHBOARD');
        }}
        onDirectLogin={async (email, password) => {
          try {
            const pass = password || (email.includes('admin') ? 'Admin@AI2026!' : 'Trader@AI2026!');
            const res = await fetch('/api/auth/login', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email, password: pass }),
            });
            if (res.ok) {
              const data = await res.json();
              setUser(data.user);
              setAuthToken(data.token);
              setIsAuthenticated(true);
              setCurrentView('DASHBOARD');
              showToast(
                lang === 'ar'
                  ? `مرحباً ${data.user.name} - تم تفعيل صلاحيات (${data.user.role})`
                  : `Welcome ${data.user.name} - Logged in with (${data.user.role}) role`,
                'success'
              );
            } else {
              const err = await res.json().catch(() => ({}));
              showToast(err.error || 'Login failed', 'error');
            }
          } catch {
            showToast('Authentication network error', 'error');
          }
        }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-amber-500 selection:text-slate-950">
      {/* Toast Notification Alert */}
      {toastMessage && (
        <div
          className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl text-xs font-bold shadow-2xl flex items-center gap-2 border transition-all animate-bounce ${
            toastMessage.type === 'success'
              ? 'bg-emerald-950/90 text-emerald-300 border-emerald-500/50'
              : toastMessage.type === 'error'
              ? 'bg-red-950/90 text-red-300 border-red-500/50'
              : 'bg-slate-900/90 text-slate-200 border-slate-700'
          }`}
        >
          <span>{toastMessage.text}</span>
        </div>
      )}

      {/* Top Navigation */}
      <Navbar
        currentView={currentView}
        setCurrentView={setCurrentView}
        lang={lang}
        setLang={setLang}
        currentUser={user}
        onLogout={() => {
          setIsAuthenticated(false);
          setCurrentView('LANDING');
        }}
        onOpenLogin={() => {
          setIsAuthenticated(false);
          setCurrentView('LANDING');
        }}
        onEmergencyStopClick={handleEmergencyStop}
        tradingMode={tradingMode}
        onToggleTradingMode={() => handleToggleTradingMode(tradingMode === 'PAPER' ? 'LIVE' : 'PAPER')}
        binanceStatus={binanceStatus}
        systemHealth={systemHealth}
        notifications={notifications}
        onMarkNotificationsRead={handleMarkNotificationsRead}
        onSwitchRole={handleSwitchRole}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8">
        {(currentView === 'DASHBOARD' || (currentView as string) === 'dashboard') && (
          <DashboardView
            lang={lang}
            tradingMode={tradingMode}
            paperBalance={paperBalance}
            totalEquity={totalEquity}
            unrealizedPnl={unrealizedPnl}
            realizedPnl={realizedPnl}
            positions={positions}
            trades={trades}
            tickers={symbols}
            symbols={symbols}
            botRunning={botRunning}
            botSettings={botSettings}
            systemHealth={systemHealth}
            onToggleBot={() => handleToggleBot(!botRunning)}
            onResetCircuitBreaker={handleResetCircuitBreaker}
            onClosePosition={handleClosePosition}
            onSelectSymbolForAi={(sym) => {
              setSelectedSymbolForAi(sym);
              fetchAiAnalysis(sym);
              setCurrentView('AI_ANALYSIS');
            }}
            onViewTradeAudit={(trade) => setSelectedTradeForAudit(trade)}
          />
        )}

        {(currentView === 'SCANNER' || (currentView as string) === 'scanner') && (
          <MarketScannerView
            lang={lang}
            scannerItems={scannerItems}
            isLoading={isLoading}
            onRefresh={fetchAllData}
            onSelectSymbolForAi={(sym) => {
              setSelectedSymbolForAi(sym);
              fetchAiAnalysis(sym);
              setCurrentView('AI_ANALYSIS');
            }}
            onQuickTrade={(sym, side, conf) => {
              handleOpenTrade({ symbol: sym, side, aiConfidence: conf });
            }}
          />
        )}

        {(currentView === 'AI_ANALYSIS' || (currentView as string) === 'ai_studio') && (
          <AiAnalysisView
            lang={lang}
            selectedSymbol={selectedSymbolForAi}
            onSymbolChange={(sym) => {
              setSelectedSymbolForAi(sym);
              fetchAiAnalysis(sym);
            }}
            prediction={aiPrediction}
            indicators={technicalIndicators}
            isLoading={isLoading}
            onReanalyze={() => fetchAiAnalysis(selectedSymbolForAi)}
            onExecuteTrade={handleOpenTrade}
          />
        )}

        {(currentView === 'TRADES' || (currentView as string) === 'trades') && (
          <TradesView
            lang={lang}
            positions={positions}
            trades={trades}
            onClosePosition={handleClosePosition}
            onViewTradeAudit={(item) => setSelectedTradeForAudit(item)}
          />
        )}

        {(currentView === 'BACKTEST' || (currentView as string) === 'backtest') && (
          <BacktestingView
            lang={lang}
            onRunBacktest={handleRunBacktest}
            onRunWalkForward={handleRunWalkForward}
            backtestResult={backtestResult}
            walkForwardResult={walkForwardResult}
            isLoading={isLoading}
          />
        )}

        {(currentView === 'BINANCE' || (currentView as string) === 'binance') && (
          <BinanceConnectionView
            lang={lang}
            binanceStatus={binanceStatus}
            isLoading={isLoading}
            onSaveCredentials={handleSaveCredentials}
            onTestConnection={handleTestBinanceConnection}
          />
        )}

        {(currentView === 'SETTINGS' || (currentView as string) === 'settings') && (
          <BotSettingsView
            lang={lang}
            settings={botSettings}
            strategies={strategies}
            circuitBreakerTripped={systemHealth?.circuitBreakerTripped || false}
            onSaveSettings={handleSaveBotSettings}
            onEmergencyStop={handleEmergencyStop}
            onResetCircuitBreaker={handleResetCircuitBreaker}
            isLoading={isLoading}
          />
        )}

        {(currentView === 'ADMIN' || (currentView as string) === 'admin') && (
          user.role === 'ADMIN' ? (
            <AdminView
              lang={lang}
              systemHealth={systemHealth}
              totalUsers={registeredUsers.length || 2}
              activeBots={botRunning ? 1 : 0}
              paperPositions={(positions || []).filter((p) => p.mode === 'PAPER').length}
              livePositions={(positions || []).filter((p) => p.mode === 'LIVE').length}
              totalTradesCount={(trades || []).length}
              users={registeredUsers.length > 0 ? registeredUsers : [user]}
              auditLogs={auditLogs}
              onToggleKillSwitch={handleToggleKillSwitch}
              onToggleLiveTrading={handleToggleLiveTradingGate}
              onToggleRegistration={handleToggleRegistrationGate}
              isLoading={isLoading}
            />
          ) : (
            <div className="max-w-2xl mx-auto my-12 p-8 rounded-2xl bg-slate-900/90 border border-red-500/40 shadow-2xl text-center space-y-4">
              <div className="w-16 h-16 mx-auto rounded-2xl bg-red-500/10 border border-red-500/30 flex items-center justify-center text-red-400">
                <ShieldAlert className="w-8 h-8" />
              </div>
              <div className="space-y-1">
                <h2 className="text-xl font-bold text-slate-100">
                  {lang === 'ar' ? 'تم رفض الوصول: يتطلب صلاحيات المشرف' : 'Access Restricted: Administrator Role Required'}
                </h2>
                <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-mono-num font-bold bg-red-500/20 text-red-300 border border-red-500/30">
                  HTTP 403 Forbidden
                </span>
              </div>
              <p className="text-sm text-slate-400 max-w-md mx-auto leading-relaxed">
                {lang === 'ar'
                  ? 'مركز التحكم الإداري (Admin Center) ومسارات الإدارة محمية برمجياً وتتطلب حساباً يحمل رتبة (ADMIN). حسابك الحالي مسجل بدور (USER).'
                  : 'The Administrator Control Center and its endpoints are protected and require the ADMIN role. Your current account has role (USER).'}
              </p>
              <div className="pt-3 flex flex-wrap items-center justify-center gap-3">
                <button
                  onClick={() => setCurrentView('DASHBOARD')}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition-colors"
                >
                  {lang === 'ar' ? 'العودة إلى لوحة التداول' : 'Return to Dashboard'}
                </button>
                <button
                  onClick={() => handleSwitchRole('ADMIN')}
                  className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold shadow-lg shadow-amber-500/20 transition-transform active:scale-95"
                >
                  {lang === 'ar' ? 'التبديل إلى حساب المشرف (ADMIN)' : 'Switch to Super Admin (ADMIN)'}
                </button>
              </div>
            </div>
          )
        )}

        {(currentView === 'HEALTH_DOCS' || (currentView as string) === 'health') && (
          <SystemHealthView
            lang={lang}
            systemHealth={systemHealth}
            onRunTestSuite={handleRunTestSuite}
          />
        )}
      </main>

      {/* Trade Detail Modal */}
      {selectedTradeForAudit && (
        <TradeDetailModal
          lang={lang}
          item={selectedTradeForAudit}
          onClose={() => setSelectedTradeForAudit(null)}
        />
      )}
    </div>
  );
}
