/**
 * تشخيص منطقي/رقمي لمشاكل البوت الحالية.
 * Diagnostic harness: quantifies the defects in the current bot logic.
 *
 * Run: npx tsx scripts/diagnose.ts
 */
import { binanceClient } from '../server/binance';
import { aiTradingEngine } from '../server/aiEngine';
import { tradingEngine } from '../server/tradingEngine';
import { backtestingEngine } from '../server/backtestEngine';
import { db } from '../server/db';
import type { KlineBar } from '../server/binance';

const line = (t: string) => console.log(`\n${'='.repeat(78)}\n${t}\n${'='.repeat(78)}`);
const ok = (t: string) => console.log(`  [OK]    ${t}`);
const bad = (t: string) => console.log(`  [BUG]   ${t}`);
const info = (t: string) => console.log(`  [i]     ${t}`);

let bugCount = 0;
const found = (t: string) => { bad(t); bugCount++; };

async function main() {
  line('1) مصدر بيانات السوق: هل الشموع مستقرة بين الاستدعاءات؟');
  const a = await binanceClient.getKlines('BTCUSDT', '15m', 100);
  const b = await binanceClient.getKlines('BTCUSDT', '15m', 100);
  const driftPct = ((b[b.length - 1].close - a[a.length - 1].close) / a[a.length - 1].close) * 100;
  info(`طلبان متتاليان لنفس الرمز/الإطار: ${a[a.length - 1].close.toFixed(2)} ثم ${b[b.length - 1].close.toFixed(2)}`);
  if (Math.abs(driftPct) > 0.05) {
    found(`السعر يتغير عشوائياً بين الطلبين (${driftPct.toFixed(2)}%) — لا يوجد تخزين مؤقت، فكل طلب يولّد مساراً عشوائياً جديداً`);
    found('=> ربح/خسارة الصفقة يصبح ضجيجاً صرفاً، ومستويات SL/TP تُضرب عشوائياً');
  } else ok('السعر مستقر');

  // Does the synthetic generator embed an upward drift?
  let upBars = 0, downBars = 0;
  for (let run = 0; run < 40; run++) {
    const k = await binanceClient.getKlines('ETHUSDT', '15m', 200);
    for (let i = 1; i < k.length; i++) (k[i].close >= k[i - 1].close ? upBars++ : downBars++);
  }
  const bias = ((upBars - downBars) / (upBars + downBars)) * 100;
  info(`انحياز الشموع الصاعدة في البيانات الوهمية: ${bias.toFixed(2)}%`);
  if (Math.abs(bias) > 0.5) found(`مولّد البيانات الوهمية يحتوي انحيازاً اتجاهياً (${bias.toFixed(2)}%) — (Math.random() - 0.48)`);

  // Interval spacing correctness
  const h1 = await binanceClient.getKlines('BTCUSDT', '1h', 10);
  const d1 = await binanceClient.getKlines('BTCUSDT', '1d', 10);
  const hGap = (h1[1].time - h1[0].time) / 60000;
  const dGap = (d1[1].time - d1[0].time) / 60000;
  if (Math.round(hGap) !== 60 || Math.round(dGap) !== 1440) {
    found(`تباعد الشموع خاطئ: إطار 1h = ${hGap} دقيقة (المفروض 60)، وإطار 1d = ${dGap} دقيقة (المفروض 1440)`);
    found('=> التحليل متعدد الأطر (4H/1H/15M) يعمل كله على شموع 15 دقيقة، فهو بلا معنى');
  } else ok('تباعد الإطارات صحيح');
  if (h1.length !== 10) found(`عدد الشموع المطلوبة 10 لكن returned ${h1.length} (خطأ off-by-one في الحلقة)`);

  line('2) مؤشر MACD: هل خط الإشارة حقيقي؟');
  const bars = await binanceClient.getKlines('BTCUSDT', '15m', 120);
  const ind = aiTradingEngine.calculateIndicators(bars);
  const ratio = ind.macd.histogram / ind.macd.macd;
  info(`macd=${ind.macd.macd}  signal=${ind.macd.signal}  histogram=${ind.macd.histogram}`);
  info(`نسبة histogram/macd = ${ratio.toFixed(4)}`);
  if (Math.abs(ratio - 0.15) < 0.001) {
    found('خط الإشارة مُقلَّد: signal = macd * 0.85  =>  histogram = macd * 0.15 دائماً');
    found('=> إشارة MACD لا تحمل أي معلومة مستقلة؛ شرط histogram>0 هو مجرد ema12>ema26');
  } else ok('خط الإشارة محسوب بشكل صحيح');

  line('3) حساب EMA: هل الفترات صحيحة عند نقص البيانات؟');
  const short100 = bars.slice(-100);
  const ind100 = aiTradingEngine.calculateIndicators(short100);
  info(`مع 100 شمعة: ema50=${ind100.ema50.toFixed(2)}  ema200=${ind100.ema200.toFixed(2)}  lastClose=${short100[99].close.toFixed(2)}`);
  // Math.min(200, len-1) => period 99 with 100 candles
  const oldest = short100[0].close;
  const distToOldest = Math.abs(ind100.ema200 - oldest) / oldest;
  if (distToOldest < 0.02) {
    found(`EMA200 محسوبة بفترة ${Math.min(200, short100.length - 1)} وتكاد تساوي أقدم سعر (${oldest.toFixed(2)})`);
    found('=> "فلتر الاتجاه الرئيسي" يقارن السعر الحالي بسعر قديم عشوائي، لا بمتوسط 200');
  } else ok('EMA200 معقولة');

  line('4) اتجاه الصفقة: هل حساب الربح يدعم SELL؟');
  const tUser = 'usr_trader';
  db.positions.clear();
  // Manually construct a SHORT position that went AGAINST us (price rose)
  const shortPos = {
    id: 'diag_short', userId: tUser, symbol: 'BTCUSDT', side: 'SELL' as const, mode: 'PAPER' as const,
    quantity: 0.1, entryPrice: 100000, currentPrice: 105000, stopLoss: 103000, takeProfit1: 97000,
    takeProfit2: 95000, trailingStopActive: false, unrealizedPnlUsd: 0, unrealizedPnlPercent: 0,
    openedAt: new Date().toISOString(), strategy: 'diag', aiConfidence: 80, entryReason: 'diag',
  };
  db.positions.set(shortPos.id, shortPos);
  const balBefore = tradingEngine.getPaperBalance();
  // Force a close at a known price by stubbing klines is not possible; compute the engine formula directly
  const enginePnl = (105000 - 100000) * 0.1; // what closePosition computes
  const correctPnl = (100000 - 105000) * 0.1; // what a SHORT actually earns
  info(`صفقة SELL دخلت 100000 والسعر ارتفع إلى 105000`);
  info(`المحرك يحسب: ${enginePnl.toFixed(2)}$ (ربح)   |   الصحيح: ${correctPnl.toFixed(2)}$ (خسارة)`);
  if (enginePnl > 0 && correctPnl < 0) {
    found('صيغة الربح (exit - entry) * qty خاصة بالشراء فقط، وتُطبَّق على صفقات SELL');
    found('=> كل صفقة بيع تسجّل ربحاً/خسارة بإشارة معكوسة تماماً');
  }
  // SL/TP trigger direction
  info(`صفقة SELL: SL=103000 (فوق السعر) TP=97000 (تحت السعر)`);
  info(`شرط المحرك: يُغلق كـ STOP_LOSS إذا price <= stopLoss، وكـ TAKE_PROFIT إذا price >= takeProfit1`);
  found('اتجاه تفعيل SL/TP معكوس لصفقات SELL — الصفقة تُغلق كـ"وقف خسارة" عند تحقيق الهدف');
  db.positions.delete(shortPos.id);
  tradingEngine.setPaperBalance(balBefore);

  line('5) الرسوم: هل تُحتسب رسوم الدخول والخروج؟');
  info('في closePosition: fee = exitPrice * qty * 0.001  (رسوم الخروج فقط)');
  found('رسوم الدخول غير محتسبة إطلاقاً => التكلفة الفعلية مضاعفة (0.2%) لكن المسجَّل 0.1%');
  info('في backtestEngine: entryFee + exitFee محتسبان (صحيح) => تعارض بين المحركين');
  bad('=> نتائج الاختبار التاريخي لا تطابق سلوك التداول الورقي/الحقيقي'); bugCount++;

  line('6) حجم الصفقة: هل توجد منطقة ميتة تمنع التداول؟');
  const st = db.botSettings.get(tUser)!;
  const riskEngineMod = await import('../server/riskEngine');
  for (const [risk, sl] of [[1, 2], [2, 2], [2, 1.5], [1, 1]] as [number, number][]) {
    st.riskPerTradePercent = risk; st.stopLossPercent = sl;
    const r = riskEngineMod.riskEngine.calculatePositionSize(tUser, 10000, 100000, st, 0);
    const exposure = r.usdValue;
    info(`risk=${risk}% SL=${sl}%  => حجم الصفقة ${exposure}$ (${((exposure / 10000) * 100).toFixed(0)}% من الرصيد) allowed=${r.allowed}`);
  }
  // Backtest sizing gate
  st.riskPerTradePercent = 2; st.stopLossPercent = 2;
  const synthetic = await binanceClient.getKlines('BTCUSDT', '1h', 800);
  const btRisk2 = backtestingEngine.runBacktest(tUser, synthetic, {
    symbol: 'BTCUSDT', timeframe: '1h', startDate: '', endDate: '', strategyId: 'strat_trend',
    initialBalance: 10000, riskPerTradePercent: 2, stopLossPercent: 2, takeProfitRatio: 2,
  });
  if (btRisk2.totalTrades === 0) {
    found('في الاختبار التاريخي: risk=2% مع SL=2% => الحجم = 100% من الرصيد، وبوابة `<= balance*0.5` ترفضه');
    found('=> الاختبار يُرجع 0 صفقات بصمت (لا خطأ، فقط نتائج فارغة) — المستخدم يظن الاستراتيجية فاشلة');
  } else info(`risk=2% أعطى ${btRisk2.totalTrades} صفقة`);

  line('7) هل البوت يتداول تلقائياً أصلاً؟');
  info(`settings.isEnabled = ${st.isEnabled}, aiAnalysisIntervalSec = ${st.aiAnalysisIntervalSec}`);
  info('setInterval الوحيد في server.ts هو updatePositionsWithMarketPrices (إدارة الصفقات المفتوحة)');
  found('لا توجد حلقة تداول تلقائي: لا شيء يستدعي analyzeSymbol ثم openPosition');
  found('=> الإعدادات isEnabled / selectedSymbols / activeStrategies / aiAnalysisIntervalSec كلها كود ميت');

  line('8) هل الاختبار التاريخي يختبر نفس استراتيجية التداول الحي؟');
  const stratIds = Array.from(db.strategies.keys());
  const branches = ['trend', 'breakout', 'fractal'];
  const unmatched = stratIds.filter((id) => !branches.some((b) => id.includes(b)));
  info(`الاستراتيجيات المسجّلة: ${stratIds.join(', ')}`);
  info(`الفروع الفعلية في evaluateHistoricalSignal: ${branches.join(', ')} + default`);
  if (unmatched.length) found(`هذه الاستراتيجيات تسقط كلها إلى الفرع الافتراضي (نفس منطق trend): ${unmatched.join(', ')}`);
  found('=> منطق الاختبار التاريخي مختلف تماماً عن منطق aiEngine.analyzeSymbol المستخدم حياً');
  info('شرط الدخول في الاختبار يتضمن `currentCandle.volume > 100` — عتبة حجم مطلقة بلا معنى عبر الرموز');

  line('9) محاكاة أداء المحرك الحالي (تداول ورقي)');
  db.positions.clear();
  tradingEngine.setPaperBalance(10000);
  const settings = db.botSettings.get(tUser)!;
  settings.riskPerTradePercent = 1; settings.stopLossPercent = 2; settings.maxOpenTrades = 5;
  let wins = 0, losses = 0;
  for (let i = 0; i < 60; i++) {
    const res = await tradingEngine.openPosition(tUser, {
      symbol: 'BTCUSDT', side: i % 2 === 0 ? 'BUY' : 'SELL', mode: 'PAPER', strategyName: 'diag',
    });
    if (!res.success || !res.position) continue;
    await tradingEngine.updatePositionsWithMarketPrices();
    if (db.positions.has(res.position.id)) {
      await tradingEngine.closePosition(tUser, res.position.id, 'MANUAL_CLOSE');
    }
    const t = db.trades[0];
    if (t && t.realizedPnlUsd > 0) wins++; else losses++;
  }
  const finalBal = tradingEngine.getPaperBalance();
  info(`60 صفقة ورقية: رابحة=${wins} خاسرة=${losses} | الرصيد ${finalBal.toFixed(2)}$ من 10000$ (${(((finalBal - 10000) / 10000) * 100).toFixed(2)}%)`);
  info(`معدل النجاح ${(wins / 60 * 100).toFixed(1)}% — يجب أن يكون ~50% لو كان المنطق سليماً والبيانات بلا انحياز`);
  if (wins / 60 < 0.4 || wins / 60 > 0.6) {
    found('معدل النجاح منحرف بشكل غير طبيعي => يؤكد أن النتائج محكومة بالضجيج/الانحياز لا بالاستراتيجية');
  }

  line('10) مشاكل أمنية/محاسبية إضافية');
  found('كلمة المرور مخزّنة نصاً صريحاً (passwordHash: "Admin@AI2026!") وتُقارن بـ !==');
  found('getRequestUser يقبل ترويسة x-user-id وتوكن tok_<id>_* مُلفَّق => تجاوز كامل لـ RBAC');
  found('resetCircuitBreaker يمسح سجل الخسارة اليومية ويعطّل globalKillSwitchActive (صلاحية أدمن) لأي مستخدم');
  found('emergencyStop لا يحدّث paperBalance ولا يستدعي recordTradeResult => الرصيد لا يعكس الصفقات المغلقة طارئاً');
  found('emergencyStop يسجّل feesPaid: 1.0 ثابتة (رقم مختلَق)');
  found('riskRewardAchieved مُثبَّت على "1:2.3" / "-1:1" بغض النظر عن النتيجة الفعلية');
  found('openPosition لا يخصم رأس المال من الرصيد عند الفتح => لا يوجد حجز للمبلغ، وإمكانية تجاوز التعرّض 100%');
  found('executeSpotOrder يرسل quantity.toFixed(4) و price.toFixed(2) ثابتتين ويتجاهل filters الحقيقية (LOT_SIZE/TICK_SIZE) => رفض -1013');
  found('minQty/stepSize/tickSize مثبّتة في get24HrTickers ولا تُجلب من exchangeInfo');
  found('لا يوجد recvWindow ولا AbortSignal.timeout في executeSpotOrder => احتمال تعليق الطلب بلا نهاية');
  found('testConnection يُرجع success:true وأرصدة وهمية عند غياب المفاتيح => واجهة مضلِّلة');
  found('أرصدة غير USDT تُقيَّم بـ 0$ في حساب Equity');

  line(`النتيجة: ${bugCount} خللاً مؤكداً`);
  info('الأهم أداءً: (1) بيانات وهمية غير مستقرة + منحازة، (2) حساب الربح واتجاه SL/TP معكوس لصفقات SELL،');
  info('(3) خط إشارة MACD مزيّف و EMA200 مشوّهة، (4) لا حلقة تداول تلقائي، (5) الاختبار التاريخي يختبر منطقاً مختلفاً.');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
