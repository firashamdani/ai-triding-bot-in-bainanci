import crypto from 'crypto';
import { MarketSymbol } from './types';
import { getSyntheticSeries, intervalToMs, profileFor } from './marketData';

export interface BinanceAccountInfo {
  canTrade: boolean;
  canWithdraw: boolean; // Must be false for safety
  canDeposit: boolean;
  accountType: string;
  balances: {
    asset: string;
    free: string;
    locked: string;
  }[];
}

export interface KlineBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** Real exchange trading filters — without these, live orders get rejected (-1013). */
export interface SymbolFilters {
  stepSize: number; // LOT_SIZE
  minQty: number; // LOT_SIZE
  tickSize: number; // PRICE_FILTER
  minNotional: number; // MIN_NOTIONAL / NOTIONAL
  basePrecision: number;
  quotePrecision: number;
}

const FALLBACK_FILTERS: Record<string, SymbolFilters> = {
  BTCUSDT: { stepSize: 0.00001, minQty: 0.00001, tickSize: 0.01, minNotional: 5, basePrecision: 5, quotePrecision: 2 },
  ETHUSDT: { stepSize: 0.0001, minQty: 0.0001, tickSize: 0.01, minNotional: 5, basePrecision: 4, quotePrecision: 2 },
  SOLUSDT: { stepSize: 0.01, minQty: 0.01, tickSize: 0.01, minNotional: 5, basePrecision: 2, quotePrecision: 2 },
  BNBUSDT: { stepSize: 0.01, minQty: 0.01, tickSize: 0.01, minNotional: 5, basePrecision: 2, quotePrecision: 2 },
  XRPUSDT: { stepSize: 0.1, minQty: 0.1, tickSize: 0.0001, minNotional: 5, basePrecision: 1, quotePrecision: 4 },
  DOGEUSDT: { stepSize: 1, minQty: 1, tickSize: 0.00001, minNotional: 5, basePrecision: 0, quotePrecision: 5 },
  ADAUSDT: { stepSize: 0.1, minQty: 0.1, tickSize: 0.0001, minNotional: 5, basePrecision: 1, quotePrecision: 4 },
  AVAXUSDT: { stepSize: 0.01, minQty: 0.01, tickSize: 0.01, minNotional: 5, basePrecision: 2, quotePrecision: 2 },
  LINKUSDT: { stepSize: 0.01, minQty: 0.01, tickSize: 0.01, minNotional: 5, basePrecision: 2, quotePrecision: 2 },
};

const DEFAULT_FILTERS: SymbolFilters = {
  stepSize: 0.001, minQty: 0.001, tickSize: 0.01, minNotional: 5, basePrecision: 3, quotePrecision: 2,
};

export type DataSource = 'LIVE_BINANCE' | 'SIMULATED_OFFLINE';

export class BinanceClient {
  private readonly spotBaseUrl = 'https://api.binance.com/api/v3';
  private readonly testnetBaseUrl = 'https://testnet.binance.vision/api/v3';

  /** Server-side only key store — NEVER returned to the client */
  private userCredentials = new Map<string, { apiKey: string; apiSecret: string; isTestnet: boolean }>();

  private filtersCache = new Map<string, SymbolFilters>();
  private filtersFetchedAt = 0;

  /** Where the most recent market data actually came from. Surfaced in System Health. */
  public lastDataSource: DataSource = 'SIMULATED_OFFLINE';
  public lastLiveFetchAt: number | null = null;
  public lastFetchError: string | null = null;

  setCredentials(userId: string, apiKey: string, apiSecret: string, isTestnet: boolean = false) {
    this.userCredentials.set(userId, { apiKey: apiKey.trim(), apiSecret: apiSecret.trim(), isTestnet });
  }

  getMaskedKey(userId: string): string {
    const creds = this.userCredentials.get(userId);
    if (!creds || !creds.apiKey) return '';
    const key = creds.apiKey;
    if (key.length <= 8) return '••••••••';
    return `${key.slice(0, 4)}••••••••••••••••${key.slice(-4)}`;
  }

