# Bot Audit — Defects Found, Fixes Applied, Measured Results

Date: 2026-09-15 · Branch: `arena/01a0a679-ai-triding-bot-in-bainanci`

**Read this before trusting any number in this repository.**
Every Binance market-data host is unreachable from the sandbox where this audit ran
(`api.binance.com`, `data-api.binance.vision`, CoinGecko, Yahoo, CryptoCompare, Coinbase,
Bitstamp, Kraken — all fail to connect). All prices therefore come from a **seeded,
persistent simulation**. The results below prove the *logic* is correct and the
*direction* of each fix is right. They are **not** evidence of profit on real markets.

Reproduce with:

```bash
npm install
npm run lint                 # tsc --noEmit, must be clean
npx tsx scripts/diagnose.ts  # asserts each fixed defect stays fixed
npx tsx scripts/validate.ts  # performance validation, 24 datasets / 4 timeframes
npm run dev:watch            # server on 0.0.0.0:3000
```

---

## 1. Defects that made the bot lose money

These are not style complaints. Each one either produced false performance numbers or
placed orders that could not work.

### Accounting (the most serious group)

| # | Defect | Consequence |
|---|---|---|
| 1 | `openPosition` never debited cash | Position size, exposure and equity were all fictional. The bot believed it had 100% of capital available after every entry. |
| 2 | PnL computed as `(exit − entry) × qty` for **both** directions | Every SELL position reported inverted profit. A losing short showed as a win. |
| 3 | Fees charged on the exit leg only | Real cost is double. Backtests were systematically optimistic by ~0.15% per round trip. |
| 4 | `SELL` accepted as an opening order on a **Spot** account | Binance Spot cannot short. The engine created positions that were impossible to execute. Now rejected with `SHORT_NOT_SUPPORTED_ON_SPOT`. |
| 5 | Equity ≠ cash + market value | No invariant to check, so all of the above went unnoticed. Now asserted by test. |

### Indicators

| # | Defect | Consequence |
|---|---|---|
| 6 | `signal = macd × 0.85` (fabricated signal line) | Histogram was *always* `macd × 0.15` — a constant multiple carrying zero information. Every MACD crossover rule was noise. |
| 7 | `EMA200` computed as `min(200, len − 1)` | On a 100-bar series it silently became EMA99 and behaved like a fast average, inverting trend filters. |
| 8 | No warm-up discipline | Indicators returned values during their warm-up window instead of `NaN`, so early bars produced spurious signals. |

### Market data

| # | Defect | Consequence |
|---|---|---|
| 9 | Independent random draw per candle | Produced a −79% buy-and-hold path. Every backtest ran on impossible data. Replaced with a Markov regime chain (~12-day average regime, ~zero long-run drift). |
| 10 | Every interval generated 15 minutes apart | `1h` and `1d` series were spaced like `15m`. Multi-timeframe analysis was meaningless. Now spacing is derived from the interval and asserted by test. |
| 11 | Non-persistent series | Two consecutive calls returned unrelated random walks, so a scanner and a backtest disagreed about the same symbol. |
| 12 | Cache depth capped at ~540 bars for coarse intervals | After the 220-bar warm-up only ~320 tradable bars remained — Turtle produced **9 trades**. Now 1500–3000 bars (500 days on 4h, 4.1 years on 1d). |

### Risk

| # | Defect | Consequence |
|---|---|---|
| 13 | `stopLossType: 'ATR'` ignored entirely | Every stop was a flat percentage regardless of volatility. |
| 14 | No total-exposure cap | `maxOpenTrades × per-trade size` could exceed 100% of the account. Now capped at 80% of equity. |
| 15 | User-level reset cleared the daily loss counter | A user could erase their own loss limit. Reset is now admin-only; the daily counter survives a user reset. |
| 16 | User-level reset cleared the admin kill switch | Privilege escalation. Admin controls now require admin. |

### Execution

| # | Defect | Consequence |
|---|---|---|
| 17 | `quantity.toFixed(4)` with no `LOT_SIZE` filter | Binance rejects with `-1013`. Now rounded through real symbol filters. |
| 18 | No autonomous trading loop existed | `isEnabled`, `selectedSymbols` and `activeStrategies` were dead settings nothing ever read. The loop is now implemented and gated by kill switch, circuit breaker and mode. |

### Missing API routes (found last, and the reason the UI looked broken)

The frontend called three routes that did not exist. They fell through to the Vite SPA
catch-all and returned `index.html` with **HTTP 200** — so `res.ok` was true and the
failure was silent.

