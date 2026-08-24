/**
 * ClipForge AI - Strategies Index
 * فهرس الاستراتيجيات الاحترافية
 */

export { ProConfluenceStrategy } from './pro_confluence_strategy';
export { InstitutionalVWAPStrategy } from './institutional_vwap_strategy';
export { MomentumBreakoutSmartMoney } from './momentum_breakout_smart_money';

import { Candle, TradingSignal, Timeframe } from '../engine/types';
import { ProConfluenceStrategy } from './pro_confluence_strategy';
import { InstitutionalVWAPStrategy } from './institutional_vwap_strategy';
import { MomentumBreakoutSmartMoney } from './momentum_breakout_smart_money';

export type StrategyName = 'pro_confluence' | 'vwap_institutional' | 'momentum_breakout' | 'all';

export class StrategyManager {
  private strategies: Record<string, any> = {
    pro_confluence: new ProConfluenceStrategy(),
    vwap_institutional: new InstitutionalVWAPStrategy(),
    momentum_breakout: new MomentumBreakoutSmartMoney()
  };

  /**
   * تنفيذ استراتيجية واحدة
   */
  executeStrategy(
    strategyName: StrategyName,
    candles: Candle[],
    symbol: string = 'BTC/USDT',
    timeframe: Timeframe = '15m'
  ): TradingSignal | null {
    if (strategyName === 'all') {
      return this.executeAll(candles, symbol, timeframe);
    }

    const strategy = this.strategies[strategyName];
    if (!strategy) return null;

    return strategy.execute(candles, symbol, timeframe);
  }

  /**
   * تنفيذ كل الاستراتيجيات وإعطاء أفضل إشارة (توافق الاستراتيجيات)
   * هذا هو الأقوى - إذا 2 أو 3 استراتيجيات متفقة = ثقة عالية جداً
   */
  executeAll(candles: Candle[], symbol: string = 'BTC/USDT', timeframe: Timeframe = '15m'): TradingSignal | null {
    const signals: TradingSignal[] = [];

    for (const [name, strategy] of Object.entries(this.strategies)) {
      try {
        const signal = strategy.execute(candles, symbol, timeframe);
        if (signal && signal.action !== 'HOLD') {
          signals.push(signal);
        }
      } catch (e) {
        console.error(`Error in strategy ${name}:`, e);
      }
    }

    if (signals.length === 0) {
      // لا يوجد توافق - نرجع إشارة Pro Confluence كـ HOLD
      const pro = this.strategies['pro_confluence'];
      return pro.execute(candles, symbol, timeframe);
    }

    if (signals.length === 1) {
      return signals[0];
    }

    // إذا عدة إشارات - نحسب التوافق
    const buySignals = signals.filter(s => s.action.includes('BUY'));
    const sellSignals = signals.filter(s => s.action.includes('SELL'));

    if (buySignals.length > sellSignals.length && buySignals.length >= 2) {
      // توافق شرائي
      const avgConfidence = buySignals.reduce((sum, s) => sum + s.confidence, 0) / buySignals.length;
      const boostedConfidence = Math.min(100, avgConfidence + (buySignals.length - 1) * 8); // +8% لكل استراتيجية متفقة

      const best = buySignals.reduce((prev, curr) => curr.confidence > prev.confidence ? curr : prev);

      return {
        ...best,
        confidence: Math.round(boostedConfidence),
        confidence_level: boostedConfidence >= 90 ? 'EXTREME' : boostedConfidence >= 80 ? 'VERY_HIGH' : 'HIGH',
        action: boostedConfidence >= 85 ? 'STRONG_BUY' : 'BUY',
        reasons: [
          `🔥 CONFLUENCE OF ${buySignals.length} STRATEGIES - Very High Probability`,
          ...buySignals.flatMap(s => s.reasons.slice(0, 2))
        ],
        reasons_ar: [
          `🔥 توافق ${buySignals.length} استراتيجيات - احتمال عالي جداً`,
          ...buySignals.flatMap(s => s.reasons_ar.slice(0, 2))
        ],
        strategy_used: `Confluence of ${buySignals.map(s => s.strategy_used).join(' + ')}`
      };
    }

    if (sellSignals.length > buySignals.length && sellSignals.length >= 2) {
      const avgConfidence = sellSignals.reduce((sum, s) => sum + s.confidence, 0) / sellSignals.length;
      const boostedConfidence = Math.min(100, avgConfidence + (sellSignals.length - 1) * 8);

      const best = sellSignals.reduce((prev, curr) => curr.confidence > prev.confidence ? curr : prev);

      return {
        ...best,
        confidence: Math.round(boostedConfidence),
        confidence_level: boostedConfidence >= 90 ? 'EXTREME' : boostedConfidence >= 80 ? 'VERY_HIGH' : 'HIGH',
        action: boostedConfidence >= 85 ? 'STRONG_SELL' : 'SELL',
        reasons: [
          `🔥 CONFLUENCE OF ${sellSignals.length} STRATEGIES - Very High Probability`,
          ...sellSignals.flatMap(s => s.reasons.slice(0, 2))
        ],
        reasons_ar: [
          `🔥 توافق ${sellSignals.length} استراتيجيات - احتمال عالي جداً`,
          ...sellSignals.flatMap(s => s.reasons_ar.slice(0, 2))
        ],
        strategy_used: `Confluence of ${sellSignals.map(s => s.strategy_used).join(' + ')}`
      };
    }

    // إشارات متضاربة - نرجع الأقوى
    const strongest = signals.reduce((prev, curr) => curr.confidence > prev.confidence ? curr : prev);
    return {
      ...strongest,
      reasons: [...strongest.reasons, `⚠️ Conflicting signals - ${signals.length} strategies disagree, showing strongest`],
      reasons_ar: [...strongest.reasons_ar, `⚠️ إشارات متضاربة - ${signals.length} استراتيجيات مختلفة، نعرض الأقوى`]
    };
  }

  listStrategies() {
    return Object.keys(this.strategies).map(key => ({
      id: key,
      name: this.strategies[key].name,
      description: this.strategies[key].description
    }));
  }
}