  hasCredentials(userId: string): boolean {
    const creds = this.userCredentials.get(userId);
    return !!(creds && creds.apiKey && creds.apiSecret);
  }

  isTestnet(userId: string): boolean {
    return this.userCredentials.get(userId)?.isTestnet ?? true;
  }

  private getBaseUrl(isTestnet: boolean): string {
    return isTestnet ? this.testnetBaseUrl : this.spotBaseUrl;
  }

  private signQuery(queryString: string, secret: string): string {
    return crypto.createHmac('sha256', secret).update(queryString).digest('hex');
  }

  // ======================= Symbol filters / precision =======================

  /**
   * Fetch real LOT_SIZE / PRICE_FILTER / MIN_NOTIONAL rules from exchangeInfo.
   * Cached for 12h. Falls back to a static table (still per-symbol, not global).
   */
  async getSymbolFilters(symbol: string): Promise<SymbolFilters> {
    const cached = this.filtersCache.get(symbol);
    if (cached) return cached;

    const now = Date.now();
    if (now - this.filtersFetchedAt > 12 * 3600_000) {
      try {
        const res = await fetch(`${this.spotBaseUrl}/exchangeInfo`, {
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(5000),
        });
        if (res.ok) {
          const data: any = await res.json();
          for (const s of data.symbols || []) {
            const f: SymbolFilters = { ...(FALLBACK_FILTERS[s.symbol] ?? DEFAULT_FILTERS) };
            for (const filter of s.filters || []) {
              if (filter.filterType === 'LOT_SIZE') {
                f.stepSize = parseFloat(filter.stepSize) || f.stepSize;
                f.minQty = parseFloat(filter.minQty) || f.minQty;
              } else if (filter.filterType === 'PRICE_FILTER') {
                f.tickSize = parseFloat(filter.tickSize) || f.tickSize;
              } else if (filter.filterType === 'MIN_NOTIONAL' || filter.filterType === 'NOTIONAL') {
                f.minNotional = parseFloat(filter.minNotional ?? filter.notional) || f.minNotional;
              }
            }
            f.basePrecision = decimalsOf(f.stepSize);
            f.quotePrecision = decimalsOf(f.tickSize);
            this.filtersCache.set(s.symbol, f);
          }
          this.filtersFetchedAt = now;
          this.lastDataSource = 'LIVE_BINANCE';
          this.lastLiveFetchAt = now;
        }
      } catch (err: unknown) {
        this.lastFetchError = err instanceof Error ? err.message : 'exchangeInfo fetch failed';
      }
    }

    const resolved = this.filtersCache.get(symbol) ?? FALLBACK_FILTERS[symbol] ?? DEFAULT_FILTERS;
    this.filtersCache.set(symbol, resolved);
    return resolved;
  }

  /** Round a quantity DOWN to the symbol's step size (never up — that would over-buy). */
  roundQuantity(symbol: string, qty: number, filters?: SymbolFilters): number {
    const f = filters ?? this.filtersCache.get(symbol) ?? FALLBACK_FILTERS[symbol] ?? DEFAULT_FILTERS;
    if (!Number.isFinite(qty) || qty <= 0 || f.stepSize <= 0) return 0;
    const steps = Math.floor(qty / f.stepSize);
    const rounded = steps * f.stepSize;
    return Number(rounded.toFixed(f.basePrecision));
  }

  /** Round a price DOWN to the symbol's tick size. */
  roundPrice(symbol: string, price: number, filters?: SymbolFilters): number {
    const f = filters ?? this.filtersCache.get(symbol) ?? FALLBACK_FILTERS[symbol] ?? DEFAULT_FILTERS;
    if (!Number.isFinite(price) || price <= 0 || f.tickSize <= 0) return 0;
    const steps = Math.floor(price / f.tickSize);
    return Number((steps * f.tickSize).toFixed(f.quotePrecision));
  }

