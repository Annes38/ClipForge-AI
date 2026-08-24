/**
 * Institutional VWAP Strategy
 * استراتيجية VWAP المؤسساتية - يستخدمها كبار متداولي وول ستريت
 * 
 * VWAP = Volume Weighted Average Price
 * هو متوسط السعر المرجح بالحجم - المؤسسات الكبيرة تستخدمه كمعيار
 * 
 * القاعدة:
 * - فوق VWAP = سيطرة المشترين = نبحث عن شراء
 * - تحت VWAP = سيطرة البائعين = نبحث عن بيع
 * - الارتداد من VWAP مع تأكيد = إشارة قوية جداً
 */

import { Candle, TradingSignal, Timeframe } from '../engine/types';
import { SignalEngine } from '../engine/signalEngine';
import { TechnicalIndicators } from '../indicators/technical';

export class InstitutionalVWAPStrategy {
  name = 'Institutional VWAP Bounce - Wall Street Style';
  description = `
  استراتيجية VWAP الاحترافية:
  - VWAP هو خط المؤسسات - 9/10 تقييم كأفضل مؤشر يومي
  - السعر فوق VWAP = المشترون يربحون = اتجاه صاعد
  - السعر تحت VWAP = البائعون يربحون = اتجاه هابط
  - أفضل إشارة: ارتداد من VWAP مع RSI و EMA تأكيد
  `;

  config = {
    vwapDistanceThreshold: 0.3, // % distance for bounce
    rsiBounceLevel: 45, // RSI level for bounce entry
    emaTrendFilter: true
  };

