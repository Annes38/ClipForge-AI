/**
 * Momentum Breakout with Smart Money Confirmation
 * استراتيجية الزخم والاختراق مع تأكيد الأموال الذكية
 * 
 * هذه الاستراتيجية يستخدمها كبار المتداولين لصيد الانفجارات السعرية:
 * 1. تحديد نطاق ضيق (Bollinger Squeeze)
 * 2. انتظار كسر مع حجم عالي (Breakout + Volume)
 * 3. تأكيد بالزخم (RSI + MACD)
 * 4. تأكيد باتجاه قوي (ADX + Supertrend)
 * 
 * قاعدة: لا تدخل اختراق إلا مع حجم + إغلاق فوق المستوى
 */

import { Candle, TradingSignal, Timeframe } from '../engine/types';
import { SignalEngine } from '../engine/signalEngine';
import { TechnicalIndicators } from '../indicators/technical';

export class MomentumBreakoutSmartMoney {
  name = 'Momentum Breakout + Smart Money - Pro';
  description = `
  استراتيجية اختراق الزخم مع تأكيد الأموال الذكية:
  - البحث عن انضغاط Bollinger (Squeeze)
  - انتظار اختراق مع حجم عالي RVOL > 1.5
  - تأكيد RSI و MACD
  - فلتر ADX للتأكد من قوة الاتجاه
  - وقف خسارة ضيق وهدف كبير (Risk/Reward عالي)
  `;