  /** Validate an intended order against exchange filters BEFORE sending it. */
  async validateOrder(symbol: string, quantity: number, price: number): Promise<{ ok: boolean; error?: string }> {
    const f = await this.getSymbolFilters(symbol);
    const qty = this.roundQuantity(symbol, quantity, f);
    if (qty < f.minQty) {
      return { ok: false, error: `Quantity ${qty} is below the exchange minimum ${f.minQty} for ${symbol} (LOT_SIZE).` };
    }
    const notional = qty * price;
    if (notional < f.minNotional) {
      return { ok: false, error: `Order notional $${notional.toFixed(2)} is below the ${symbol} minimum of $${f.minNotional} (MIN_NOTIONAL).` };
    }
    return { ok: true };
  }

  // ============================== Market data ==============================

  async get24HrTickers(): Promise<MarketSymbol[]> {
    const targetSymbols = Object.keys(FALLBACK_FILTERS);
    try {
      const response = await fetch(`${this.spotBaseUrl}/ticker/24hr`, {
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error(`Binance API returned ${response.status}`);

      const data = await response.json();
      const filtered: MarketSymbol[] = [];
      for (const item of data) {
        if (!targetSymbols.includes(item.symbol)) continue;
        const f = FALLBACK_FILTERS[item.symbol] ?? DEFAULT_FILTERS;
        filtered.push({
          symbol: item.symbol,
          baseAsset: item.symbol.replace('USDT', ''),
          quoteAsset: 'USDT',
          price: parseFloat(item.lastPrice),
          priceChange24h: parseFloat(item.priceChangePercent),
          high24h: parseFloat(item.highPrice),
          low24h: parseFloat(item.lowPrice),
          volume24h: parseFloat(item.volume),
          minQty: f.minQty,
          stepSize: f.stepSize,
          tickSize: f.tickSize,
          status: 'TRADING',
        });
      }
      if (filtered.length === 0) throw new Error('No target symbols in ticker response');
      this.lastDataSource = 'LIVE_BINANCE';
      this.lastLiveFetchAt = Date.now();
      this.lastFetchError = null;
      return filtered;
    } catch (err: unknown) {
      this.lastDataSource = 'SIMULATED_OFFLINE';
      this.lastFetchError = err instanceof Error ? err.message : 'ticker fetch failed';
      // Derive a consistent 24h snapshot from the SAME persistent series the
      // rest of the app uses, so prices never disagree between views.
      return targetSymbols.map((symbol) => {
        const bars = getSyntheticSeries(symbol, '1h', 25);
        const last = bars[bars.length - 1];
        const first = bars[0];
        const f = FALLBACK_FILTERS[symbol] ?? DEFAULT_FILTERS;
        return {
          symbol,
          baseAsset: symbol.replace('USDT', ''),
          quoteAsset: 'USDT',
          price: last.close,
          priceChange24h: ((last.close - first.open) / first.open) * 100,
          high24h: Math.max(...bars.map((b) => b.high)),
          low24h: Math.min(...bars.map((b) => b.low)),
          volume24h: bars.reduce((s, b) => s + b.volume, 0),
          minQty: f.minQty,
          stepSize: f.stepSize,
          tickSize: f.tickSize,
          status: 'TRADING' as const,
        };
      });
    }
  }

  /**
   * Fetch klines. On any failure, fall back to a PERSISTENT simulated series.
   *
   * The previous fallback rebuilt a fresh random walk on every call, which made
   * position PnL pure noise and made SL/TP fire at random. The simulated series
   * is now cached and only extended forward in time, so consecutive calls are
   * continuous — the same property real market data has.
   */
  async getKlines(symbol: string, interval: string = '15m', limit: number = 100): Promise<KlineBar[]> {
    try {
      intervalToMs(interval); // reject unknown intervals instead of silently mis-spacing bars
      const url = `${this.spotBaseUrl}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
      const response = await fetch(url, {
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error(`Klines error ${response.status}`);

      const raw = await response.json();
      if (!Array.isArray(raw) || raw.length === 0) throw new Error('Empty klines response');

      this.lastDataSource = 'LIVE_BINANCE';
      this.lastLiveFetchAt = Date.now();
      this.lastFetchError = null;
      return raw.map((k: (number | string)[]) => ({
        time: Number(k[0]),
        open: parseFloat(String(k[1])),
        high: parseFloat(String(k[2])),
        low: parseFloat(String(k[3])),
        close: parseFloat(String(k[4])),
        volume: parseFloat(String(k[5])),
      }));
    } catch (err: unknown) {
      this.lastDataSource = 'SIMULATED_OFFLINE';
      this.lastFetchError = err instanceof Error ? err.message : 'klines fetch failed';
      return getSyntheticSeries(symbol, interval, limit);
    }
  }

  /** Latest tradable price, consistent with getKlines. */
  async getLatestPrice(symbol: string): Promise<number> {
    const bars = await this.getKlines(symbol, '1m', 3);
    return bars[bars.length - 1]?.close ?? profileFor(symbol).startPrice;
  }

  // ============================== Connectivity ==============================

  /**
   * Test connection and verify the key has NO withdrawal permission.
   *
   * Honesty fix: with no credentials this now reports failure (sandbox demo
   * mode) instead of claiming a verified connection with invented balances.
   */
  async testConnection(userId: string): Promise<{
    success: boolean;
    sandbox: boolean;
    pingMs: number;
    permissions: { canRead: boolean; canTrade: boolean; canWithdraw: boolean };
    message: string;
    balances: { asset: string; free: number; locked: number; usdValue: number }[];
  }> {
    const creds = this.userCredentials.get(userId);
    const startPing = Date.now();

    if (!creds || !creds.apiKey) {
      return {
        success: false,
        sandbox: true,
        pingMs: 0,
        permissions: { canRead: false, canTrade: false, canWithdraw: false },
        message:
          'No Binance API key configured. Paper trading works without keys, but live trading requires a key with Trade enabled and Withdrawals DISABLED.',
        balances: [],
      };
    }

    try {
      const baseUrl = this.getBaseUrl(creds.isTestnet);
      const timestamp = Date.now();
      const queryString = `timestamp=${timestamp}&recvWindow=5000`;
      const signature = this.signQuery(queryString, creds.apiSecret);

      const res = await fetch(`${baseUrl}/account?${queryString}&signature=${signature}`, {
        method: 'GET',
        headers: { 'X-MBX-APIKEY': creds.apiKey },
        signal: AbortSignal.timeout(6000),
      });
      const pingMs = Date.now() - startPing;

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ msg: 'Unknown error' }));
        return {
          success: false,
          sandbox: false,
          pingMs,
          permissions: { canRead: false, canTrade: false, canWithdraw: false },
          message: `Binance Error (${res.status}): ${errorData.msg || res.statusText}`,
          balances: [],
        };
      }

      const accData: BinanceAccountInfo = await res.json();

      // SECURITY AUDIT: reject keys that can withdraw
      if (accData.canWithdraw) {
        return {
          success: false,
          sandbox: false,
          pingMs,
          permissions: { canRead: true, canTrade: accData.canTrade, canWithdraw: true },
          message:
            'SECURITY REJECTION: Your API Key has "Withdrawal" enabled. This platform prohibits keys with withdrawal access. Disable withdrawals in your Binance API settings and retry.',
          balances: [],
        };
      }

      // Value non-USDT balances using the latest simulated/live price instead of $0,
      // so Equity is not systematically understated.
      const balances = [];
      for (const b of accData.balances) {
        const free = parseFloat(b.free);
        const locked = parseFloat(b.locked);
        if (free <= 0 && locked <= 0) continue;
        let usdValue = 0;
        if (b.asset === 'USDT' || b.asset === 'USDC' || b.asset === 'BUSD' || b.asset === 'FDUSD') {
          usdValue = free + locked;
        } else {
          const pair = `${b.asset}USDT`;
          try {
            const px = await this.getLatestPrice(pair);
            usdValue = (free + locked) * px;
          } catch {
            usdValue = 0;
          }
        }
        balances.push({ asset: b.asset, free, locked, usdValue: Math.round(usdValue * 100) / 100 });
      }

      return {
        success: true,
        sandbox: false,
        pingMs,
        permissions: { canRead: true, canTrade: accData.canTrade, canWithdraw: false },
        message: 'Binance connection validated. Read & Trade enabled, no withdrawal permission.',
        balances,
      };
    } catch (err: unknown) {
      return {
        success: false,
        sandbox: false,
        pingMs: Date.now() - startPing,
        permissions: { canRead: false, canTrade: false, canWithdraw: false },
        message: `Connection timeout or network failure: ${err instanceof Error ? err.message : 'unknown'}`,
        balances: [],
      };
    }
  }

  // ============================== Order execution ==============================

  /**
   * Real order execution on Binance Spot/Testnet.
   * Quantities and prices are rounded to the symbol's actual filters, the order
   * is validated against MIN_NOTIONAL first, and the request carries recvWindow
   * plus a hard client timeout so it can never hang indefinitely.
   */
  async executeSpotOrder(
    userId: string,
    params: {
      symbol: string;
      side: 'BUY' | 'SELL';
      type: 'MARKET' | 'LIMIT';
      quantity: number;
      price?: number;
      clientOrderId: string;
    }
  ): Promise<{ success: boolean; orderId?: string; status?: string; error?: string; sentQuantity?: number }> {
    const creds = this.userCredentials.get(userId);
    if (!creds || !creds.apiKey || !creds.apiSecret) {
      return { success: false, error: 'No Binance API credentials configured' };
    }

    const filters = await this.getSymbolFilters(params.symbol);
    const quantity = this.roundQuantity(params.symbol, params.quantity, filters);
    const refPrice = params.price ?? (await this.getLatestPrice(params.symbol));

    if (quantity <= 0) {
      return { success: false, error: `Quantity rounds to 0 at step size ${filters.stepSize} for ${params.symbol}.` };
    }

    const validation = await this.validateOrder(params.symbol, quantity, refPrice);
    if (!validation.ok) {
      return { success: false, error: validation.error };
    }

    try {
      const baseUrl = this.getBaseUrl(creds.isTestnet);
      const timestamp = Date.now();

      const queryParams: Record<string, string> = {
        symbol: params.symbol,
        side: params.side,
        type: params.type,
        quantity: quantity.toFixed(filters.basePrecision),
        newClientOrderId: params.clientOrderId,
        timestamp: timestamp.toString(),
        recvWindow: '5000',
      };

      if (params.type === 'LIMIT' && params.price) {
        queryParams.price = this.roundPrice(params.symbol, params.price, filters).toFixed(filters.quotePrecision);
        queryParams.timeInForce = 'GTC';
      }

      const queryString = new URLSearchParams(queryParams).toString();
      const signature = this.signQuery(queryString, creds.apiSecret);

      const response = await fetch(`${baseUrl}/order?${queryString}&signature=${signature}`, {
        method: 'POST',
        headers: {
          'X-MBX-APIKEY': creds.apiKey,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        signal: AbortSignal.timeout(10000),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        return { success: false, error: data.msg || `Binance order rejected (${response.status})` };
      }

      return {
        success: true,
        orderId: data.orderId?.toString(),
        status: data.status,
        sentQuantity: quantity,
      };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : 'Network execution error' };
    }
  }
}

function decimalsOf(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 8;
  if (step >= 1) return 0;
  const s = step.toString();
  if (s.includes('e-')) return Number(s.split('e-')[1]);
  const dot = s.indexOf('.');
  return dot < 0 ? 0 : s.length - dot - 1;
}

export const binanceClient = new BinanceClient();