| Route | UI element | Before |
|---|---|---|
| `GET /api/bot/strategies` | strategy list | HTML parsed as an empty array |
| `POST /api/bot/toggle` | start/stop button | React state changed, **server kept doing whatever it was doing** |
| `POST /api/trading/set-mode` | PAPER/LIVE switch | `tradingMode` did not exist server-side at all — the button was decorative |

`LIVE` is now gated by three independent locks: `globalLiveTradingEnabled`, a real
(non-simulated) market-data source, and actual Binance credentials for that user.

### Security (found during final pre-push verification)

These were still live in the working tree after the trading fixes and were closed
immediately before the commit.

| # | Defect | Consequence |
|---|---|---|
| 26 | **Complete RBAC bypass.** `getRequestUser` accepted any `tok_<userId>_<anything>` string by parsing the user id out of it, accepted a bare user id as a token, and accepted an `x-user-id` header | `Authorization: Bearer tok_usr_admin_x` granted full admin with no credentials. Removed — a token is now valid only if this server issued it. |
| 27 | Session tokens were `tok_${userId}_${Date.now()}` | Guessable, and they encoded identity. Now 256 bits of CSPRNG output (`server/auth.ts`). |
| 28 | Passwords stored **in plaintext** in the `passwordHash` field, compared with `!==` | The seeded admin password was readable straight out of the committed source; the comparison leaked timing. Now scrypt + per-user salt + `timingSafeEqual`. |
| 29 | Sessions never expired | Added an 8-hour TTL, enforced on lookup. |
| 30 | Hardcoded demo tokens are public in `src/App.tsx` and granted ADMIN | Registered only when `NODE_ENV !== 'production'`; disable explicitly with `DISABLE_DEMO_SESSIONS=1`. **A real deployment must require the login form.** |

Verified against the live server (`GET /api/admin/overview`):

```
forged tok_usr_admin_x   -> 401     trader on admin route -> 403
bare user id as token    -> 401     real admin token      -> 200
x-user-id: usr_admin     -> 401     wrong password        -> 401
no auth header           -> 401
```

Note when testing this yourself: routes that do not exist fall through to the Vite SPA
catch-all and return `index.html` with **HTTP 200**. That false positive hid three
missing routes and made the first bypass test look like it passed. Always assert on the
response body, not just the status code.

### Backtest methodology

| # | Defect | Consequence |
|---|---|---|
| 19 | Walk-forward sliced the candle array | Discarded the indicator warm-up, so out-of-sample windows produced zero trades that were then averaged into the verdict as if they were evidence. |
| 20 | Profit factor averaged per-window sentinels | A `99` sentinel for "no losing trades" was averaged with real values, producing meaningless PF. Now pooled from gross profit / gross loss. |
| 21 | A fold with **1 trade** counted as a fold | The profitable-window rate became a coin flip driven by whichever single trade landed in the window. Folds now need ≥5 out-of-sample trades to inform the verdict; otherwise the verdict rests on pooled dollars. |
| 22 | Each fold split 70/30 | Out-of-sample coverage was an arbitrary 30% of history that changed completely with fold count — the same strategy pooled to **+1038 USD at 5 folds and −281 USD at 8**. Replaced with anchored expanding windows whose OOS blocks tile the timeline. Pooled PF is now 1.82 / 2.11 / 2.06 at 3 / 5 / 8 folds. |
| 23 | "No data" reported as `OVERFITTED` | Absence of evidence was presented as evidence of failure. New verdict `INSUFFICIENT_DATA`. |
| 24 | Compounded annualisation of short windows | A 42-day +21% result "annualised" to **2806%**. Replaced with linear per-100-day scaling. |
| 25 | Unknown strategy id fell through to a default branch | A typo backtested the wrong logic and reported it as a result. |

---

## 2. Why the bot was losing: the timeframe mismatch

The single largest lever. Identical rules, different bar size:

| Strategy | On 1h | On its designed 4h |
|---|---|---|
| Turtle | **−3.62%** /100d, 302 trades | **+2.84%** /100d, 166 trades |
| RSI(2) | −4.93% /100d | −0.69% /100d |
| Dual Momentum | +1.94% /100d | +1.01% /100d (fewer trades, less fee drag) |

A daily-bar system run on hourly bars trades ~24× more often. Costs are 0.30% round trip,
so the extra turnover converts a working edge into a losing one.

