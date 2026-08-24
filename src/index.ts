/**
 * ClipForge AI - Main Entry Point
 */

import { StrategyManager } from './strategies';
import { CandleGenerator } from './engine/backtester';

console.log(`
╔══════════════════════════════════════════════════════╗
║  🚀 ClipForge AI - Enhanced Trading Bot             ║
║  استراتيجيات كبار المتداولين مع نسبة ثقة            ║
╚══════════════════════════════════════════════════════╝
`);

const manager = new StrategyManager();

console.log('📋 الاستراتيجيات المتاحة:');
manager.listStrategies().forEach(s => {
  console.log(`   • ${s.id}: ${s.name}`);
});

console.log('\n🧪 اختبار سريع للإشارات...\n');

// Test scenarios
const scenarios = [
  { name: 'اختراق صاعد (Bullish Breakout)', gen: () => CandleGenerator.generateBullishBreakout() },
  { name: 'كسر هابط (Bearish Breakdown)', gen: () => CandleGenerator.generateBearishBreakdown() },
  { name: 'سوق جانبي (Sideways)', gen: () => CandleGenerator.generateMockCandles(300, 65000, 0.005, 'sideways') }
];

for (const scenario of scenarios) {
  console.log(`\n--- ${scenario.name} ---`);
  const candles = scenario.gen();
  const signal = manager.executeAll(candles, 'BTC/USDT', '15m');
  
  if (signal) {
    console.log(`📊 ${signal.symbol} | ${signal.action} | ثقة ${signal.confidence}% (${signal.confidence_level})`);
    console.log(`💰 دخول: ${signal.entryPrice} | ⏰ ${new Date(signal.entryTime).toLocaleString()}`);
    console.log(`⏱️ مدة: ${signal.suggestedDuration}`);
    console.log(`🛑 وقف: ${signal.stopLoss} | 🎯 هدف: ${signal.takeProfit} | R/R: ${signal.riskReward}`);
    console.log(`🧠 توافق: صاعد ${signal.confluence.bullish_points} vs هابط ${signal.confluence.bearish_points}`);
    console.log(`📝 أسباب: ${signal.reasons_ar.slice(0, 3).join(' | ')}`);
  } else {
    console.log('لا توجد إشارة');
  }
}

console.log(`\n✅ لتشغيل الـ API Dashboard:`);
console.log(`   npm run api`);
console.log(`   ثم افتح http://localhost:8080`);
console.log(`\n✅ لاختبار مفصل:`);
console.log(`   npm run test:strategies`);
