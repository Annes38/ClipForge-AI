/**
 * ClipForge AI - Backtester & Demo Data Generator
 * لاختبار الاستراتيجيات
 */

import { Candle, TradingSignal, Timeframe } from './types';
import { StrategyManager } from '../strategies';

export class CandleGenerator {
  /**
   * توليد شموع وهمية للاختبار - تحاكي حركة BTC الحقيقية
   */
  static generateMockCandles(count: number = 300, startPrice: number = 65000, volatility: number = 0.02, trend: 'bullish' | 'bearish' | 'sideways' = 'bullish'): Candle[] {
    const candles: Candle[] = [];
    let price = startPrice;
    let time = Date.now() - count * 15 * 60 * 1000; // 15m candles

    for (let i = 0; i < count; i++) {
      const trendFactor = trend === 'bullish' ? 0.001 : trend === 'bearish' ? -0.0015 : 0;
      const randomChange = (Math.random() - 0.5) * volatility + trendFactor;
      
      const open = price;
      const change = open * randomChange;
      const close = open + change;
      
      const high = Math.max(open, close) * (1 + Math.random() * volatility * 0.5);
      const low = Math.min(open, close) * (1 - Math.random() * volatility * 0.5);
      
      // حجم أكبر في الاتجاه
      const volumeBase = 100 + Math.random() * 100;
      const volumeTrend = trend !== 'sideways' && ((trend === 'bullish' && close > open) || (trend === 'bearish' && close < open)) 
        ? volumeBase * 1.5 
        : volumeBase;
      
      candles.push({
        time,
        open,
        high,
        low,
        close,
        volume: volumeTrend
      });

      price = close;
      time += 15 * 60 * 1000;
    }

    return candles;
  }

  static generateBullishBreakout(): Candle[] {
    const sideways = this.generateMockCandles(200, 65000, 0.005, 'sideways');
    const breakout = this.generateMockCandles(50, sideways[sideways.length - 1].close, 0.03, 'bullish');
    // زيادة حجم الاختراق
    breakout.forEach(c => c.volume *= 2.5);
    return [...sideways, ...breakout];
  }

  static generateBearishBreakdown(): Candle[] {
    const bullish = this.generateMockCandles(150, 65000, 0.01, 'bullish');
    const sideways = this.generateMockCandles(50, bullish[bullish.length - 1].close, 0.005, 'sideways');
    const combined = [...bullish, ...sideways];
    const breakdown = this.generateMockCandles(80, combined[combined.length - 1].close, 0.025, 'bearish');
    breakdown.forEach(c => c.volume *= 2.5);
    // Force strong down candles
    breakdown.forEach((c, i) => {
      if (i > 10) {
        c.close = c.open * (0.995 - Math.random() * 0.01);
        c.low = Math.min(c.open, c.close) * 0.998;
      }
    });
    return [...combined, ...breakdown];
  }
}

// Test runner
if (require.main === module) {
  console.log('🧪 ClipForge AI - Testing Pro Strategies\n');

  const manager = new StrategyManager();
  
  console.log('📋 Available Strategies:');
  manager.listStrategies().forEach(s => {
    console.log(`  - ${s.id}: ${s.name}`);
  });

  console.log('\n=== TEST 1: Bullish Breakout Scenario ===');
  const bullishCandles = CandleGenerator.generateBullishBreakout();
  const signal1 = manager.executeAll(bullishCandles, 'BTC/USDT', '15m');
  if (signal1) {
    console.log(`Action: ${signal1.action}`);
    console.log(`Confidence: ${signal1.confidence}% (${signal1.confidence_level})`);
    console.log(`Entry: ${signal1.entryPrice} at ${signal1.entryTime}`);
    console.log(`Duration: ${signal1.suggestedDuration}`);
    console.log(`Stop: ${signal1.stopLoss} | TP: ${signal1.takeProfit} | R/R: ${signal1.riskReward}`);
    console.log(`Strategy: ${signal1.strategy_used}`);
    console.log(`Reasons: ${signal1.reasons_ar.join(' | ')}`);
    console.log(`Confluence: Bull ${signal1.confluence.bullish_points} vs Bear ${signal1.confluence.bearish_points}`);
  }

  console.log('\n=== TEST 2: Bearish Breakdown Scenario ===');
  const bearishCandles = CandleGenerator.generateBearishBreakdown();
  const signal2 = manager.executeAll(bearishCandles, 'BTC/USDT', '15m');
  if (signal2) {
    console.log(`Action: ${signal2.action}`);
    console.log(`Confidence: ${signal2.confidence}% (${signal2.confidence_level})`);
    console.log(`Entry: ${signal2.entryPrice} at ${signal2.entryTime}`);
    console.log(`Duration: ${signal2.suggestedDuration}`);
    console.log(`Stop: ${signal2.stopLoss} | TP: ${signal2.takeProfit} | R/R: ${signal2.riskReward}`);
    console.log(`Strategy: ${signal2.strategy_used}`);
    console.log(`Reasons: ${signal2.reasons_ar.join(' | ')}`);
  }

  console.log('\n=== TEST 3: Sideways (No Trade) ===');
  const sidewaysCandles = CandleGenerator.generateMockCandles(300, 65000, 0.005, 'sideways');
  const signal3 = manager.executeAll(sidewaysCandles, 'BTC/USDT', '15m');
  if (signal3) {
    console.log(`Action: ${signal3.action}`);
    console.log(`Confidence: ${signal3.confidence}%`);
    console.log(`Reasons: ${signal3.reasons_ar.join(' | ')}`);
  }

  console.log('\n=== TEST 4: Individual Strategies Comparison ===');
  const testCandles = CandleGenerator.generateBullishBreakout();
  for (const stratId of ['pro_confluence', 'vwap_institutional', 'momentum_breakout'] as const) {
    const sig = manager.executeStrategy(stratId, testCandles, 'BTC/USDT', '15m');
    if (sig) {
      console.log(`${stratId}: ${sig.action} ${sig.confidence}% - ${sig.strategy_used}`);
    }
  }
}