The legacy SMA 9/21 crossover is the clearest case: **gross edge was positive (+2.5%) but
net was −3.04%** — 361 trades burned 5.6% of capital in fees. It did not have a bad
signal, it had an unaffordable one.

Each strategy now carries `recommendedTimeframes`, and the autonomous loop evaluates every
system **on its own timeframe** rather than one global setting.

---

## 3. Validation results (simulated data)

24 datasets = 3 symbols × 2 windows × 4 timeframes, 61,200 candles, 0.30% round-trip cost.

A strategy passes only if it clears **all six** filters: ≥30 trades, net > 0, PF > 1.05,
walk-forward not failing, parameter robustness not fragile, max drawdown < 20%.

| Verdict | Strategy |
|---|---|
| **PASS** | `strat_turtle` on **4h** — +2.84%/100d, PF 1.84, maxDD 7.82%, 166 trades, walk-forward ROBUST, robustness ROBUST (10/10 trials profitable) |
| **PASS** | `strat_dual_momentum` on **4h** — +1.01%/100d, PF 1.23, maxDD 8.31%, 140 trades, ROBUST + ROBUST |
| Near miss | `strat_fractal` on 1h — +4.50%/100d, PF 1.66, maxDD 6.98%, but fragile on one BTC-specific window |
| **No edge** | `strat_rsi2` — gross return −0.12%. There is nothing to rescue with better exits. **Do not enable.** |
| Edge eaten by costs | `strat_breakout`, `strat_pullback`, `strat_momentum`, `strat_supertrend`, legacy SMA |
| Too few trades | `strat_vwap_reversion` — 23 trades on 15m |

Only the two passing strategies are enabled by default, on 4h.

### What the market actually looked like

A long-only spot bot cannot profit in a sustained downtrend except by holding cash.
Preserving capital there *is* the edge, which is why alpha-versus-buy-and-hold matters
more than absolute return. The tested windows contained 21–53% `TREND_UP`, 11–26%
`TREND_DOWN`, 14–50% `RANGE`, and buy-and-hold ranged from −54% to +646% across datasets.

---

## 4. Non-negotiables

1. **Risk 0.5–1% per trade.** At 2%, four consecutive losses cost ~8% and the circuit
   breaker (correctly) locks the bot out for the day.
2. **Trade each system on its designed timeframe.** Fees scale with trade count.
3. **Trade with the higher-timeframe trend.** In a downtrend the position is cash.
4. **Re-validate on real Binance history before believing any table above**, then paper
   trade for at least two weeks before committing real funds.

Nothing here is financial advice or a guarantee of profit.

---

## 5. Test coverage

`server/testSuite.ts` — 27 tests, all passing, runnable via `POST /api/system/run-tests`.

The suite is **repeatable**: an early version recorded a $500 loss against a $150 daily
limit and never cleaned up, so the circuit breaker stayed tripped and every later test
failed with `CIRCUIT_BREAKER` instead of testing what it claimed. The preamble now calls
`adminResetAllRiskControls` (a plain `resetCircuitBreaker` deliberately no longer clears
the loss tracker — that was defect #15).

Regression tests exist for each numbered defect above, including: series persistence,
candle spacing, MACD signal independence, EMA period integrity, ATR stops, exposure cap,
admin-only reset, short rejection, direction-aware PnL, the equity identity, two-legged
fees, autonomous-cycle gating, kill-switch halt, registry resolution, order precision,
no-look-ahead entries, and the insufficient-history note.

---

## 6. Known limitations

- **Demo sessions.** `tok_usr_admin_default` / `tok_usr_trader_default` are hardcoded in
  `src/App.tsx` so the preview loads without a login. They are disabled under
  `NODE_ENV=production`, but a real deployment should remove them and require the login
  form. Defect #30.
- `scripts/diagnose.ts` still prints its original findings. It was written against the
  committed code and several of its checks are now stale — the authoritative regression
  coverage is `server/testSuite.ts` (27 tests, all passing). Treat diagnose output as a
  historical record of what was wrong, not as current status.

- `npm run dev` uses `tsx` **without** watch mode, so server-side edits are not picked up.
  This silently produced stale results twice during the audit. `npm run dev:watch` exists
  for that reason; `dev` was left unchanged so existing tooling keeps working.
- State is in-memory (`server/db.ts`). Restarting the server discards positions, trades
  and settings.
- `node_modules` is not persisted by the workspace snapshot. Run `npm install` after any
  restore or the server will fail to start.
