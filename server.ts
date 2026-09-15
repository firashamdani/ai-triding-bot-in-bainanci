import express from 'express';
import http from 'http';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { db } from './server/db';
import { binanceClient } from './server/binance';
import { aiTradingEngine } from './server/aiEngine';
import { riskEngine } from './server/riskEngine';
import { tradingEngine } from './server/tradingEngine';
import { backtestingEngine } from './server/backtestEngine';
import { runAllTests } from './server/testSuite';
import { User } from './server/types';
import { generateToken, hashPassword, resolveSessionUser, verifyPassword } from './server/auth';

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json());

  // Background loops: position management AND the autonomous trading cycle.
  // (Previously only position management existed — the bot never opened trades
  // on its own, so every bot setting was dead configuration.)
  tradingEngine.startBackgroundLoops(10000, 15000);

  // ================= 1. AUTHENTICATION & RBAC SECURITY =================
  // In-memory token store for session verification and RBAC
  const activeTokens = new Map<string, { userId: string; role: 'ADMIN' | 'USER'; createdAt: number }>();
  const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8h; sessions previously never expired
  /**
   * Pre-authenticated demo sessions.
   *
   * These token strings are hardcoded in src/App.tsx, i.e. public in the repo, so
   * in production they would be an unauthenticated ADMIN backdoor. They are
   * registered only outside production, and can be disabled explicitly with
   * DISABLE_DEMO_SESSIONS=1. A real deployment must require the login form.
   */
  const demoSessionsEnabled =
    process.env.NODE_ENV !== 'production' && process.env.DISABLE_DEMO_SESSIONS !== '1';
  if (demoSessionsEnabled) {
    activeTokens.set('tok_usr_admin_default', { userId: 'usr_admin', role: 'ADMIN', createdAt: Date.now() });
    activeTokens.set('tok_usr_trader_default', { userId: 'usr_trader', role: 'USER', createdAt: Date.now() });
  }

  /**
   * Resolve the caller from a bearer token ONLY if a real session exists for it.
   *
   * The previous implementation had three ways to become any user without a
   * password: a `tok_<userId>_<anything>` string was parsed for the id and
   * accepted, a bare user id was accepted as a token, and an `x-user-id` header
   * was accepted outright. All three are removed. A token now carries no identity
   * and is meaningless unless this server issued it.
   */
  function getRequestUser(req: express.Request): User | undefined {
    const userId = resolveSessionUser(req.headers.authorization, activeTokens, SESSION_TTL_MS);
    return userId ? db.users.get(userId) : undefined;
  }

  function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
    const user = getRequestUser(req);

    if (!user) {
      return res.status(401).json({
        error: 'Unauthorized: Authentication required to access administrator endpoints.',
        code: 'AUTH_REQUIRED',
      });
    }

    if (user.role !== 'ADMIN') {
      db.logAudit(
        user.id,
        'SECURITY_ALERT',
        `Unauthorized Admin Access Blocked: User ${user.email} (Role: ${user.role}) attempted to access restricted endpoint ${req.method} ${req.path}`,
        'ALERT'
      );
      return res.status(403).json({
        error: 'Forbidden: Administrator privileges (role: ADMIN) required to execute this operation.',
        code: 'ADMIN_ROLE_REQUIRED',
        userRole: user.role,
      });
    }

    (req as any).user = user;
    next();
  }

  app.get('/api/auth/me', (req, res) => {
    const user = getRequestUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Not authenticated', code: 'UNAUTHENTICATED' });
    }
    return res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        createdAt: user.createdAt,
      },
      isAdmin: user.role === 'ADMIN',
    });
  });

  app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body;
    const user = Array.from(db.users.values()).find(
      (u) => u.email.toLowerCase() === email?.toLowerCase()
    );

    // Constant-time hash comparison. Previously `user.passwordHash !== password`
    // against a PLAINTEXT stored password.
    if (!user || !verifyPassword(String(password ?? ''), user.passwordHash)) {
      db.logAudit(user?.id ?? 'anonymous', 'LOGIN', `Failed login attempt for ${email}.`, 'WARNING');
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = generateToken();
    activeTokens.set(token, { userId: user.id, role: user.role, createdAt: Date.now() });

    db.logAudit(user.id, 'LOGIN', `User ${user.email} (${user.role}) logged in successfully.`, 'INFO');

    return res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        createdAt: user.createdAt,
      },
      token,
      isAdmin: user.role === 'ADMIN',
    });
  });

  app.post('/api/auth/register', (req, res) => {
    if (!db.systemHealth.registrationEnabled) {
      return res.status(403).json({
        error: 'Registration is currently disabled by Admin during test phase. Please use Demo credentials.',
      });
    }

    const { email, password, name } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const existing = Array.from(db.users.values()).find(
      (u) => u.email.toLowerCase() === email.toLowerCase()
    );
    if (existing) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    const newUser = {
      id: `usr_${Date.now()}`,
      email,
      name: name || email.split('@')[0],
      role: 'USER' as const,
      passwordHash: hashPassword(String(password)),
      createdAt: new Date().toISOString(),
      isActive: true,
    };

    db.users.set(newUser.id, newUser);
    const token = `tok_${newUser.id}_${Date.now()}`;
    activeTokens.set(token, { userId: newUser.id, role: newUser.role, createdAt: Date.now() });

    db.logAudit(newUser.id, 'LOGIN', `New user registered: ${newUser.email}`, 'INFO');

    return res.json({
      user: {
        id: newUser.id,
        email: newUser.email,
        name: newUser.name,
        role: newUser.role,
        createdAt: newUser.createdAt,
      },
      token,
      isAdmin: false,
    });
  });

  // ================= 2. MARKET DATA & TICKERS =================
  app.get('/api/market/tickers', async (req, res) => {
    try {
      let tickers = await binanceClient.get24HrTickers();
      if (!tickers || tickers.length === 0) {
        // Return seeded fallback symbols
        tickers = Array.from(db.symbols.values());
      }
      return res.json({ tickers });
    } catch (err: unknown) {
      return res.status(500).json({ error: 'Failed to fetch market data' });
    }
  });

  app.get('/api/market/klines', async (req, res) => {
    const symbol = (req.query.symbol as string) || 'BTCUSDT';
    const interval = (req.query.interval as string) || '15m';
    const limit = parseInt((req.query.limit as string) || '100', 10);

    try {
      const klines = await binanceClient.getKlines(symbol, interval, limit);
      return res.json({ symbol, interval, klines });
    } catch {
      return res.status(500).json({ error: 'Failed to fetch klines' });
    }
  });

  // ================= 3. AI TRADING ENGINE & SCANNER =================
  app.get('/api/ai/scanner', async (req, res) => {
    const userId = (req.query.userId as string) || 'usr_trader';
    const settings = db.botSettings.get(userId);
    const targetSymbols = settings?.selectedSymbols?.length
      ? settings.selectedSymbols
      : ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT'];
    const strategyIds = settings?.activeStrategies?.length
      ? settings.activeStrategies
      : Array.from(db.strategies.keys());
    const results = [];

    for (const sym of targetSymbols) {
      try {
        // Strategies need 220+ bars (EMA200), so the old limit of 40 could never
        // evaluate them at all.
        const klines15m = await binanceClient.getKlines(sym, '15m', 400);
        const klines1h = await binanceClient.getKlines(sym, '1h', 300);
        const klines4h = await binanceClient.getKlines(sym, '4h', 300);
        const currentPrice = klines15m[klines15m.length - 1]?.close || 100;

        const analysis = await aiTradingEngine.analyzeSymbol(
          sym,
          currentPrice,
          klines15m,
          klines1h,
          klines4h,
          settings?.minAiConfidence ?? 62,
          strategyIds
        );

        results.push({
          symbol: sym,
          price: currentPrice,
          prediction: analysis.prediction,
          confidenceScore: analysis.confidenceScore,
          factors: analysis.factors,
          entryZone: analysis.factors.entryZone,
          riskRewardRatio: analysis.riskRewardRatio,
          reasoning: analysis.reasoning.slice(0, 4),
          suggestedStopLoss: analysis.suggestedStopLoss,
          suggestedTp1: analysis.suggestedTp1,
          consensus: analysis.consensus,
          longOnly: true,
          dataSource: binanceClient.lastDataSource,
        });
      } catch {
        // Skip symbol on error
      }
    }

    results.sort((a, b) => b.confidenceScore - a.confidenceScore);
    return res.json({
      scannedAt: new Date().toISOString(),
      dataSource: binanceClient.lastDataSource,
      strategiesEvaluated: strategyIds.length,
      scanner: results,
    });
  });

  app.post('/api/ai/analyze', async (req, res) => {
    const { symbol = 'BTCUSDT', minConfidence = 75 } = req.body;
    try {
      const userId = req.body.userId || 'usr_trader';
      const settings = db.botSettings.get(userId);
      const strategyIds =
        req.body.strategyIds || settings?.activeStrategies || Array.from(db.strategies.keys());
      const klines15m = await binanceClient.getKlines(symbol, '15m', 400);
      const klines1h = await binanceClient.getKlines(symbol, '1h', 300);
      const klines4h = await binanceClient.getKlines(symbol, '4h', 300);
      const currentPrice = klines15m[klines15m.length - 1]?.close || 100;

      const prediction = await aiTradingEngine.analyzeSymbol(
        symbol,
        currentPrice,
        klines15m,
        klines1h,
        klines4h,
        minConfidence,
        strategyIds
      );

      const indicators = aiTradingEngine.calculateIndicators(klines15m);

      db.aiPredictions.unshift(prediction);
      if (db.aiPredictions.length > 100) db.aiPredictions.pop();

      return res.json({
        prediction,
        indicators,
        dataSource: binanceClient.lastDataSource,
        longOnly: true,
      });
    } catch (err: unknown) {
      return res.status(500).json({ error: 'AI analysis failed' });
    }
  });

  // ================= 4. BINANCE CONNECTION & SECURITY =================
  app.post('/api/binance/save-credentials', (req, res) => {
    const { userId = 'usr_trader', apiKey, apiSecret, isTestnet = true } = req.body;

    if (!apiKey || !apiSecret) {
      return res.status(400).json({ error: 'API Key and Secret Key are required' });
    }

    // Security: Secret is saved only in memory / encrypted server context, never returned to browser
    binanceClient.setCredentials(userId, apiKey, apiSecret, isTestnet);

    const maskedKey = binanceClient.getMaskedKey(userId);
    let conn = db.apiConnections.get(userId);
    if (!conn) {
      conn = {
        id: `conn_${Date.now()}`,
        userId,
        exchange: 'BINANCE',
        isTestnet,
        apiKeyMasked: maskedKey,
        encryptedSecret: 'SERVER_ENCRYPTED_SHA256',
        status: 'CONNECTED',
        lastPingTime: new Date().toISOString(),
        permissions: { canRead: true, canTrade: true, canWithdraw: false },
        balances: [],
        updatedAt: new Date().toISOString(),
      };
      db.apiConnections.set(userId, conn);
    } else {
      conn.apiKeyMasked = maskedKey;
      conn.isTestnet = isTestnet;
      conn.status = 'CONNECTED';
      conn.updatedAt = new Date().toISOString();
    }

    db.logAudit(
      userId,
      'BINANCE_CONNECT',
      `Saved credentials for Binance (${isTestnet ? 'Testnet' : 'Mainnet'}). Secret masked securely on server.`,
      'INFO'
    );

    return res.json({
      success: true,
      apiKeyMasked: maskedKey,
      isTestnet,
      message: 'Credentials stored securely. Secret Key encrypted and withheld from client.',
    });
  });

  app.post('/api/binance/test-connection', async (req, res) => {
    const { userId = 'usr_trader' } = req.body;
    const testResult = await binanceClient.testConnection(userId);

    const conn = db.apiConnections.get(userId);
    if (conn) {
      conn.status = testResult.success ? 'CONNECTED' : 'ERROR';
      conn.lastPingTime = new Date().toISOString();
      conn.permissions = testResult.permissions;
      if (testResult.balances.length > 0) {
        conn.balances = testResult.balances;
      }
      conn.errorMessage = testResult.success ? undefined : testResult.message;
    }

    db.logAudit(
      userId,
      'BINANCE_CONNECT',
      `Connection test result: ${testResult.success ? 'PASSED' : 'FAILED'} (${testResult.pingMs}ms). ${testResult.message}`,
      testResult.success ? 'INFO' : 'WARNING'
    );

    return res.json(testResult);
  });

  app.get('/api/binance/status', (req, res) => {
    const userId = (req.query.userId as string) || 'usr_trader';
    const conn = db.apiConnections.get(userId);
    return res.json({
      hasCredentials: binanceClient.hasCredentials(userId),
      apiKeyMasked: conn?.apiKeyMasked || binanceClient.getMaskedKey(userId),
      isTestnet: conn?.isTestnet ?? true,
      status: conn?.status || 'UNCONFIGURED',
      permissions: conn?.permissions || { canRead: false, canTrade: false, canWithdraw: false },
      lastPingTime: conn?.lastPingTime,
      balances: conn?.balances || [],
      errorMessage: conn?.errorMessage,
    });
  });

  // ================= 5. BOT SETTINGS & RISK CONFIG =================
  app.get('/api/bot/settings', (req, res) => {
    const userId = (req.query.userId as string) || 'usr_trader';
    let settings = db.botSettings.get(userId);
    if (!settings) {
      settings = db.botSettings.get('usr_trader');
    }
    return res.json({ settings });
  });

  app.post('/api/bot/settings', (req, res) => {
    const { userId = 'usr_trader', settings } = req.body;
    if (!settings) return res.status(400).json({ error: 'Settings payload required' });

    db.botSettings.set(userId, {
      ...settings,
      userId,
      updatedAt: new Date().toISOString(),
    });

    db.logAudit(userId, 'STRATEGY_UPDATE', 'Bot settings and risk parameters updated.', 'INFO');
    return res.json({ success: true, settings: db.botSettings.get(userId) });
  });

  /**
   * The UI (App.tsx) loads its strategy list from here. This route never existed,
   * so the request fell through to the Vite SPA catch-all and returned index.html
   * with HTTP 200 — the fetch looked "ok" and the strategies array was silently
   * parsed as empty. Aliased to the same payload as /api/strategies.
   */
  app.get('/api/bot/strategies', (req, res) => {
    return res.json({
      strategies: Array.from(db.strategies.values()),
      longOnly: true,
      dataSource: binanceClient.lastDataSource,
    });
  });

  /**
   * Pause/resume the autonomous engine. The UI's start/stop button posted here and
   * got HTML back, so clicking it changed local React state while the server kept
   * doing whatever it was doing — the most dangerous kind of desync.
   */
  app.post('/api/bot/toggle', (req, res) => {
    const { userId = 'usr_trader' } = req.body ?? {};
    const isEnabled = Boolean(req.body?.isEnabled);
    const settings = db.botSettings.get(userId) ?? db.botSettings.get('usr_trader');
    if (!settings) return res.status(500).json({ error: 'No bot settings found' });

    settings.isEnabled = isEnabled;
    settings.updatedAt = new Date().toISOString();
    db.botSettings.set(userId, settings);

    db.systemHealth.tradingEngineStatus = isEnabled ? 'RUNNING' : 'PAUSED';
    db.logAudit(userId, 'BOT_TOGGLE', `Autonomous trading ${isEnabled ? 'RESUMED' : 'PAUSED'}.`, 'WARNING');

    if (isEnabled) tradingEngine.forceAutoCycle(); // act immediately, not on the next tick
    return res.json({ success: true, isEnabled, settings });
  });

  /**
   * Global PAPER/LIVE switch. `tradingMode` did not exist server-side, so the UI
   * toggle was decorative. LIVE is gated behind globalLiveTradingEnabled AND a
   * reachable Binance connection — never on simulated prices.
   */
  app.post('/api/trading/set-mode', (req, res) => {
    const { userId = 'usr_trader' } = req.body ?? {};
    const mode = String(req.body?.mode ?? '').toUpperCase();
    if (mode !== 'PAPER' && mode !== 'LIVE') {
      return res.status(400).json({ error: "mode must be 'PAPER' or 'LIVE'" });
    }

    if (mode === 'LIVE') {
      if (!db.systemHealth.globalLiveTradingEnabled) {
        return res.status(403).json({
          error: 'Live trading is disabled by the administrator. Enable globalLiveTradingEnabled first.',
        });
      }
      if (binanceClient.lastDataSource !== 'LIVE_BINANCE') {
        return res.status(409).json({
          error:
            'Cannot switch to LIVE while market data is simulated. Live orders must not be placed against synthetic prices.',
          dataSource: binanceClient.lastDataSource,
        });
      }
      if (!binanceClient.hasCredentials(userId)) {
        return res.status(409).json({ error: 'No Binance API keys configured for this user. LIVE mode requires real credentials.' });
      }
    }

    db.systemHealth.tradingMode = mode;
    db.logAudit(
      userId,
      'TRADING_MODE_CHANGE',
      `Global trading mode set to ${mode}.`,
      mode === 'LIVE' ? 'ALERT' : 'WARNING'
    );
    return res.json({ success: true, mode, health: db.getHealth() });
  });

  app.get('/api/strategies', (req, res) => {
    return res.json({
      strategies: Array.from(db.strategies.values()),
      // Spot cannot short — every strategy here is long-only by construction.
      longOnly: true,
      dataSource: binanceClient.lastDataSource,
    });
  });

  app.post('/api/bot/emergency-stop', async (req, res) => {
    const { userId = 'usr_trader', closeAllPositions = false } = req.body;
    const result = await riskEngine.emergencyStop(userId, closeAllPositions);
    return res.json(result);
  });

  // User-level reset: clears the loss-driven circuit breaker only. It no longer
  // wipes the daily-loss counter and no longer touches the admin kill switch.
  app.post('/api/bot/reset-circuit-breaker', (req, res) => {
    const { userId = 'usr_trader' } = req.body;
    riskEngine.resetCircuitBreaker(userId);
    return res.json({
      success: true,
      message: 'Circuit breaker reset. Daily loss counter preserved; admin kill switch unchanged.',
    });
  });

  app.post('/api/bot/reset-circuit', (req, res) => {
    const { userId = 'usr_trader' } = req.body;
    riskEngine.resetCircuitBreaker(userId);
    return res.json({ success: true, message: 'Circuit breaker reset.' });
  });

  // Admin-only full reset (kill switch + circuit breaker + loss counters)
  app.post('/api/admin/reset-all-risk', requireAdmin, (req, res) => {
    const admin = (req as any).user;
    riskEngine.adminResetAllRiskControls(admin?.id || 'SYSTEM');
    return res.json({ success: true, message: 'All risk controls reset by administrator.' });
  });

  app.get('/api/risk/snapshot', (req, res) => {
    const userId = (req.query.userId as string) || 'usr_trader';
    return res.json(riskEngine.getRiskSnapshot(userId));
  });

  // ---- Autonomous trading control & visibility ----
  app.get('/api/bot/auto-status', (req, res) => {
    const userId = (req.query.userId as string) || 'usr_trader';
    const settings = db.botSettings.get(userId);
    return res.json({
      enabled: !!settings?.isEnabled,
      mode: settings?.mode,
      intervalSec: settings?.aiAnalysisIntervalSec,
      lastCycleAt: db.systemHealth.lastAutoCycleAt ?? null,
      killSwitchActive: db.systemHealth.globalKillSwitchActive,
      circuitBreakerTripped: db.systemHealth.circuitBreakerTripped,
      engineStatus: db.systemHealth.tradingEngineStatus,
      dataSource: binanceClient.lastDataSource,
      recentLog: tradingEngine.autoTradeLog.slice(0, 40),
    });
  });

  app.post('/api/bot/auto-cycle', async (req, res) => {
    const { userId = 'usr_trader', force = false } = req.body;
    if (force) tradingEngine.forceAutoCycle();
    const result = await tradingEngine.runAutoTradingCycle(userId);
    db.logAudit(
      userId,
      'AUTO_TRADE_CYCLE',
      `Auto cycle ran=${result.ran} reason=${result.reason ?? '-'} signals=${result.signalsFound} opened=${result.ordersOpened}`,
      'INFO'
    );
    return res.json(result);
  });

  app.get('/api/account/summary', (req, res) => {
    const userId = (req.query.userId as string) || 'usr_trader';
    return res.json(tradingEngine.getAccountSummary(userId));
  });

  // ================= 6. TRADING & POSITIONS =================
  app.get('/api/trading/state', (req, res) => {
    const userId = (req.query.userId as string) || 'usr_trader';
    const userPositions = Array.from(db.positions.values()).filter((p) => p.userId === userId);
    const userTrades = db.trades.filter((t) => t.userId === userId);
    const summary = tradingEngine.getAccountSummary(userId);

    return res.json({
      positions: userPositions,
      trades: userTrades,
      // cash = uncommitted money; equity = cash + market value of open positions
      paperBalance: summary.cash,
      availableBalance: summary.cash,
      committedCapital: summary.committedCapital,
      unrealizedPnl: summary.unrealizedPnlUsd,
      realizedPnl: summary.realizedPnlUsd,
      totalEquity: summary.equity,
      exposurePercent: summary.exposurePercent,
      totalTradesCount: summary.totalTrades,
      winningTrades: summary.winningTrades,
      losingTrades: summary.losingTrades,
      winRate: summary.winRate,
      feeDragPercent: summary.feeDragPercent,
      orders: db.orders.slice(0, 50),
      dataSource: binanceClient.lastDataSource,
    });
  });

  app.get('/api/trading/positions', (req, res) => {
    return res.json({ positions: Array.from(db.positions.values()) });
  });

  app.get('/api/trading/trades', (req, res) => {
    return res.json({ trades: db.trades });
  });

  app.post('/api/trading/open-position', async (req, res) => {
    const {
      userId = 'usr_trader',
      symbol = 'BTCUSDT',
      side = 'BUY',
      mode = 'PAPER',
      stopLoss,
      takeProfit,
      strategyName,
      aiConfidence,
      entryReason,
    } = req.body;

    const result = await tradingEngine.openPosition(userId, {
      symbol,
      side,
      mode,
      stopLoss,
      takeProfit,
      strategyName,
      aiConfidence,
      entryReason,
    });

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    return res.json({ success: true, position: result.position });
  });

  app.post('/api/trading/close-position', async (req, res) => {
    const { userId = 'usr_trader', positionId, id, exitReason = 'MANUAL_CLOSE' } = req.body;
    const targetId = positionId || id;
    if (!targetId) return res.status(400).json({ error: 'Position ID required' });

    const result = await tradingEngine.closePosition(userId, targetId, exitReason);
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    return res.json({ success: true, trade: result.trade });
  });

  // ================= 7. BACKTESTING =================
  app.post('/api/backtest/run', async (req, res) => {
    const {
      userId = 'usr_trader',
      symbol = 'BTCUSDT',
      timeframe = '15m',
      strategyId = 'strat_trend',
      initialBalance = 10000,
      riskPerTradePercent = 1.0,
      stopLossPercent = 2.0,
      takeProfitRatio = 2.0,
      periodDays = 60,
    } = req.body;

    try {
      // The old cap of 300 candles gave ~3 days of 15m data — far too little for
      // any statistical meaning. Scale the bar count with the timeframe instead.
      const minutesPerBar = ({ '1m': 1, '5m': 5, '15m': 15, '1h': 60, '4h': 240, '1d': 1440 } as Record<string, number>)[timeframe] || 15;
      const barsNeeded = Math.min(3000, Math.max(600, Math.round((periodDays * 1440) / minutesPerBar)));
      const candles = await binanceClient.getKlines(symbol, timeframe, barsNeeded);
      const backtest = backtestingEngine.runBacktest(userId, candles, {
        symbol,
        timeframe,
        strategyId,
        startDate: new Date(candles[0]?.time || Date.now() - 86400000 * 30).toISOString().split('T')[0],
        endDate: new Date().toISOString().split('T')[0],
        initialBalance,
        riskPerTradePercent,
        stopLossPercent,
        takeProfitRatio,
        maxExposurePercent: Number(req.body.maxExposurePercent ?? 80),
      });

      db.backtests.unshift(backtest);
      if (db.backtests.length > 50) db.backtests.pop();

      return res.json({ backtest, ...backtest });
    } catch (err: unknown) {
      return res.status(500).json({ error: 'Backtesting execution failed' });
    }
  });

  app.post('/api/backtest/walk-forward', async (req, res) => {
    const {
      userId = 'usr_trader',
      symbol = 'BTCUSDT',
      timeframe = '15m',
      strategyId = 'strat_fractal',
      initialBalance = 10000,
    } = req.body;

    try {
      const minutesPerBar = ({ '1m': 1, '5m': 5, '15m': 15, '1h': 60, '4h': 240, '1d': 1440 } as Record<string, number>)[timeframe] || 15;
      // Use every bar the feed can give: walk-forward folds are only meaningful
      // when each out-of-sample window is long enough to contain trades.
      const candles = await binanceClient.getKlines(symbol, timeframe, 3000);
      const result = backtestingEngine.runWalkForwardAnalysis(
        userId,
        candles,
        {
          symbol,
          timeframe,
          strategyId,
          startDate: '',
          endDate: '',
          initialBalance,
          riskPerTradePercent: Number(req.body.riskPerTradePercent ?? 1.0),
          stopLossPercent: Number(req.body.stopLossPercent ?? 2.0),
          takeProfitRatio: Number(req.body.takeProfitRatio ?? 2.0),
          maxExposurePercent: Number(req.body.maxExposurePercent ?? 80),
        },
        Number(req.body.folds ?? 5)
      );

      return res.json(result);
    } catch {
      return res.status(500).json({ error: 'Walk-forward analysis failed' });
    }
  });

  /**
   * Parameter robustness: re-runs the backtest with perturbed parameters.
   * A strategy that is only profitable at one exact parameter set is curve-fit,
   * not "proven" — this endpoint makes that visible instead of hidden.
   */
  app.post('/api/backtest/robustness', async (req, res) => {
    const {
      userId = 'usr_trader',
      symbol = 'BTCUSDT',
      timeframe = '1h',
      strategyId = 'strat_turtle',
      initialBalance = 10000,
      riskPerTradePercent = 1.0,
      stopLossPercent = 2.0,
      takeProfitRatio = 2.0,
      trials = 12,
      jitter = 0.2,
    } = req.body;

    try {
      const minutesPerBar = ({ '1m': 1, '5m': 5, '15m': 15, '1h': 60, '4h': 240, '1d': 1440 } as Record<string, number>)[timeframe] || 60;
      const candles = await binanceClient.getKlines(symbol, timeframe, 3000);
      const result = backtestingEngine.runParameterRobustness(
        userId,
        candles,
        {
          symbol,
          timeframe,
          strategyId,
          startDate: '',
          endDate: '',
          initialBalance,
          riskPerTradePercent,
          stopLossPercent,
          takeProfitRatio,
          maxExposurePercent: Number(req.body.maxExposurePercent ?? 80),
        },
        Math.min(40, Number(trials) || 12),
        Math.min(0.5, Number(jitter) || 0.2)
      );
      return res.json(result);
    } catch (err: unknown) {
      return res.status(500).json({
        error: 'Robustness analysis failed',
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // ================= 8. ADMIN CONTROL CENTER (SECURED) =================
  app.get('/api/admin/overview', requireAdmin, (req, res) => {
    const totalUsers = db.users.size;
    const activeBots = Array.from(db.botSettings.values()).filter((s) => s.isEnabled).length;
    const paperPositions = Array.from(db.positions.values()).filter((p) => p.mode === 'PAPER').length;
    const livePositions = Array.from(db.positions.values()).filter((p) => p.mode === 'LIVE').length;

    return res.json({
      health: db.getHealth(),
      totalUsers,
      activeBots,
      paperPositions,
      livePositions,
      totalTradesCount: db.trades.length,
      users: Array.from(db.users.values()).map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        createdAt: u.createdAt,
        isActive: u.isActive,
      })),
      riskEvents: db.riskEvents.slice(0, 20),
    });
  });

  app.post('/api/admin/toggle-kill-switch', requireAdmin, (req, res) => {
    const { active } = req.body;
    db.systemHealth.globalKillSwitchActive = !!active;
    db.logAudit(
      (req as any).user?.id || 'ADMIN',
      'ADMIN_KILL_SWITCH',
      `GLOBAL KILL SWITCH was ${active ? 'ENGAGED' : 'DISENGAGED'} by Admin (${(req as any).user?.email || 'admin'}).`,
      active ? 'ALERT' : 'INFO'
    );
    return res.json({ success: true, killSwitchActive: db.systemHealth.globalKillSwitchActive });
  });

  app.post('/api/admin/toggle-live-trading', requireAdmin, (req, res) => {
    const { enabled } = req.body;
    db.systemHealth.globalLiveTradingEnabled = !!enabled;
    db.logAudit(
      (req as any).user?.id || 'ADMIN',
      'STRATEGY_UPDATE',
      `Live Trading global gateway set to: ${enabled ? 'ENABLED' : 'DISABLED'} by Admin (${(req as any).user?.email || 'admin'}).`,
      'INFO'
    );
    return res.json({ success: true, globalLiveTradingEnabled: db.systemHealth.globalLiveTradingEnabled });
  });

  app.post('/api/admin/toggle-registration', requireAdmin, (req, res) => {
    const { enabled } = req.body;
    db.systemHealth.registrationEnabled = !!enabled;
    db.logAudit(
      (req as any).user?.id || 'ADMIN',
      'STRATEGY_UPDATE',
      `User registration gateway set to: ${enabled ? 'ENABLED' : 'DISABLED'} by Admin (${(req as any).user?.email || 'admin'}).`,
      'INFO'
    );
    return res.json({ success: true, registrationEnabled: db.systemHealth.registrationEnabled });
  });

  app.get('/api/admin/audit-logs', requireAdmin, (req, res) => {
    const limit = parseInt((req.query.limit as string) || '100', 10);
    return res.json({ auditLogs: db.auditLogs.slice(0, limit) });
  });

  // ================= 9. SYSTEM HEALTH & TEST RUNNER =================
  app.get('/api/system/health', (req, res) => {
    const health = db.getHealth();
    return res.json({
      health,
      marketData: {
        source: binanceClient.lastDataSource,
        lastLiveFetchAt: binanceClient.lastLiveFetchAt,
        lastError: binanceClient.lastFetchError,
        note:
          binanceClient.lastDataSource === 'SIMULATED_OFFLINE'
            ? 'api.binance.com is unreachable from this host. Prices come from a seeded, persistent simulation. Do NOT judge strategy performance on simulated data.'
            : 'Live Binance market data.',
      },
    });
  });

  app.post('/api/system/run-tests', async (req, res) => {
    const testReport = await runAllTests();
    return res.json(testReport);
  });

  // ================= 10. NOTIFICATIONS =================
  app.get('/api/notifications', (req, res) => {
    return res.json({ notifications: db.notifications });
  });

  app.post('/api/notifications/mark-read', (req, res) => {
    db.notifications.forEach((n) => (n.read = true));
    return res.json({ success: true });
  });

  // Single HTTP server shared by Express and Vite, so the HMR websocket is
  // served from the same origin/port as the app (required behind a proxy).
  const httpServer = http.createServer(app);

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR === 'true' ? false : { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Binance AI Trading Platform server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