  execute(candles: Candle[], symbol: string = 'BTC/USDT', timeframe: Timeframe = '15m'): TradingSignal | null {
    if (candles.length < 50) return null;

    const indicators = TechnicalIndicators.calculateAll(candles);
    if (!indicators) return null;

    const last = candles[candles.length - 1];
    const prev = candles[candles.length - 2];
    const prev2 = candles[candles.length - 3];

    // حساب VWAP bands (مثل Bollinger لكن لـ VWAP)
    const vwapValues = TechnicalIndicators.calculateVWAP(candles.slice(-20));
    const vwap = vwapValues[vwapValues.length - 1];
    
    // تحليل الارتداد
    const distance = ((last.close - vwap) / vwap) * 100;
    const prevDistance = ((prev.close - vwap) / vwap) * 100;

    let isVWAPBounceBuy = false;
    let isVWAPBounceSell = false;
    let bounceStrength = 0;

    // ارتداد شرائي: السعر كان تحت أو قريب من VWAP ثم ارتد فوق مع شمعة صاعدة
    if (prevDistance <= 0.5 && distance > 0 && last.close > last.open && last.close > prev.close) {
      if (indicators.rsi > 40 && indicators.rsi < 65) {
        isVWAPBounceBuy = true;
        bounceStrength = Math.min(100, 60 + Math.abs(distance) * 20 + (indicators.rsi - 40));
      }
    }

    // ارتداد بيعي: السعر كان فوق أو قريب من VWAP ثم ارتد تحت مع شمعة هابطة
    if (prevDistance >= -0.5 && distance < 0 && last.close < last.open && last.close < prev.close) {
      if (indicators.rsi < 60 && indicators.rsi > 35) {
        isVWAPBounceSell = true;
        bounceStrength = Math.min(100, 60 + Math.abs(distance) * 20 + (60 - indicators.rsi));
      }
    }

    // رفض VWAP (Rejection) - إشارة أقوى
    const isVWAPRejectionBuy = prev.low <= vwap && last.close > vwap && last.close > last.open && indicators.volume.rvol > 1.2;
    const isVWAPRejectionSell = prev.high >= vwap && last.close < vwap && last.close < last.open && indicators.volume.rvol > 1.2;

    if (isVWAPRejectionBuy) {
      isVWAPBounceBuy = true;
      bounceStrength = Math.min(100, bounceStrength + 15);
    }
    if (isVWAPRejectionSell) {
      isVWAPBounceSell = true;
      bounceStrength = Math.min(100, bounceStrength + 15);
    }

    // إذا لا يوجد ارتداد، استخدم المحرك العام لكن مع تركيز VWAP
    if (!isVWAPBounceBuy && !isVWAPBounceSell) {
      // لا إشارة VWAP واضحة - نرجع HOLD
      const baseSignal = SignalEngine.generateSignal(candles, symbol, timeframe, this.name);
      if (!baseSignal) return null;

      // فقط إذا كان هناك توافق قوي مع VWAP
      if (Math.abs(distance) < 0.1) {
        // السعر قريب جداً من VWAP - منطقة خطر، لا دخول
        return {
          ...baseSignal,
          action: 'HOLD',
          confidence: 45,
          confidence_level: 'LOW',
          reasons: [...baseSignal.reasons, 'Price too close to VWAP - chop zone'],
          reasons_ar: [...baseSignal.reasons_ar, 'السعر قريب جداً من VWAP - منطقة تذبذب خطيرة']
        };
      }

      return baseSignal;
    }

    // بناء إشارة VWAP
    const baseSignal = SignalEngine.generateSignal(candles, symbol, timeframe, this.name);
    if (!baseSignal) return null;

    let action = baseSignal.action;
    let confidence = Math.round(bounceStrength);

    if (isVWAPBounceBuy) {
      action = confidence >= 75 ? 'STRONG_BUY' : 'BUY';
    } else if (isVWAPBounceSell) {
      action = confidence >= 75 ? 'STRONG_SELL' : 'SELL';
    }

    // تعزيز الثقة إذا EMA متوافقة
    if (this.config.emaTrendFilter) {
      if (isVWAPBounceBuy && indicators.ema9 > indicators.ema21 && indicators.ema21 > indicators.ema50) {
        confidence = Math.min(100, confidence + 10);
      }
      if (isVWAPBounceSell && indicators.ema9 < indicators.ema21 && indicators.ema21 < indicators.ema50) {
        confidence = Math.min(100, confidence + 10);
      }
    }

    const reasons: string[] = [];
    const reasons_ar: string[] = [];

    if (isVWAPBounceBuy) {
      reasons.push(`VWAP Bounce BUY - Price reclaimed VWAP at ${vwap.toFixed(2)} with ${distance.toFixed(2)}% distance`);
      reasons_ar.push(`ارتداد VWAP شرائي - السعر استعاد VWAP عند ${vwap.toFixed(2)} بمسافة ${distance.toFixed(2)}%`);
      
      if (isVWAPRejectionBuy) {
        reasons.push(`VWAP Rejection confirmed with volume RVOL ${indicators.volume.rvol.toFixed(2)}x`);
        reasons_ar.push(`رفض VWAP مؤكد بحجم ${indicators.volume.rvol.toFixed(2)}x`);
      }
    }

    if (isVWAPBounceSell) {
      reasons.push(`VWAP Bounce SELL - Price rejected at VWAP ${vwap.toFixed(2)} with ${distance.toFixed(2)}% distance`);
      reasons_ar.push(`ارتداد VWAP بيعي - السعر رُفض عند VWAP ${vwap.toFixed(2)} بمسافة ${distance.toFixed(2)}%`);
      
      if (isVWAPRejectionSell) {
        reasons.push(`VWAP Rejection confirmed with volume RVOL ${indicators.volume.rvol.toFixed(2)}x`);
        reasons_ar.push(`رفض VWAP مؤكد بحجم ${indicators.volume.rvol.toFixed(2)}x`);
      }
    }

    reasons.push(`RSI ${indicators.rsi.toFixed(1)} - ${indicators.rsi_trend}`);
    reasons_ar.push(`RSI ${indicators.rsi.toFixed(1)} - ${indicators.rsi_trend === 'bullish' ? 'صاعد' : indicators.rsi_trend === 'bearish' ? 'هابط' : 'حيادي'}`);

    let confidence_level: TradingSignal['confidence_level'] = 'MEDIUM';
    if (confidence >= 90) confidence_level = 'EXTREME';
    else if (confidence >= 80) confidence_level = 'VERY_HIGH';
    else if (confidence >= 70) confidence_level = 'HIGH';
    else if (confidence >= 60) confidence_level = 'MEDIUM';
    else confidence_level = 'LOW';

    return {
      ...baseSignal,
      action: action as any,
      confidence,
      confidence_level,
      reasons: [...baseSignal.reasons, ...reasons],
      reasons_ar: [...baseSignal.reasons_ar, ...reasons_ar],
      strategy_used: this.name
    };
  }
}