  execute(candles: Candle[], symbol: string = 'BTC/USDT', timeframe: Timeframe = '15m'): TradingSignal | null {
    if (candles.length < 100) return null;

    const indicators = TechnicalIndicators.calculateAll(candles);
    if (!indicators) return null;

    const last = candles[candles.length - 1];
    const closes = candles.map(c => c.close);

    // 1. كشف الانضغاط السابق
    const bbHistory = TechnicalIndicators.calculateBB(closes, 20, 2);
    const recentBB = bbHistory.slice(-20);
    const avgWidth = recentBB.reduce((sum, b) => sum + (b.upper - b.lower) / b.middle, 0) / recentBB.length;
    const currentWidth = (indicators.bollinger.upper - indicators.bollinger.lower) / indicators.bollinger.middle;
    
    const wasSqueezed = recentBB.slice(-10, -1).some(b => ((b.upper - b.lower) / b.middle) < avgWidth * 0.8);
    const isBreakingOut = currentWidth > avgWidth * 1.1;

    // 2. كشف الاختراق
    const recentHigh = Math.max(...candles.slice(-20, -1).map(c => c.high));
    const recentLow = Math.min(...candles.slice(-20, -1).map(c => c.low));
    
    const breakoutUp = last.close > recentHigh && last.close > indicators.bollinger.upper;
    const breakoutDown = last.close < recentLow && last.close < indicators.bollinger.lower;

    // 3. تأكيد الحجم - الأموال الذكية
    const smartMoneyConfirm = indicators.volume.rvol > 1.5 && indicators.volume.confirming;

    let breakoutDetected = false;
    let breakoutDirection: 'bullish' | 'bearish' | null = null;
    let breakoutStrength = 0;

    if (breakoutUp && smartMoneyConfirm) {
      breakoutDetected = true;
      breakoutDirection = 'bullish';
      breakoutStrength = 70;
      
      if (wasSqueezed) breakoutStrength += 10;
      if (isBreakingOut) breakoutStrength += 5;
      if (indicators.rsi > 55 && indicators.rsi < 75) breakoutStrength += 10;
      if (indicators.macd.bullish) breakoutStrength += 5;
      if (indicators.adx > 25) breakoutStrength += 5;
    }

    if (breakoutDown && smartMoneyConfirm) {
      breakoutDetected = true;
      breakoutDirection = 'bearish';
      breakoutStrength = 70;
      
      if (wasSqueezed) breakoutStrength += 10;
      if (isBreakingOut) breakoutStrength += 5;
      if (indicators.rsi < 45 && indicators.rsi > 25) breakoutStrength += 10;
      if (!indicators.macd.bullish) breakoutStrength += 5;
      if (indicators.adx > 25) breakoutStrength += 5;
    }

    // إذا لا يوجد اختراق واضح، لا إشارة
    if (!breakoutDetected) {
      const base = SignalEngine.generateSignal(candles, symbol, timeframe, this.name);
      if (!base) return null;

      // فقط إذا Squeeze حالي - توقع انفجار
      if (indicators.bollinger.squeeze) {
        return {
          ...base,
          action: 'HOLD',
          confidence: 55,
          confidence_level: 'MEDIUM',
          reasons: [...base.reasons, 'Bollinger Squeeze - waiting for breakout with volume'],
          reasons_ar: [...base.reasons_ar, 'انضغاط Bollinger - ننتظر اختراق مع حجم'],
          suggestedDuration: 'قريباً - راقب الاختراق'
        };
      }

      return null;
    }

    const baseSignal = SignalEngine.generateSignal(candles, symbol, timeframe, this.name);
    if (!baseSignal) return null;

    let action: TradingSignal['action'] = 'HOLD';
    if (breakoutDirection === 'bullish') {
      action = breakoutStrength >= 85 ? 'STRONG_BUY' : 'BUY';
    } else {
      action = breakoutStrength >= 85 ? 'STRONG_SELL' : 'SELL';
    }

    const reasons: string[] = [];
    const reasons_ar: string[] = [];

    if (breakoutDirection === 'bullish') {
      reasons.push(`🚀 BREAKOUT UP above ${recentHigh.toFixed(2)} - Previous 20 high broken`);
      reasons_ar.push(`🚀 اختراق صاعد فوق ${recentHigh.toFixed(2)} - كسر قمة 20 فترة`);
    } else {
      reasons.push(`💥 BREAKDOWN below ${recentLow.toFixed(2)} - Previous 20 low broken`);
      reasons_ar.push(`💥 كسر هابط تحت ${recentLow.toFixed(2)} - كسر قاع 20 فترة`);
    }

    reasons.push(`Smart Money Volume RVOL ${indicators.volume.rvol.toFixed(2)}x - institutional participation`);
    reasons_ar.push(`حجم أموال ذكية RVOL ${indicators.volume.rvol.toFixed(2)}x - مشاركة مؤسساتية`);

    if (wasSqueezed) {
      reasons.push(`Prior Squeeze detected - high probability breakout`);
      reasons_ar.push(`انضغاط سابق مكتشف - اختراق عالي الاحتمال`);
    }

    reasons.push(`ADX ${indicators.adx.toFixed(1)} - ${indicators.adx_trend_strength} trend`);
    reasons_ar.push(`ADX ${indicators.adx.toFixed(1)} - اتجاه ${indicators.adx_trend_strength === 'strong' ? 'قوي' : indicators.adx_trend_strength === 'very_strong' ? 'قوي جداً' : 'متوسط'}`);

    // Risk/Reward أفضل للاختراقات
    const atr = indicators.atr;
    let stopLoss: number;
    let takeProfit: number;
    let takeProfit2: number;

    if (breakoutDirection === 'bullish') {
      stopLoss = last.close - atr * 1.2; // وقف ضيق
      takeProfit = last.close + atr * 3; // هدف كبير
      takeProfit2 = last.close + atr * 5;
    } else {
      stopLoss = last.close + atr * 1.2;
      takeProfit = last.close - atr * 3;
      takeProfit2 = last.close - atr * 5;
    }

    const risk = Math.abs(last.close - stopLoss);
    const reward = Math.abs(takeProfit - last.close);
    const riskReward = risk === 0 ? 0 : reward / risk;

    let confidence_level: TradingSignal['confidence_level'] = 'HIGH';
    if (breakoutStrength >= 90) confidence_level = 'EXTREME';
    else if (breakoutStrength >= 80) confidence_level = 'VERY_HIGH';
    else if (breakoutStrength >= 70) confidence_level = 'HIGH';

    return {
      ...baseSignal,
      action,
      confidence: Math.min(100, Math.round(breakoutStrength)),
      confidence_level,
      stopLoss: Number(stopLoss.toFixed(2)),
      takeProfit: Number(takeProfit.toFixed(2)),
      takeProfit2: Number(takeProfit2.toFixed(2)),
      riskReward: Number(riskReward.toFixed(2)),
      reasons: [...baseSignal.reasons, ...reasons],
      reasons_ar: [...baseSignal.reasons_ar, ...reasons_ar],
      strategy_used: this.name
    };
  }
}
