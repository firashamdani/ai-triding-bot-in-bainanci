import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { db } from './server/db';
import { binanceClient } from './server/binance';
import { aiTradingEngine } from './server/aiEngine';
import { riskEngine } from './server/riskEngine';
import { tradingEngine } from './server/tradingEngine';
import { backtestingEngine } from './server/backtestEngine';
import { runAllTests } from './server/testSuite';

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Background ticker loop to keep paper trading positions updated
  setInterval(async () => {
    try {
      await tradingEngine.updatePositionsWithMarketPrices();
    } catch {
      // Ignore background loop errors
    }
  }, 10000);

  // ================= 1. AUTHENTICATION =================
  app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body;
    const user = Array.from(db.users.values()).find(
      (u) => u.email.toLowerCase() === email?.toLowerCase()
    );

    if (!user || user.passwordHash !== password) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    db.logAudit(user.id, 'LOGIN', `User ${user.email} (${user.role}) logged in successfully.`, 'INFO');

    return res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        createdAt: user.createdAt,
      },
      token: `tok_${user.id}_${Date.now()}`,
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
      passwordHash: password,
      createdAt: new Date().toISOString(),
      isActive: true,
    };

    db.users.set(newUser.id, newUser);
    db.logAudit(newUser.id, 'LOGIN', `New user registered: ${newUser.email}`, 'INFO');

    return res.json({
      user: {
        id: newUser.id,
        email: newUser.email,
        name: newUser.name,
        role: newUser.role,
        createdAt: newUser.createdAt,
      },
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
    const targetSymbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT'];
    const results = [];

    for (const sym of targetSymbols) {
      try {
        const klines15m = await binanceClient.getKlines(sym, '15m', 40);
        const klines1h = await binanceClient.getKlines(sym, '1h', 40);
        const klines4h = await binanceClient.getKlines(sym, '4h', 40);
        const currentPrice = klines15m[klines15m.length - 1]?.close || 100;

        const analysis = await aiTradingEngine.analyzeSymbol(
          sym,
          currentPrice,
          klines15m,
          klines1h,
          klines4h,
          75
        );

        results.push({
          symbol: sym,
          price: currentPrice,
          prediction: analysis.prediction,
          confidenceScore: analysis.confidenceScore,
          factors: analysis.factors,
          entryZone: analysis.factors.entryZone,
          riskRewardRatio: analysis.riskRewardRatio,
          reasoning: analysis.reasoning.slice(0, 3),
        });
      } catch {
        // Skip symbol on error
      }
    }

    // Sort by confidence score descending
    results.sort((a, b) => b.confidenceScore - a.confidenceScore);
    return res.json({ scannedAt: new Date().toISOString(), scanner: results });
  });

  app.post('/api/ai/analyze', async (req, res) => {
    const { symbol = 'BTCUSDT', minConfidence = 75 } = req.body;
    try {
      const klines15m = await binanceClient.getKlines(symbol, '15m', 60);
      const klines1h = await binanceClient.getKlines(symbol, '1h', 60);
      const klines4h = await binanceClient.getKlines(symbol, '4h', 60);
      const currentPrice = klines15m[klines15m.length - 1]?.close || 100;

      const prediction = await aiTradingEngine.analyzeSymbol(
        symbol,
        currentPrice,
        klines15m,
        klines1h,
        klines4h,
        minConfidence
      );

      const indicators = aiTradingEngine.calculateIndicators(klines15m);

      db.aiPredictions.unshift(prediction);
      if (db.aiPredictions.length > 100) db.aiPredictions.pop();

      return res.json({ prediction, indicators });
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

  app.get('/api/strategies', (req, res) => {
    return res.json({ strategies: Array.from(db.strategies.values()) });
  });

  app.post('/api/bot/emergency-stop', (req, res) => {
    const { userId = 'usr_trader', closeAllPositions = false } = req.body;
    const result = riskEngine.emergencyStop(userId, closeAllPositions);
    return res.json(result);
  });

  app.post('/api/bot/reset-circuit-breaker', (req, res) => {
    const { userId = 'usr_trader' } = req.body;
    riskEngine.resetCircuitBreaker(userId);
    return res.json({ success: true, message: 'Circuit breaker reset successfully.' });
  });

  app.post('/api/bot/reset-circuit', (req, res) => {
    const { userId = 'usr_trader' } = req.body;
    riskEngine.resetCircuitBreaker(userId);
    return res.json({ success: true, message: 'Circuit breaker reset successfully.' });
  });

  // ================= 6. TRADING & POSITIONS =================
  app.get('/api/trading/state', (req, res) => {
    const userId = (req.query.userId as string) || 'usr_trader';
    const userPositions = Array.from(db.positions.values()).filter((p) => p.userId === userId);
    const userTrades = db.trades.filter((t) => t.userId === userId);
    const paperBalance = tradingEngine.getPaperBalance();

    const unrealizedPnl = userPositions.reduce((acc, p) => acc + p.unrealizedPnlUsd, 0);
    const realizedPnl = userTrades.reduce((acc, t) => acc + t.realizedPnlUsd, 0);

    const winningTrades = userTrades.filter((t) => t.realizedPnlUsd > 0).length;
    const winRate = userTrades.length > 0 ? (winningTrades / userTrades.length) * 100 : 0;

    return res.json({
      positions: userPositions,
      trades: userTrades,
      paperBalance,
      unrealizedPnl: Math.round(unrealizedPnl * 100) / 100,
      realizedPnl: Math.round(realizedPnl * 100) / 100,
      totalEquity: Math.round((paperBalance + unrealizedPnl) * 100) / 100,
      totalTradesCount: userTrades.length,
      winningTrades,
      winRate: Math.round(winRate * 10) / 10,
      orders: db.orders.slice(0, 50),
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
      const candles = await binanceClient.getKlines(symbol, timeframe, Math.min(300, periodDays * 4));
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
      });

      db.backtests.unshift(backtest);
      if (db.backtests.length > 50) db.backtests.pop();

      return res.json({ backtest });
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
      const candles = await binanceClient.getKlines(symbol, timeframe, 300);
      const result = backtestingEngine.runWalkForwardAnalysis(userId, candles, {
        symbol,
        timeframe,
        strategyId,
        startDate: '',
        endDate: '',
        initialBalance,
        riskPerTradePercent: 1.0,
        stopLossPercent: 2.0,
        takeProfitRatio: 2.0,
      });

      return res.json(result);
    } catch {
      return res.status(500).json({ error: 'Walk-forward analysis failed' });
    }
  });

  // ================= 8. ADMIN CONTROL CENTER =================
  app.get('/api/admin/overview', (req, res) => {
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

  app.post('/api/admin/toggle-kill-switch', (req, res) => {
    const { active } = req.body;
    db.systemHealth.globalKillSwitchActive = !!active;
    db.logAudit(
      'ADMIN',
      'ADMIN_KILL_SWITCH',
      `GLOBAL KILL SWITCH was ${active ? 'ENGAGED' : 'DISENGAGED'} by Admin.`,
      active ? 'ALERT' : 'INFO'
    );
    return res.json({ success: true, killSwitchActive: db.systemHealth.globalKillSwitchActive });
  });

  app.post('/api/admin/toggle-live-trading', (req, res) => {
    const { enabled } = req.body;
    db.systemHealth.globalLiveTradingEnabled = !!enabled;
    db.logAudit(
      'ADMIN',
      'STRATEGY_UPDATE',
      `Live Trading global gateway set to: ${enabled ? 'ENABLED' : 'DISABLED'}.`,
      'INFO'
    );
    return res.json({ success: true, globalLiveTradingEnabled: db.systemHealth.globalLiveTradingEnabled });
  });

  app.post('/api/admin/toggle-registration', (req, res) => {
    const { enabled } = req.body;
    db.systemHealth.registrationEnabled = !!enabled;
    db.logAudit(
      'ADMIN',
      'STRATEGY_UPDATE',
      `User registration gateway set to: ${enabled ? 'ENABLED' : 'DISABLED'}.`,
      'INFO'
    );
    return res.json({ success: true, registrationEnabled: db.systemHealth.registrationEnabled });
  });

  app.get('/api/admin/audit-logs', (req, res) => {
    const limit = parseInt((req.query.limit as string) || '100', 10);
    return res.json({ auditLogs: db.auditLogs.slice(0, limit) });
  });

  // ================= 9. SYSTEM HEALTH & TEST RUNNER =================
  app.get('/api/system/health', (req, res) => {
    return res.json({ health: db.getHealth() });
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

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
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

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Binance AI Trading Platform server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
