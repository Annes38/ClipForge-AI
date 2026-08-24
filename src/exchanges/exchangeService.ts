/**
 * ClipForge AI - Exchange Service
 * خدمة كل منصة - تجيب البيانات الحقيقية أو Mock
 */

import * as ccxt from 'ccxt';
import { Candle, Timeframe } from '../engine/types';
import { CandleGenerator } from '../engine/backtester';
import { EXCHANGES, ExchangeConfig, getExchangeById } from './config';

export class ExchangeService {
  private ccxtInstances: Map<string, any> = new Map();
  private mockCandlesCache: Map<string, Map<string, Candle[]>> = new Map();

  constructor() {
    // تهيئة CCXT لكل منصة
    for (const exchangeConfig of EXCHANGES) {
      try {
        const exchangeClass = (ccxt as any)[exchangeConfig.id];
        if (exchangeClass) {
          const instance = new exchangeClass({
            enableRateLimit: true,
            // بدون API keys للقراءة العامة
          });
          this.ccxtInstances.set(exchangeConfig.id, instance);
        }
      } catch (e) {
        console.log(`⚠️ CCXT not available for ${exchangeConfig.id}, using mock`);
      }

      // تهيئة Mock cache لكل منصة بأسلوب مختلف
      const symbolMap = new Map<string, Candle[]>();
      for (const symbol of exchangeConfig.supportedSymbols) {
        // كل منصة لها طابع مختلف في البيانات
        const volatility = this.getExchangeVolatility(exchangeConfig.id);
        const trend = this.getRandomTrend(exchangeConfig.id, symbol);
        const startPrice = this.getSymbolBasePrice(symbol);
        
        let candles: Candle[];
        if (Math.random() > 0.7) {
          // 30% احتمال اختراق
          candles = Math.random() > 0.5 
            ? CandleGenerator.generateBullishBreakout()
            : CandleGenerator.generateBearishBreakdown();
        } else {
          candles = CandleGenerator.generateMockCandles(300, startPrice, volatility, trend);
        }
        
        symbolMap.set(symbol, candles);
      }
      this.mockCandlesCache.set(exchangeConfig.id, symbolMap);
    }
  }

  private getExchangeVolatility(exchangeId: string): number {
    const volMap: Record<string, number> = {
      binance: 0.015,
      bybit: 0.02,
      okx: 0.018,
      coinbase: 0.012,
      kraken: 0.01,
      bitget: 0.025 // أكثر تقلباً (ميم كوينز)
    };
    return volMap[exchangeId] || 0.02;
  }

  private getRandomTrend(exchangeId: string, symbol: string): 'bullish' | 'bearish' | 'sideways' {
    // كل منصة لها ميل مختلف
    const rand = Math.random();
    if (symbol.includes('BTC') || symbol.includes('ETH')) {
      return rand > 0.4 ? 'bullish' : rand > 0.2 ? 'sideways' : 'bearish';
    }
    if (symbol.includes('PEPE') || symbol.includes('SHIB')) {
      return rand > 0.5 ? 'bullish' : 'bearish'; // ميم كوينز متقلبة
    }
    return rand > 0.33 ? 'bullish' : rand > 0.66 ? 'bearish' : 'sideways';
  }

  private getSymbolBasePrice(symbol: string): number {
    const priceMap: Record<string, number> = {
      'BTC/USDT': 65000,
      'ETH/USDT': 3500,
      'BNB/USDT': 600,
      'SOL/USDT': 150,
      'XRP/USDT': 0.6,
      'ADA/USDT': 0.45,
      'AVAX/USDT': 35,
      'MATIC/USDT': 0.8,
      'DOT/USDT': 7,
      'OKB/USDT': 55,
      'ARB/USDT': 1.1,
      'OP/USDT': 2.5,
      'LINK/USDT': 14,
      'UNI/USDT': 8,
      'XLM/USDT': 0.1,
      'BGB/USDT': 1.2,
      'PEPE/USDT': 0.000008,
      'SHIB/USDT': 0.00002
    };
    return priceMap[symbol] || 100;
  }

  /**
   * جلب الشموع - يحاول CCXT أولاً، ثم Mock
   */
  async fetchCandles(exchangeId: string, symbol: string, timeframe: Timeframe = '15m', limit: number = 300): Promise<Candle[]> {
    const exchangeConfig = getExchangeById(exchangeId);
    if (!exchangeConfig) throw new Error(`Exchange ${exchangeId} not found`);

    // حاول CCXT
    const ccxtInstance = this.ccxtInstances.get(exchangeId);
    if (ccxtInstance) {
      try {
        // CCXT يستخدم 1m, 5m, 15m, 1h, 4h, 1d
        const ohlcv = await ccxtInstance.fetchOHLCV(symbol, timeframe, undefined, limit);
        if (ohlcv && ohlcv.length > 50) {
          return ohlcv.map((c: any) => ({
            time: c[0],
            open: c[1],
            high: c[2],
            low: c[3],
            close: c[4],
            volume: c[5]
          }));
        }
      } catch (e: any) {
        console.log(`⚠️ CCXT fetch failed for ${exchangeId} ${symbol}: ${e.message}, using mock`);
      }
    }

    // Fallback Mock
    const exchangeCache = this.mockCandlesCache.get(exchangeId);
    if (exchangeCache) {
      const cached = exchangeCache.get(symbol);
      if (cached) {
        // حدث آخر شمعة بعشوائية صغيرة لمحاكاة السوق الحي
        const last = cached[cached.length - 1];
        const newPrice = last.close * (1 + (Math.random() - 0.5) * 0.002);
        const newCandle: Candle = {
          time: Date.now(),
          open: last.close,
          high: Math.max(last.close, newPrice) * 1.001,
          low: Math.min(last.close, newPrice) * 0.999,
          close: newPrice,
          volume: last.volume * (0.8 + Math.random() * 0.4)
        };
        
        const updated = [...cached.slice(1), newCandle];
        exchangeCache.set(symbol, updated);
        return updated;
      }
    }

    // أخيراً، ولّد جديد
    return CandleGenerator.generateMockCandles(limit, this.getSymbolBasePrice(symbol), this.getExchangeVolatility(exchangeId), 'bullish');
  }

  /**
   * جلب كل الشموع لمنصة
   */
  async fetchAllCandlesForExchange(exchangeId: string, timeframe: Timeframe = '15m'): Promise<Map<string, Candle[]>> {
    const config = getExchangeById(exchangeId);
    if (!config) throw new Error(`Exchange ${exchangeId} not found`);

    const result = new Map<string, Candle[]>();
    for (const symbol of config.supportedSymbols) {
      const candles = await this.fetchCandles(exchangeId, symbol, timeframe);
      result.set(symbol, candles);
    }
    return result;
  }

  getExchangeConfig(exchangeId: string): ExchangeConfig | undefined {
    return getExchangeById(exchangeId);
  }

  getAllExchanges(): ExchangeConfig[] {
    return EXCHANGES;
  }

  /**
   * إحصائيات المنصة
   */
  async getExchangeStats(exchangeId: string) {
    const config = getExchangeById(exchangeId);
    if (!config) return null;

    return {
      ...config,
      symbolsCount: config.supportedSymbols.length,
      lastUpdate: new Date().toISOString(),
      isRealData: this.ccxtInstances.has(exchangeId)
    };
  }
}

// Singleton
export const exchangeService = new ExchangeService();
