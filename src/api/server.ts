/**
 * ClipForge AI - Trading Signal API Server with 6 Exchanges
 * سيرفر API مع 6 منصات كل واحدة مشروع وحدو
 */

import express from 'express';
import cors from 'cors';
import path from 'path';
import { StrategyManager } from '../strategies';
import { CandleGenerator } from '../engine/backtester';
import { Candle, Timeframe } from '../engine/types';
import { exchangeService } from '../exchanges/exchangeService';
import { EXCHANGES } from '../exchanges/config';
import { LiveWebSocketServer } from './websocketServer';

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 8080;
const WS_PORT = process.env.WS_PORT ? parseInt(process.env.WS_PORT) : 8081;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../../public')));

const strategyManager = new StrategyManager();
const liveWsServer = new LiveWebSocketServer();

// Legacy mock for backward compat
let mockCandles: Record<string, Candle[]> = {
  'BTC/USDT': CandleGenerator.generateBullishBreakout(),
  'ETH/USDT': CandleGenerator.generateMockCandles(300, 3500, 0.02, 'bullish'),
  'SOL/USDT': CandleGenerator.generateMockCandles(300, 150, 0.03, 'bullish'),
  'BNB/USDT': CandleGenerator.generateMockCandles(300, 600, 0.015, 'sideways')
};

// ============ NEW EXCHANGE-BASED ROUTES ============

app.get('/api/exchanges', (req, res) => {
  const exchanges = exchangeService.getAllExchanges().map(ex => ({
    id: ex.id,
    name: ex.name,
    displayName: ex.displayName,
    logo: ex.logo,
    color: ex.color,
    bgGradient: ex.bgGradient,
    description: ex.description,
    description_ar: ex.description_ar,
    website: ex.website,
    fees: ex.fees,
    supportedSymbols: ex.supportedSymbols,
    symbolsCount: ex.supportedSymbols.length,
    status: ex.status,
    volume24h: ex.volume24h,
    trustScore: ex.trustScore,
    features: ex.features,
    features_ar: ex.features_ar
  }));

  res.json({
    success: true,
    count: exchanges.length,
    exchanges
  });
});

app.get('/api/exchanges/:exchangeId', async (req, res) => {
  const exchangeId = req.params.exchangeId;
  const config = exchangeService.getExchangeConfig(exchangeId);
  
  if (!config) {
    return res.status(404).json({ success: false, error: 'Exchange not found' });
  }

  const stats = await exchangeService.getExchangeStats(exchangeId);
  
  res.json({
    success: true,
    exchange: stats
  });
});

