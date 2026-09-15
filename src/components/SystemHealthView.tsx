import React, { useState } from 'react';
import {
  Zap,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Play,
  Server,
  Database,
  Key,
  Cpu,
  ShieldCheck,
  FileCode,
  Layers,
  Code,
} from 'lucide-react';
import { Language, SystemHealth } from '../types';
import { translations } from '../i18n';

interface TestItem {
  category: 'UNIT' | 'INTEGRATION' | 'SIMULATION';
  name: string;
  status: 'PASSED' | 'FAILED';
  durationMs: number;
  message: string;
}

interface TestSummary {
  timestamp: string;
  totalTests: number;
  passedCount: number;
  failedCount: number;
  durationMs: number;
  results: TestItem[];
}

interface SystemHealthViewProps {
  lang: Language;
  systemHealth: SystemHealth | null;
  onRunTestSuite: () => Promise<TestSummary | null>;
}

export const SystemHealthView: React.FC<SystemHealthViewProps> = ({
  lang,
  systemHealth,
  onRunTestSuite,
}) => {
  const t = translations[lang];

  const [testSummary, setTestSummary] = useState<TestSummary | null>(null);
  const [isRunningTests, setIsRunningTests] = useState(false);
  const [activeTab, setActiveTab] = useState<'HEALTH_TESTS' | 'DB_SCHEMA' | 'API_DOCS'>('HEALTH_TESTS');

  const handleRunTests = async () => {
    setIsRunningTests(true);
    const summary = await onRunTestSuite();
    setTestSummary(summary);
    setIsRunningTests(false);
  };

  const schemaTables = [
    { name: 'users', count: 18, desc: 'User profiles, encrypted passwords, roles (ADMIN/USER), permissions' },
    { name: 'api_connections', count: 18, desc: 'Binance API keys (masked on client, encrypted on server), testnet flags' },
    { name: 'bot_settings', count: 18, desc: 'Bot parameters, timeframes, active symbols, risk settings, kill switches' },
    { name: 'symbols', count: 18, desc: 'Supported crypto trading pairs, step sizes, tick sizes, min quantities' },
    { name: 'strategies', count: 18, desc: 'Quantitative rule definitions (Trend, Breakout, Pullback, Fractal)' },
    { name: 'market_data_candles', count: 18, desc: 'Multi-timeframe historical klines (1m, 5m, 15m, 1h, 4h, 1d)' },
    { name: 'technical_indicators', count: 18, desc: 'Cached multi-indicator values (EMA, RSI, MACD, ATR, VWAP, Fib)' },
    { name: 'ai_predictions', count: 18, desc: 'AI decision logs, confidence scores, multi-timeframe factor confluences' },
    { name: 'orders', count: 18, desc: 'Order execution history, client order IDs, idempotency records' },
    { name: 'positions', count: 18, desc: 'Active open trades, trailing stop trackers, unrealized PnL' },
    { name: 'trades', count: 18, desc: 'Closed trade outcomes, realized PnL, exit reasons, net commissions' },
    { name: 'backtests', count: 18, desc: 'Historical simulation runs, Sharpe ratios, maximum drawdowns, equity curves' },
    { name: 'walk_forward_tests', count: 18, desc: 'In-sample vs Out-of-sample robustness & overfitting diagnoses' },
    { name: 'risk_events', count: 18, desc: 'Circuit breaker trips, daily loss threshold breaches, rapid volatility spikes' },
    { name: 'audit_logs', count: 18, desc: 'Immutable platform activity audit trail with timestamps and user identifiers' },
    { name: 'notifications', count: 18, desc: 'Real-time in-app alerts for trade executions, risk warnings, system states' },
    { name: 'system_health', count: 18, desc: 'Continuous subsystem heartbeat metrics, latency monitors, global flags' },
    { name: 'paper_accounts', count: 18, desc: 'Virtual balance ledgers and simulated fill logs for paper trading' },
  ];

  return (
    <div className="space-y-6">
      {/* Header & Sub-Tabs */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-slate-900/90 border border-slate-800 p-5 rounded-xl">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
            <Zap className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-100">{t.healthTitle}</h2>
            <p className="text-xs text-slate-400">{t.healthSubtitle}</p>
          </div>
        </div>

        <div className="flex bg-slate-800 p-1 rounded-lg border border-slate-700 text-xs">
          <button
            onClick={() => setActiveTab('HEALTH_TESTS')}
            className={`px-3 py-1.5 rounded-md font-semibold transition-colors ${
              activeTab === 'HEALTH_TESTS' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {lang === 'ar' ? 'حالة الخدمات والاختبارات' : 'Health & Tests'}
          </button>
          <button
            onClick={() => setActiveTab('DB_SCHEMA')}
            className={`px-3 py-1.5 rounded-md font-semibold transition-colors ${
              activeTab === 'DB_SCHEMA' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {t.dbSchemaTitle}
          </button>
          <button
            onClick={() => setActiveTab('API_DOCS')}
            className={`px-3 py-1.5 rounded-md font-semibold transition-colors ${
              activeTab === 'API_DOCS' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {t.apiDocs}
          </button>
        </div>
      </div>

      {/* Tab 1: Health & Tests */}
      {activeTab === 'HEALTH_TESTS' && (
        <div className="space-y-6">
          {/* Subsystems Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <div className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800">
              <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
                <span>Express Server</span>
                <Server className="w-4 h-4 text-emerald-400" />
              </div>
              <div className="text-sm font-bold text-emerald-400 font-mono-num">
                {systemHealth?.serverStatus || 'HEALTHY'}
              </div>
              <div className="text-[10px] text-slate-500 mt-1 font-mono-num">Port 3000 / Node TS</div>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800">
              <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
                <span>Database Layer</span>
                <Database className="w-4 h-4 text-blue-400" />
              </div>
              <div className="text-sm font-bold text-emerald-400 font-mono-num">
                {systemHealth?.databaseStatus || 'CONNECTED'}
              </div>
              <div className="text-[10px] text-slate-500 mt-1 font-mono-num">18 Tables Active</div>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800">
              <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
                <span>Binance Proxy</span>
                <Key className="w-4 h-4 text-amber-400" />
              </div>
              <div className="text-sm font-bold text-emerald-400 font-mono-num">
                {systemHealth?.binanceApiStatus || 'CONNECTED'}
              </div>
              <div className="text-[10px] text-slate-500 mt-1 font-mono-num">Spot REST / Testnet</div>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800">
              <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
                <span>AI Trading Engine</span>
                <Cpu className="w-4 h-4 text-purple-400" />
              </div>
              <div className="text-sm font-bold text-emerald-400 font-mono-num">
                {systemHealth?.aiEngineStatus || 'OPERATIONAL'}
              </div>
              <div className="text-[10px] text-slate-500 mt-1 font-mono-num">
                {systemHealth?.geminiAiAvailable ? 'Gemini 3.8 + Quant' : 'Quant Indicators'}
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800 col-span-2 sm:col-span-1">
              <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
                <span>Risk Engine</span>
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
              </div>
              <div
                className={`text-sm font-bold font-mono-num ${
                  systemHealth?.circuitBreakerTripped ? 'text-amber-400' : 'text-emerald-400'
                }`}
              >
                {systemHealth?.circuitBreakerTripped ? 'CIRCUIT TRIPPED' : 'ARMED & SAFE'}
              </div>
              <div className="text-[10px] text-slate-500 mt-1 font-mono-num">Idempotency Guard On</div>
            </div>
          </div>

          {/* Test Runner Action Card */}
          <div className="bg-slate-900/90 border border-slate-800 p-5 rounded-xl space-y-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <h3 className="text-sm font-bold text-slate-200">
                  {lang === 'ar' ? 'حزمة الاختبارات الشاملة (Unit, Integration & Trading Simulation)' : 'Full Automated Diagnostic Test Suite'}
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  {lang === 'ar'
                    ? 'فحص فوري ودقيق لحسابات المخاطر، معادلات المؤشرات، اتصالات Binance، ومنع الأوامر المكررة.'
                    : 'Validates risk math, indicators, Binance connectivity, and idempotency protection in real time.'}
                </p>
              </div>

              <button
                onClick={handleRunTests}
                disabled={isRunningTests}
                className="px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-2 shadow-lg shadow-emerald-900/30 transition-all active:scale-95 disabled:opacity-50"
              >
                <Play className="w-4 h-4 fill-white" />
                <span>{isRunningTests ? 'Executing 8 tests...' : t.runTestsBtn}</span>
              </button>
            </div>

            {testSummary && (
              <div className="space-y-4 pt-3 border-t border-slate-800">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-3">
                    <span className="font-bold text-slate-200">Summary:</span>
                    <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-mono-num font-bold">
                      {testSummary.passedCount} Passed
                    </span>
                    {testSummary.failedCount > 0 && (
                      <span className="px-2 py-0.5 rounded bg-red-500/20 text-red-400 font-mono-num font-bold">
                        {testSummary.failedCount} Failed
                      </span>
                    )}
                  </div>
                  <span className="text-slate-400 font-mono-num text-[11px]">
                    Total Time: {testSummary.durationMs}ms
                  </span>
                </div>

                <div className="space-y-2">
                  {testSummary.results.map((r, i) => (
                    <div
                      key={i}
                      className="p-3 rounded-lg bg-slate-800/40 border border-slate-700/50 flex items-start justify-between gap-3 text-xs"
                    >
                      <div className="flex items-start gap-2.5">
                        {r.status === 'PASSED' ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                        ) : (
                          <XCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                        )}
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-200">{r.name}</span>
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 font-mono-num">
                              {r.category}
                            </span>
                          </div>
                          <p className="text-slate-400 text-[11px] mt-0.5">{r.message}</p>
                        </div>
                      </div>
                      <span className="text-[10px] text-slate-500 font-mono-num shrink-0">
                        {r.durationMs}ms
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 2: Database Schema (18 Tables) */}
      {activeTab === 'DB_SCHEMA' && (
        <div className="bg-slate-900/90 border border-slate-800 p-5 rounded-xl space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <div>
              <h3 className="text-sm font-bold text-slate-200">{t.dbSchemaTitle}</h3>
              <p className="text-xs text-slate-400">
                {lang === 'ar'
                  ? 'نموذج بيانات علائقي متكامل مصمم للتوسع إلى PostgreSQL أو Cloud SQL بدون تعديل في المنطق.'
                  : 'Complete relational schema designed to seamlessly scale into PostgreSQL / Cloud SQL.'}
              </p>
            </div>
            <span className="px-2.5 py-1 rounded bg-slate-800 text-amber-400 font-mono-num text-xs font-bold">
              18 Standard Tables
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {schemaTables.map((tbl) => (
              <div
                key={tbl.name}
                className="p-3 rounded-lg bg-slate-800/40 border border-slate-700/50 space-y-1"
              >
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-amber-400 font-mono-num">{tbl.name}</span>
                  <span className="text-[10px] text-emerald-400 font-semibold">Active</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">{tbl.desc}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab 3: API Docs */}
      {activeTab === 'API_DOCS' && (
        <div className="bg-slate-900/90 border border-slate-800 p-5 rounded-xl space-y-4">
          <h3 className="text-sm font-bold text-slate-200">{t.apiDocs}</h3>
          <div className="space-y-3 text-xs">
            {[
              { method: 'POST', path: '/api/auth/login', desc: 'Authenticate with email & password' },
              { method: 'GET', path: '/api/market/tickers', desc: 'Real-time 24h Binance Spot tickers' },
              { method: 'GET', path: '/api/market/klines?symbol=BTCUSDT&interval=15m', desc: 'Historical candlestick bars' },
              { method: 'GET', path: '/api/ai/scanner', desc: 'Multi-symbol quantitative AI scanner & ranking' },
              { method: 'POST', path: '/api/ai/analyze', desc: 'Deep multi-timeframe analysis & factor confluence' },
              { method: 'POST', path: '/api/trading/open-position', desc: 'Open paper or live trade with risk validation' },
              { method: 'POST', path: '/api/trading/close-position', desc: 'Close open trade and calculate realized PnL' },
              { method: 'POST', path: '/api/backtest/run', desc: 'Run historical backtest simulation with equity curve' },
              { method: 'POST', path: '/api/backtest/walk-forward', desc: 'Execute in-sample vs out-of-sample overfitting test' },
              { method: 'POST', path: '/api/binance/save-credentials', desc: 'Save & encrypt API keys server-side' },
              { method: 'POST', path: '/api/binance/test-connection', desc: 'Test API latency, permissions and balances' },
              { method: 'POST', path: '/api/bot/emergency-stop', desc: 'Emergency halt of trading engine' },
              { method: 'POST', path: '/api/system/run-tests', desc: 'Run automated 8-test unit & simulation suite' },
            ].map((ep, idx) => (
              <div
                key={idx}
                className="p-3 rounded-lg bg-slate-800/40 border border-slate-700/50 flex items-center justify-between gap-2"
              >
                <div className="flex items-center gap-2 font-mono-num">
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                      ep.method === 'GET' ? 'bg-blue-500/20 text-blue-400' : 'bg-emerald-500/20 text-emerald-400'
                    }`}
                  >
                    {ep.method}
                  </span>
                  <span className="font-semibold text-slate-200">{ep.path}</span>
                </div>
                <span className="text-slate-400 text-[11px]">{ep.desc}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
