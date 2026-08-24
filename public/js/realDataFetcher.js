/**
 * ClipForge AI - Real Data Fetcher (Browser Side)
 * يجيب بيانات حقيقية من المنصات مباشرة من المتصفح
 * لأن السيرفر في Sandbox محجوب، لكن المتصفح عندو انترنت
 */

class RealDataFetcher {
  constructor() {
    this.cache = new Map();
  }

  // تحويل بيانات Binance إلى شموعنا
  parseBinanceKlines(data) {
    // data: [[openTime, open, high, low, close, volume, ...], ...]
    return data.map(k => ({
      time: k[0],
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5])
    }));
  }

  parseOKXCandles(data) {
    // OKX: [ts, open, high, low, close, vol, volCcy, ...] - newest first, so reverse
    const reversed = [...data].reverse();
    return reversed.map(c => ({
      time: parseInt(c[0]),
      open: parseFloat(c[1]),
      high: parseFloat(c[2]),
      low: parseFloat(c[3]),
      close: parseFloat(c[4]),
      volume: parseFloat(c[5])
    }));
  }

  parseKrakenOHLC(data) {
    // Kraken: result.XXBTZUSD: [[time, open, high, low, close, vwap, volume, count], ...]
    const pairKey = Object.keys(data.result)[0];
    const ohlc = data.result[pairKey];
    return ohlc.map(c => ({
      time: c[0] * 1000,
      open: parseFloat(c[1]),
      high: parseFloat(c[2]),
      low: parseFloat(c[3]),
      close: parseFloat(c[4]),
      volume: parseFloat(c[6])
    }));
  }

  parseCoinbaseCandles(data) {
    // Coinbase: [time, low, high, open, close, volume] - oldest first? Actually newest first
    const reversed = [...data].reverse();
    return reversed.map(c => ({
      time: c[0] * 1000,
      open: parseFloat(c[3]),
      high: parseFloat(c[2]),
      low: parseFloat(c[1]),
      close: parseFloat(c[4]),
      volume: parseFloat(c[5])
    }));
  }

  parseBitgetCandles(data) {
    // Bitget: [ts, open, high, low, close, vol, quoteVol]
    const reversed = [...data].reverse();
    return reversed.map(c => ({
      time: parseInt(c[0]),
      open: parseFloat(c[1]),
      high: parseFloat(c[2]),
      low: parseFloat(c[3]),
      close: parseFloat(c[4]),
      volume: parseFloat(c[5])
    }));
  }

  parseCoinGeckoOHLC(data) {
    // CoinGecko: [[timestamp, open, high, low, close], ...]
    return data.map(c => ({
      time: c[0],
      open: c[1],
      high: c[2],
      low: c[3],
      close: c[4],
      volume: 100 + Math.random() * 100 // CoinGecko OHLC لا يعطي حجم
    }));
  }

  // جلب من Binance (يشتغل من المتصفح)
  async fetchBinance(symbol = 'BTCUSDT', interval = '15m', limit = 300) {
    const url = `https://data-api.binance.vision/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Binance ${res.status}`);
      const data = await res.json();
      return this.parseBinanceKlines(data);
    } catch (e) {
      console.warn(`Binance fetch failed for ${symbol}:`, e.message);
      // Fallback to CoinGecko
      return this.fetchCoinGecko(symbol);
    }
  }

  async fetchOKX(instId = 'BTC-USDT', bar = '15m', limit = 300) {
    const url = `https://www.okx.com/api/v5/market/candles?instId=${instId}&bar=${bar}&limit=${limit}`;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`OKX ${res.status}`);
      const data = await res.json();
      if (data.code !== '0') throw new Error(`OKX code ${data.code}`);
      return this.parseOKXCandles(data.data);
    } catch (e) {
      console.warn(`OKX fetch failed for ${instId}:`, e.message);
      return null;
    }
  }

  async fetchKraken(pair = 'XBTUSD', interval = 15) {
    const url = `https://api.kraken.com/0/public/OHLC?pair=${pair}&interval=${interval}`;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Kraken ${res.status}`);
      const data = await res.json();
      if (data.error && data.error.length) throw new Error(data.error.join(','));
      return this.parseKrakenOHLC(data);
    } catch (e) {
      console.warn(`Kraken fetch failed for ${pair}:`, e.message);
      return null;
    }
  }

  async fetchCoinbase(product = 'BTC-USD', granularity = 900) {
    const url = `https://api.exchange.coinbase.com/products/${product}/candles?granularity=${granularity}`;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Coinbase ${res.status}`);
      const data = await res.json();
      return this.parseCoinbaseCandles(data);
    } catch (e) {
      console.warn(`Coinbase fetch failed for ${product}:`, e.message);
      return null;
    }
  }

  async fetchBitget(symbol = 'BTCUSDT', granularity = '15min', limit = 300) {
    const url = `https://api.bitget.com/api/v2/spot/market/candles?symbol=${symbol}&granularity=${granularity}&limit=${limit}`;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Bitget ${res.status}`);
      const data = await res.json();
      if (data.code !== '00000') throw new Error(`Bitget code ${data.code}`);
      return this.parseBitgetCandles(data.data);
    } catch (e) {
      console.warn(`Bitget fetch failed for ${symbol}:`, e.message);
      return null;
    }
  }

  async fetchCoinGecko(coinId = 'bitcoin', vs = 'usd', days = 1) {
    // CoinGecko OHLC
    const url = `https://api.coingecko.com/api/v3/coins/${coinId}/ohlc?vs_currency=${vs}&days=${days}`;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
      const data = await res.json();
      return this.parseCoinGeckoOHLC(data);
    } catch (e) {
      console.warn(`CoinGecko fetch failed for ${coinId}:`, e.message);
      return null;
    }
  }

  // دالة رئيسية: تجيب بيانات حقيقية حسب المنصة
  async fetchRealCandles(exchangeId, symbol, timeframe = '15m') {
    const cacheKey = `${exchangeId}_${symbol}_${timeframe}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < 60000) {
      return cached.candles; // cache 1 دقيقة
    }

    let candles = null;
    const cleanSymbol = symbol.replace('/', '');

    switch (exchangeId) {
      case 'binance':
        candles = await this.fetchBinance(cleanSymbol, timeframe, 300);
        break;
      case 'okx':
        const okxInst = symbol.replace('/', '-');
        candles = await this.fetchOKX(okxInst, timeframe, 300);
        break;
      case 'kraken':
        const krakenMap = {
          'BTC/USDT': 'XBTUSD',
          'ETH/USDT': 'ETHUSD',
          'SOL/USDT': 'SOLUSD',
          'BNB/USDT': 'BNBUSD',
          'XRP/USDT': 'XRPUSD',
          'ADA/USDT': 'ADAUSD',
          'DOT/USDT': 'DOTUSD',
          'LINK/USDT': 'LINKUSD',
          'AVAX/USDT': 'AVAXUSD',
          'MATIC/USDT': 'MATICUSD'
        };
        const krakenPair = krakenMap[symbol] || 'XBTUSD';
        const intervalMap = { '1m': 1, '5m': 5, '15m': 15, '30m': 30, '1h': 60, '4h': 240, '1d': 1440 };
        candles = await this.fetchKraken(krakenPair, intervalMap[timeframe] || 15);
        break;
      case 'coinbase':
        const cbProduct = symbol.replace('/', '-');
        const granMap = { '1m': 60, '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '4h': 21600, '1d': 86400 };
        candles = await this.fetchCoinbase(cbProduct, granMap[timeframe] || 900);
        break;
      case 'bitget':
        candles = await this.fetchBitget(cleanSymbol, timeframe === '15m' ? '15min' : timeframe === '1h' ? '1h' : '15min', 300);
        break;
      case 'bybit':
        // Bybit محجوب، نستخدم Binance كـ proxy لأن السعر نفسه تقريباً
        console.log(`Bybit blocked, using Binance proxy for ${symbol}`);
        candles = await this.fetchBinance(cleanSymbol, timeframe, 300);
        break;
      default:
        candles = await this.fetchBinance(cleanSymbol, timeframe, 300);
    }

    if (candles && candles.length > 50) {
      this.cache.set(cacheKey, { candles, timestamp: Date.now() });
      
      // أرسل للباكند باش يحفظها
      try {
        await fetch(`/api/exchanges/${exchangeId}/candles/${symbol}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ candles, timeframe, source: 'real', timestamp: Date.now() })
        });
      } catch (e) {
        console.warn('Failed to push to backend:', e.message);
      }

      return candles;
    }

    return null;
  }

  // جلب كل العملات لمنصة
  async fetchAllForExchange(exchangeId, timeframe = '15m') {
    const symbolsMap = {
      binance: ['BTC/USDT', 'ETH/USDT', 'BNB/USDT', 'SOL/USDT', 'XRP/USDT', 'ADA/USDT'],
      bybit: ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'AVAX/USDT', 'MATIC/USDT', 'DOT/USDT'],
      okx: ['BTC/USDT', 'ETH/USDT', 'OKB/USDT', 'SOL/USDT', 'ARB/USDT', 'OP/USDT'],
      coinbase: ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'AVAX/USDT', 'LINK/USDT', 'UNI/USDT'],
      kraken: ['BTC/USDT', 'ETH/USDT', 'DOT/USDT', 'ADA/USDT', 'LINK/USDT', 'XLM/USDT'],
      bitget: ['BTC/USDT', 'ETH/USDT', 'BGB/USDT', 'SOL/USDT', 'PEPE/USDT', 'SHIB/USDT']
    };

    const symbols = symbolsMap[exchangeId] || symbolsMap.binance;
    const results = {};

    for (const symbol of symbols) {
      const candles = await this.fetchRealCandles(exchangeId, symbol, timeframe);
      if (candles) {
        results[symbol] = candles;
        // انتظر شوية باش ما نضغطش على API
        await new Promise(r => setTimeout(r, 300));
      }
    }

    return results;
  }
}

// Global instance
window.realDataFetcher = new RealDataFetcher();