app.get('/api/exchanges/:exchangeId/signals', async (req, res) => {
  const exchangeId = req.params.exchangeId;
  const timeframe = (req.query.timeframe as Timeframe) || '15m';
  const strategy = (req.query.strategy as any) || 'all';

  const config = exchangeService.getExchangeConfig(exchangeId);
  if (!config) {
    return res.status(404).json({ success: false, error: 'Exchange not found' });
  }

  try {
    const allCandles = await exchangeService.fetchAllCandlesForExchange(exchangeId, timeframe);
    const signals: any[] = [];

    for (const [symbol, candles] of allCandles.entries()) {
      try {
        const signal = strategyManager.executeStrategy(strategy, candles, symbol, timeframe);
        if (signal) {
          signals.push({
            ...signal,
            exchangeId,
            exchangeName: config.name
          });
        }
      } catch (e) {
        console.error(`Error for ${exchangeId} ${symbol}`, e);
      }
    }

    signals.sort((a, b) => b.confidence - a.confidence);

    res.json({
      success: true,
      exchangeId,
      exchangeName: config.name,
      timeframe,
      strategy,
      count: signals.length,
      signals,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/exchanges/:exchangeId/signal/:symbol', async (req, res) => {
  const exchangeId = req.params.exchangeId;
  const symbol = req.params.symbol as string;
  const timeframe = (req.query.timeframe as Timeframe) || '15m';
  const strategy = (req.query.strategy as any) || 'all';

  const config = exchangeService.getExchangeConfig(exchangeId);
  if (!config) {
    return res.status(404).json({ success: false, error: 'Exchange not found' });
  }

  if (!config.supportedSymbols.includes(symbol)) {
    return res.status(400).json({ success: false, error: `Symbol ${symbol} not supported on ${exchangeId}` });
  }

  try {
    const candles = await exchangeService.fetchCandles(exchangeId, symbol, timeframe);
    const signal = strategyManager.executeStrategy(strategy, candles, symbol, timeframe);

    res.json({
      success: true,
      exchangeId,
      exchangeName: config.name,
      symbol,
      timeframe,
      strategy,
      signal,
      candleCount: candles.length,
      lastPrice: candles[candles.length - 1]?.close,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/exchanges/:exchangeId/candles/:symbol', async (req, res) => {
  const exchangeId = req.params.exchangeId;
  const symbol = req.params.symbol as string;
  const timeframe = (req.query.timeframe as Timeframe) || '15m';
  const limit = parseInt(req.query.limit as string) || 100;

  try {
    const candles = await exchangeService.fetchCandles(exchangeId, symbol, timeframe, limit);
    const stats = await exchangeService.getExchangeStats(exchangeId);
    res.json({
      success: true,
      exchangeId,
      symbol,
      timeframe,
      count: candles.length,
      candles: candles.slice(-limit),
      isRealData: (stats as any)?.isRealData || false,
      realDataInfo: (stats as any)?.realDataInfo || null
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/exchanges/:exchangeId/candles/:symbol', async (req, res) => {
  const exchangeId = req.params.exchangeId;
  const symbol = req.params.symbol as string;
  const { candles, source } = req.body;

  if (!Array.isArray(candles)) {
    return res.status(400).json({ success: false, error: 'candles must be array' });
  }

  try {
    exchangeService.injectRealCandles(exchangeId, symbol, candles, source || 'browser-real');
    res.json({
      success: true,
      message: `✅ Real data injected for ${exchangeId} ${symbol}: ${candles.length} candles from ${source}`,
      exchangeId,
      symbol,
      count: candles.length,
      source: source || 'browser-real',
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/real-data/status', (req, res) => {
  const status = exchangeService.getRealDataStatus();
  res.json({
    success: true,
    status,
    timestamp: new Date().toISOString(),
    message: 'Real data status for all exchanges'
  });
});

app.post('/api/real-data/refresh', async (req, res) => {
  // This endpoint is for manual refresh trigger
  // Real fetching happens in browser via realDataFetcher.js
  res.json({
    success: true,
    message: 'To refresh real data, the frontend will fetch from exchanges directly (browser has internet, server sandbox is blocked)',
    instructions: 'Open dashboard, it will auto-fetch real data from Binance, OKX, Kraken, Coinbase, Bitget via browser',
    workingExchanges: ['binance', 'okx', 'kraken', 'coinbase', 'bitget'],
    blockedExchanges: ['bybit (uses Binance proxy)'],
    timestamp: new Date().toISOString()
  });
});

// ============ LEGACY ROUTES (backward compat) ============

app.get('/api/strategies', (req, res) => {
  res.json({
    success: true,
    strategies: strategyManager.listStrategies()
  });
});

app.get('/api/signal/:symbol', (req, res) => {
  const symbol = req.params.symbol as string;
  const timeframe = (req.query.timeframe as Timeframe) || '15m';
  const strategy = (req.query.strategy as any) || 'all';

  const candles = mockCandles[symbol] || mockCandles['BTC/USDT'];
  
  if (!candles) {
    return res.status(404).json({ success: false, error: 'Symbol not found' });
  }

  try {
    const signal = strategyManager.executeStrategy(strategy, candles, symbol, timeframe);
    
    if (!signal) {
      return res.json({
        success: true,
        signal: null,
        message: 'Not enough data or no signal'
      });
    }

    res.json({
      success: true,
      signal,
      symbol,
      timeframe,
      candleCount: candles.length,
      lastPrice: candles[candles.length - 1].close
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/signals/all', (req, res) => {
  const timeframe = (req.query.timeframe as Timeframe) || '15m';
  const strategy = (req.query.strategy as any) || 'all';

  const allSignals: any[] = [];

  for (const [symbol, candles] of Object.entries(mockCandles)) {
    try {
      const signal = strategyManager.executeStrategy(strategy, candles, symbol, timeframe);
      if (signal) {
        allSignals.push(signal);
      }
    } catch (e) {
      console.error(`Error for ${symbol}`, e);
    }
  }

  allSignals.sort((a, b) => b.confidence - a.confidence);

  res.json({
    success: true,
    count: allSignals.length,
    signals: allSignals,
    timestamp: new Date().toISOString()
  });
});

app.get('/api/candles/:symbol', (req, res) => {
  const symbol = req.params.symbol as string;
  const limit = parseInt(req.query.limit as string) || 100;
  
  const candles = mockCandles[symbol];
  if (!candles) {
    return res.status(404).json({ success: false, error: 'Symbol not found' });
  }

  res.json({
    success: true,
    symbol,
    count: Math.min(limit, candles.length),
    candles: candles.slice(-limit)
  });
});

app.post('/api/candles/:symbol', (req, res) => {
  const symbol = req.params.symbol as string;
  const { candles } = req.body;

  if (!Array.isArray(candles)) {
    return res.status(400).json({ success: false, error: 'candles must be array' });
  }

  mockCandles[symbol] = candles;
  res.json({ success: true, message: `Updated ${symbol} with ${candles.length} candles` });
});

app.get('/api/health', (req, res) => {
  res.json({ 
    success: true, 
    status: 'running',
    version: '2.0.0 - Multi Exchange',
    strategies: strategyManager.listStrategies().length,
    exchanges: EXCHANGES.length,
    symbols: Object.keys(mockCandles),
    exchangesList: EXCHANGES.map(e => e.id)
  });
});

// Dashboard HTML fallback
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../../public/index.html'));
});

app.get('/exchange/:id', (req, res) => {
  res.sendFile(path.join(__dirname, '../../public/exchange.html'));
});

// Old dashboard
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, '../../public/dashboard.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 ClipForge AI Trading Server v2 - Multi Exchange running on http://0.0.0.0:${PORT}`);
  console.log(`📊 Main Dashboard: http://0.0.0.0:${PORT}/`);
  console.log(`🏦 Exchanges: ${EXCHANGES.map(e => e.name).join(', ')}`);
  console.log(`🔌 API: http://0.0.0.0:${PORT}/api/exchanges`);
  console.log(`📋 Strategies: ${strategyManager.listStrategies().map(s => s.id).join(', ')}`);
  
  // Start WebSocket Live Server
  try {
    liveWsServer.start(WS_PORT);
    console.log(`🌐 WebSocket Live: ws://0.0.0.0:${WS_PORT} - Broadcasting every second`);
  } catch (e: any) {
    console.error(`Failed to start WS server: ${e.message}`);
  }
});
