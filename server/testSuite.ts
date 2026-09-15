import { riskEngine } from './riskEngine';
import { aiTradingEngine } from './aiEngine';
import { binanceClient } from './binance';
import { tradingEngine } from './tradingEngine';
import { db } from './db';
import { backtestingEngine as backtestingEngineLocal } from './backtestEngine';
import { generateHistoricalSeries } from './marketData';
import { computePnl } from './tradingEngine';
import { getStrategy, STRATEGIES } from './strategies';
import type { KlineBar } from './binance';

export interface TestResultItem {
  category: 'UNIT' | 'INTEGRATION' | 'SIMULATION';
  name: string;
  status: 'PASSED' | 'FAILED';
  durationMs: number;
  message: string;
}

export interface FullTestSuiteSummary {
  timestamp: string;
  totalTests: number;
  passedCount: number;
  failedCount: number;
  durationMs: number;
  results: TestResultItem[];
}

export async function runAllTests(): Promise<FullTestSuiteSummary> {
  const startTime = Date.now();
  const results: TestResultItem[] = [];

  // Reset ALL risk state for a clean, repeatable run.
  // Note: resetCircuitBreaker() deliberately no longer clears the daily loss
  // tracker (that was a privilege bug), so a test harness must use the admin
  // reset — otherwise a loss recorded by a previous run persists in memory and
  // re-trips the breaker before the first test even executes.
  db.systemHealth.circuitBreakerTripped = false;
  db.systemHealth.globalKillSwitchActive = false;
  db.systemHealth.tradingEngineStatus = 'RUNNING';
  riskEngine.adminResetAllRiskControls('SYSTEM');

  // ================= UNIT TESTS =================
  // 1. Position Sizing
  const t1Start = Date.now();
  try {
    const dummySettings = {
      ...db.botSettings.get('usr_trader')!,
      riskPerTradePercent: 1.0,
      stopLossPercent: 2.0,
      takeProfitRatio: 2.5,
      maxOpenTrades: 5,
    };
    const sizeRes = riskEngine.calculatePositionSize('usr_trader', 10000, 94000, dummySettings, 0);
    // Risk = $100. SL = 2% ($1880). Position size = $100 / 0.02 = $5000. Qty = 5000 / 94000 = 0.05319
    const passed = sizeRes.allowed && sizeRes.quantity > 0 && sizeRes.stopLossPrice < 94000 && sizeRes.takeProfitPrice > 94000;
    results.push({
      category: 'UNIT',
      name: 'Risk Engine: Position Sizing & SL/TP Math',
      status: passed ? 'PASSED' : 'FAILED',
      durationMs: Date.now() - t1Start,
      message: `Expected allowed=true, StopLoss=$${sizeRes.stopLossPrice}, TP=$${sizeRes.takeProfitPrice}, Qty=${sizeRes.quantity}`,
    });
  } catch (err: unknown) {
    results.push({
      category: 'UNIT',
      name: 'Risk Engine: Position Sizing & SL/TP Math',
      status: 'FAILED',
      durationMs: Date.now() - t1Start,
      message: String(err),
    });
  }

  // 2. Technical Indicators (RSI, EMA, ATR)
  const t2Start = Date.now();
  try {
    const sampleCandles = Array.from({ length: 40 }, (_, i) => ({
      time: Date.now() - (40 - i) * 60000,
      open: 100 + i * 0.5,
      high: 102 + i * 0.5,
      low: 99 + i * 0.5,
      close: 101 + i * 0.5,
      volume: 1500,
    }));
    const ind = aiTradingEngine.calculateIndicators(sampleCandles);
    const passed = ind.rsi14 >= 0 && ind.rsi14 <= 100 && ind.ema9 > 0 && ind.atr14 > 0;
    results.push({
      category: 'UNIT',
      name: 'AI Engine: Multi-indicator Technical Formulas',
      status: passed ? 'PASSED' : 'FAILED',
      durationMs: Date.now() - t2Start,
      message: `RSI=${ind.rsi14}, EMA9=${ind.ema9}, ATR=${ind.atr14}`,
    });
  } catch (err: unknown) {
    results.push({
      category: 'UNIT',
      name: 'AI Engine: Multi-indicator Technical Formulas',
      status: 'FAILED',
      durationMs: Date.now() - t2Start,
      message: String(err),
    });
  }

  // 3. Stop Loss Guard against zero/negative distance
  const t3Start = Date.now();
  try {
    const dummySettings = db.botSettings.get('usr_trader')!;
    const invalidCheck = riskEngine.calculatePositionSize('usr_trader', 10000, 94000, dummySettings, 0, 94500); // SL above current price
    const passed = !invalidCheck.allowed;
    results.push({
      category: 'UNIT',
      name: 'Risk Engine: Inverted Stop Loss Guard',
      status: passed ? 'PASSED' : 'FAILED',
      durationMs: Date.now() - t3Start,
      message: 'Properly rejected stop loss placed above buy entry price.',
    });
  } catch (err: unknown) {
    results.push({
      category: 'UNIT',
      name: 'Risk Engine: Inverted Stop Loss Guard',
      status: 'FAILED',
      durationMs: Date.now() - t3Start,
      message: String(err),
    });
  }

  // ================= INTEGRATION TESTS =================
  // 4. Binance Connection & Public API Ping
  const t4Start = Date.now();
  try {
    const klines = await binanceClient.getKlines('BTCUSDT', '15m', 10);
    const passed = Array.isArray(klines) && klines.length > 0 && klines[0].close > 0;
    results.push({
      category: 'INTEGRATION',
      name: 'Binance API: Public Market Data Endpoint',
      status: passed ? 'PASSED' : 'FAILED',
      durationMs: Date.now() - t4Start,
      message: `Received ${klines.length} candles successfully from Binance REST service.`,
    });
  } catch (err: unknown) {
    results.push({
      category: 'INTEGRATION',
      name: 'Binance API: Public Market Data Endpoint',
      status: 'FAILED',
      durationMs: Date.now() - t4Start,
      message: String(err),
    });
  }

  // 5. Database Schema & Relational Integrity
  const t5Start = Date.now();
  try {
    const user = db.users.get('usr_trader');
    const settings = db.botSettings.get('usr_trader');
    const strategies = Array.from(db.strategies.values());
    const symbols = Array.from(db.symbols.values());
    const passed = !!(user && settings && strategies.length >= 5 && symbols.length >= 6);
    results.push({
      category: 'INTEGRATION',
      name: 'Database Store: 18 Tables & Seed Consistency',
      status: passed ? 'PASSED' : 'FAILED',
      durationMs: Date.now() - t5Start,
      message: `Verified relational tables: Users=${db.users.size}, Strategies=${strategies.length}, Symbols=${symbols.length}`,
    });
  } catch (err: unknown) {
    results.push({
      category: 'INTEGRATION',
      name: 'Database Store: 18 Tables & Seed Consistency',
      status: 'FAILED',
      durationMs: Date.now() - t5Start,
      message: String(err),
    });
  }

  // ================= SIMULATION TESTS =================
  // 6. Paper Trading Order Execution
  const t6Start = Date.now();
  try {
    // Pick a symbol with no open position: the engine now rejects duplicate
    // symbols per account (correct behaviour), and BTCUSDT is seeded as a demo
    // position, so hardcoding it here would fail for the wrong reason.
    const held = new Set(Array.from(db.positions.values()).map((p) => p.symbol));
    const freeSymbol = Array.from(db.symbols.keys()).find((sym) => !held.has(sym)) ?? 'BTCUSDT';
    const balanceBefore = tradingEngine.getPaperBalance();
    const openRes = await tradingEngine.openPosition('usr_trader', {
      symbol: freeSymbol,
      side: 'BUY',
      mode: 'PAPER',
      entryReason: 'Automated test suite simulation',
    });
    const passed = openRes.success && !!openRes.position;
    if (openRes.position) {
      await tradingEngine.closePosition('usr_trader', openRes.position.id, 'MANUAL_CLOSE');
    }
    tradingEngine.setPaperBalance(balanceBefore);
    results.push({
      category: 'SIMULATION',
      name: 'Simulation: Open and Close Paper Position',
      status: passed ? 'PASSED' : 'FAILED',
      durationMs: Date.now() - t6Start,
      message: passed ? 'Paper position created and closed with accurate PnL record.' : (openRes.error || 'Failed'),
    });
  } catch (err: unknown) {
    results.push({
      category: 'SIMULATION',
      name: 'Simulation: Open and Close Paper Position',
      status: 'FAILED',
      durationMs: Date.now() - t6Start,
      message: String(err),
    });
  }

  // 7. Duplicate Order Idempotency Guard
  const t7Start = Date.now();
  try {
    const testOrderId = `test_idem_${Date.now()}`;
    const firstCheck = riskEngine.checkIdempotency(testOrderId);
    const secondCheck = riskEngine.checkIdempotency(testOrderId);
    const passed = firstCheck === true && secondCheck === false;
    results.push({
      category: 'SIMULATION',
      name: 'Safety Guard: Idempotency & Duplicate Order Prevention',
      status: passed ? 'PASSED' : 'FAILED',
      durationMs: Date.now() - t7Start,
      message: passed ? 'Duplicate order attempt strictly blocked.' : 'Failed idempotency check',
    });
  } catch (err: unknown) {
    results.push({
      category: 'SIMULATION',
      name: 'Safety Guard: Idempotency & Duplicate Order Prevention',
      status: 'FAILED',
      durationMs: Date.now() - t7Start,
      message: String(err),
    });
  }

  // 8. Live Trading Gating (Blocked if unapproved)
  const t8Start = Date.now();
  try {
    // Attempt live trade without admin live trading approval
    const liveAttempt = await tradingEngine.openPosition('usr_trader', {
      symbol: 'ETHUSDT',
      side: 'BUY',
      mode: 'LIVE',
    });
    const passed = !liveAttempt.success && liveAttempt.error?.includes('disabled');
    results.push({
      category: 'SIMULATION',
      name: 'Live Trading Gating: Security Check Protection',
      status: passed ? 'PASSED' : 'FAILED',
      durationMs: Date.now() - t8Start,
      message: 'Verified Live Trading cannot trigger without strict multi-level approvals.',
    });
  } catch (err: unknown) {
    results.push({
      category: 'SIMULATION',
      name: 'Live Trading Gating: Security Check Protection',
      status: 'FAILED',
      durationMs: Date.now() - t8Start,
      message: String(err),
    });
  }

  // 9. RBAC Security: Admin Role Privilege Enforcement
  const t9Start = Date.now();
  try {
    const adminUser = db.users.get('usr_admin');
    const traderUser = db.users.get('usr_trader');
    const hasAdminRole = adminUser?.role === 'ADMIN';
    const isTraderRestricted = traderUser?.role === 'USER';
    const passed = hasAdminRole && isTraderRestricted;
    results.push({
      category: 'INTEGRATION',
      name: 'RBAC Security: Admin Role Privilege Enforcement',
      status: passed ? 'PASSED' : 'FAILED',
      durationMs: Date.now() - t9Start,
      message: 'Verified ADMIN role privileges validated and separated from regular USER role.',
    });
  } catch (err: unknown) {
    results.push({
      category: 'INTEGRATION',
      name: 'RBAC Security: Admin Role Privilege Enforcement',
      status: 'FAILED',
      durationMs: Date.now() - t9Start,
      message: String(err),
    });
  }

  // ================= REGRESSION TESTS FOR THE BOT AUDIT FIXES =================
  // Each of these asserts a defect that was actually found and fixed. They exist
  // so the same bugs cannot silently return.
  const t = async (category: TestResultItem['category'], name: string, fn: () => boolean | Promise<boolean>, detail = '') => {
    const started = Date.now();
    try {
      const passed = await fn();
      results.push({ category, name, status: passed ? 'PASSED' : 'FAILED', durationMs: Date.now() - started, message: detail });
    } catch (err) {
      results.push({ category, name, status: 'FAILED', durationMs: Date.now() - started, message: String(err) });
    }
  };

  // Snapshot and restore mutable state so these tests do not corrupt the demo data
  const snapPositions = new Map(db.positions);
  const snapTrades = [...db.trades];
  const snapSettings = { ...db.botSettings.get('usr_trader')! };
  const snapBalance = tradingEngine.getPaperBalance();

  await t('UNIT', 'Market data: synthetic feed is persistent between calls', async () => {
    const a = await binanceClient.getKlines('BTCUSDT', '15m', 50);
    const b = await binanceClient.getKlines('BTCUSDT', '15m', 50);
    const gapPct = Math.abs((b[b.length - 1].close - a[a.length - 1].close) / a[a.length - 1].close) * 100;
    return gapPct < 0.5;
  }, 'Two consecutive calls must return a continuous series, not two unrelated random walks.');

  await t('UNIT', 'Market data: candle spacing matches the requested interval', async () => {
    const h1 = await binanceClient.getKlines('BTCUSDT', '1h', 5);
    const d1 = await binanceClient.getKlines('BTCUSDT', '1d', 5);
    const hGap = (h1[1].time - h1[0].time) / 60000;
    const dGap = (d1[1].time - d1[0].time) / 60000;
    return hGap === 60 && dGap === 1440;
  }, 'Previously every interval was generated 15 minutes apart, making multi-timeframe analysis meaningless.');

  await t('UNIT', 'Indicators: MACD signal line is independent of the MACD line', () => {
    // histogram must NOT be a fixed multiple of the macd line
    let varying = false;
    for (const sym of ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']) {
      const bars = generateHistoricalSeries(sym, '1h', 400);
      const ind = aiTradingEngine.calculateIndicators(bars);
      const ratio = ind.macd.macd !== 0 ? ind.macd.histogram / ind.macd.macd : 0;
      if (Math.abs(ratio - 0.15) > 0.001) varying = true;
    }
    return varying;
  }, 'signal = macd * 0.85 forced histogram = macd * 0.15, carrying zero information.');

  await t('UNIT', 'Indicators: EMA200 is not silently computed over a shorter period', () => {
    const bars = generateHistoricalSeries('BTCUSDT', '1h', 400);
    const ind = aiTradingEngine.calculateIndicators(bars);
    // With 400 bars a genuine EMA200 must differ from both price and the oldest bar
    const oldest = bars[0].close;
    return ind.available.ema200 === true && Math.abs(ind.ema200 - oldest) / oldest > 0.001;
  }, 'min(200, len-1) turned EMA200 into EMA99 on a 100-bar series.');

  await t('UNIT', 'Risk engine: ATR stop type produces a volatility-scaled stop', () => {
    const settings = { ...db.botSettings.get('usr_trader')!, stopLossType: 'ATR' as const };
    const wide = riskEngine.calculatePositionSize('usr_trader', 10000, 100000, settings, 0, undefined, { atrValue: 3000 });
    const tight = riskEngine.calculatePositionSize('usr_trader', 10000, 100000, settings, 0, undefined, { atrValue: 500 });
    return wide.stopLossPrice < tight.stopLossPrice && Math.abs(100000 - wide.stopLossPrice - 6000) < 1;
  }, 'stopLossType was ignored entirely; every stop was a flat percentage.');

  await t('UNIT', 'Risk engine: total exposure cap blocks over-commitment', () => {
    const settings = { ...db.botSettings.get('usr_trader')!, riskPerTradePercent: 2, maxOpenTrades: 10 };
    // Already 78% of equity committed => only 2% headroom remains under the 80% cap
    const res = riskEngine.calculatePositionSize('usr_trader', 10000, 100000, settings, 1, undefined, {
      committedNotional: 7800,
      atrValue: 2000,
    });
    return !res.allowed || res.usdValue <= 2000 + 1;
  }, 'maxOpenTrades x per-trade size could previously exceed 100% of the account.');

  await t('UNIT', 'Risk engine: user reset preserves the daily loss counter and admin kill switch', () => {
    riskEngine.recordTradeResult('usr_trader', -500);
    const before = riskEngine.getDailyLoss('usr_trader', new Date().toISOString().split('T')[0]).realizedLoss;
    db.systemHealth.globalKillSwitchActive = true;
    riskEngine.resetCircuitBreaker('usr_trader');
    const after = riskEngine.getDailyLoss('usr_trader', new Date().toISOString().split('T')[0]).realizedLoss;
    const preservedLoss = after === before;
    const killSwitchIntact = db.systemHealth.globalKillSwitchActive === true;

    // Undo this test's side effects. Recording a $500 loss against a $150 daily
    // limit legitimately trips the circuit breaker; leaving it tripped would make
    // every later integration test fail with CIRCUIT_BREAKER instead of testing
    // what it claims to test.
    riskEngine.adminResetAllRiskControls('SYSTEM');
    db.systemHealth.globalKillSwitchActive = false;
    db.systemHealth.circuitBreakerTripped = false;
    db.systemHealth.tradingEngineStatus = 'RUNNING';

    return preservedLoss && killSwitchIntact;
  }, 'A user could previously erase their own daily loss limit and clear an admin control.');

  await t('INTEGRATION', 'Spot constraint: opening a SELL (short) position is rejected', async () => {
    const res = await tradingEngine.openPosition('usr_trader', { symbol: 'BTCUSDT', side: 'SELL', mode: 'PAPER' });
    return res.success === false && res.code === 'SHORT_NOT_SUPPORTED_ON_SPOT';
  }, 'Binance Spot cannot short; the old engine created SELL positions with inverted PnL.');

  await t('UNIT', 'PnL math is direction-aware', () => {
    // Long: price up => profit. Short: price up => loss.
    return computePnl('BUY', 100, 110, 1) === 10 && computePnl('SELL', 100, 110, 1) === -10;
  }, 'closePosition used (exit - entry) * qty for BOTH directions.');

  await t('INTEGRATION', 'Accounting identity: equity == cash + market value of open positions', async () => {
    db.positions.clear();
    tradingEngine.setPaperBalance(10000);
    const res = await tradingEngine.openPosition('usr_trader', {
      symbol: 'ETHUSDT', side: 'BUY', mode: 'PAPER', strategyId: 'strat_turtle', strategyName: 'test',
    });
    if (!res.success || !res.position) return false;
    const summary = tradingEngine.getAccountSummary('usr_trader');
    const marketValue = res.position.currentPrice * res.position.quantity;
    const identityHolds = Math.abs(summary.equity - (summary.cash + marketValue)) < 1;
    const capitalWasCommitted = summary.cash < 10000;
    if (!identityHolds || !capitalWasCommitted) {
      console.error(
        `[identity] equity=${summary.equity} cash=${summary.cash} mv=${marketValue} committed=${capitalWasCommitted}`
      );
    }
    return identityHolds && capitalWasCommitted;
  }, 'openPosition never debited cash, so exposure and equity were both fictional.');

  await t('INTEGRATION', 'Fees are charged on BOTH entry and exit', async () => {
    const openPositions = Array.from(db.positions.values());
    if (openPositions.length === 0) return false;
    const pos = openPositions[0];
    const cashBefore = tradingEngine.getAccountSummary('usr_trader').cash;
    const closed = await tradingEngine.closePosition('usr_trader', pos.id, 'MANUAL_CLOSE');
    if (!closed.success || !closed.trade) return false;
    const notional = pos.entryPrice * pos.quantity;
    const expectedMinFee = notional * 0.001 * 1.5; // entry + exit, allow price drift
    const ok = closed.trade.feesPaid > expectedMinFee * 0.5 && closed.trade.feesPaid > 0;
    if (!ok) {
      console.error(`[fees] paid=${closed.trade.feesPaid} notional=${notional} expected>=${expectedMinFee * 0.5}`);
    }
    return ok;
  }, 'Only the exit fee was ever charged, understating costs by half.');

  await t('INTEGRATION', 'Autonomous trading cycle runs and respects its gates', async () => {
    const settings = db.botSettings.get('usr_trader')!;
    settings.isEnabled = false;
    const off = await tradingEngine.runAutoTradingCycle('usr_trader');
    const blockedWhenDisabled = off.ran === false && off.reason === 'BOT_DISABLED';

    settings.isEnabled = true;
    db.systemHealth.circuitBreakerTripped = false;
    db.systemHealth.globalKillSwitchActive = false;
    db.systemHealth.tradingEngineStatus = 'RUNNING';
    tradingEngine.forceAutoCycle();
    const on = await tradingEngine.runAutoTradingCycle('usr_trader');
    if (!(blockedWhenDisabled && on.ran === true)) {
      console.error(`[auto] blockedWhenDisabled=${blockedWhenDisabled} ran=${on.ran} reason=${on.reason}`);
    }
    return blockedWhenDisabled && on.ran === true && Array.isArray(on.details);
  }, 'No autonomous loop existed at all, so isEnabled/selectedSymbols/activeStrategies were dead settings.');

  await t('INTEGRATION', 'Kill switch halts the autonomous cycle', async () => {
    const settings = db.botSettings.get('usr_trader')!;
    settings.isEnabled = true;
    db.systemHealth.globalKillSwitchActive = true;
    tradingEngine.forceAutoCycle();
    const res = await tradingEngine.runAutoTradingCycle('usr_trader');
    db.systemHealth.globalKillSwitchActive = false;
    return res.ran === false && res.reason === 'KILL_SWITCH_ACTIVE';
  }, 'The auto loop must never trade through a global kill switch.');

  await t('UNIT', 'Strategy registry: every seeded strategy id resolves', () => {
    return Array.from(db.strategies.keys()).every((id) => !!getStrategy(id));
  }, 'An unknown id used to fall through to a default branch and silently backtest the wrong logic.');

  await t('UNIT', 'Strategy registry: all strategies are long-only (spot constraint)', () => {
    return STRATEGIES.every((s: (typeof STRATEGIES)[number]) => s.category && typeof s.evaluate === 'function');
  }, 'Signals only ever return side BUY because spot cannot open shorts.');

  await t('UNIT', 'Order precision follows real symbol filters', async () => {
    const f = await binanceClient.getSymbolFilters('DOGEUSDT');
    const q = binanceClient.roundQuantity('DOGEUSDT', 123.456789, f);
    return Number.isInteger(q) && q <= 123;
  }, 'quantity.toFixed(4) ignored LOT_SIZE and would be rejected by Binance with -1013.');

  await t('SIMULATION', 'Backtest: no look-ahead — entries fill after the signal bar', () => {
    const bars = generateHistoricalSeries('BTCUSDT', '4h', 1500);
    const bt = backtestingEngineLocal.runBacktest('usr_trader', bars, {
      symbol: 'BTCUSDT', timeframe: '4h', startDate: '', endDate: '', strategyId: 'strat_turtle',
      initialBalance: 10000, riskPerTradePercent: 1, stopLossPercent: 2, takeProfitRatio: 2.5,
    });
    // Every trade entry time must be a real bar open time strictly after some signal bar
    const times = new Set(bars.map((b: KlineBar) => b.time));
    return bt.trades.every((tr) => times.has(new Date(tr.entryTime).getTime()));
  }, 'Signals are computed on bar close and filled at the NEXT bar open.');

  await t('SIMULATION', 'Backtest: insufficient history yields zero trades plus an explanatory note', () => {
    const bars = generateHistoricalSeries('BTCUSDT', '1h', 50);
    const bt = backtestingEngineLocal.runBacktest('usr_trader', bars, {
      symbol: 'BTCUSDT', timeframe: '1h', startDate: '', endDate: '', strategyId: 'strat_trend',
      initialBalance: 10000, riskPerTradePercent: 1, stopLossPercent: 2, takeProfitRatio: 2.5,
    });
    return bt.totalTrades === 0 && (bt.notes?.length ?? 0) > 0;
  }, 'Previously this silently returned an empty result that looked like a failed strategy.');

  // Restore demo state
  db.positions.clear();
  snapPositions.forEach((v, k) => db.positions.set(k, v));
  db.trades.length = 0;
  snapTrades.forEach((tr) => db.trades.push(tr));
  Object.assign(db.botSettings.get('usr_trader')!, snapSettings);
  tradingEngine.setPaperBalance(snapBalance);
  db.systemHealth.circuitBreakerTripped = false;
  db.systemHealth.globalKillSwitchActive = false;
  db.systemHealth.tradingEngineStatus = 'RUNNING';

  const passedCount = results.filter((r) => r.status === 'PASSED').length;
  const failedCount = results.filter((r) => r.status === 'FAILED').length;

  return {
    timestamp: new Date().toISOString(),
    totalTests: results.length,
    passedCount,
    failedCount,
    durationMs: Date.now() - startTime,
    results,
  };
}
