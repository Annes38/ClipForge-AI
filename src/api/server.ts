/**
 * ClipForge AI - Trading Signal API Server
 * سيرفر API للإشارات مع Dashboard
 */

import express from 'express';
import cors from 'cors';
import path from 'path';
import { StrategyManager } from '../strategies';
import { CandleGenerator } from '../engine/backtester';
import { Candle, Timeframe } from '../engine/types';

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 8080;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../../public')));

const strategyManager = new StrategyManager();

// Mock data store (في الإنتاج، جيب بيانات حقيقية من CCXT/Binance)
let mockCandles: Record<string, Candle[]> = {
  'BTC/USDT': CandleGenerator.generateBullishBreakout(),
  'ETH/USDT': CandleGenerator.generateMockCandles(300, 3500, 0.02, 'bullish'),
  'SOL/USDT': CandleGenerator.generateMockCandles(300, 150, 0.03, 'bullish'),
  'BNB/USDT': CandleGenerator.generateMockCandles(300, 600, 0.015, 'sideways')
};

// API Routes

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

  // ترتيب حسب الثقة
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
    version: '1.0.0',
    strategies: strategyManager.listStrategies().length,
    symbols: Object.keys(mockCandles)
  });
});

// Dashboard HTML fallback
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../../public/dashboard.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 ClipForge AI Trading Server running on http://0.0.0.0:${PORT}`);
  console.log(`📊 Dashboard: http://0.0.0.0:${PORT}/`);
  console.log(`🔌 API: http://0.0.0.0:${PORT}/api/signals/all`);
  console.log(`📋 Strategies: ${strategyManager.listStrategies().map(s => s.id).join(', ')}`);
});
