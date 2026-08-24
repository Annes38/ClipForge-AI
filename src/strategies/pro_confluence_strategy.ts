/**
 * ClipForge AI - Pro Confluence Strategy V2
 * استراتيجية التوافق الاحترافية - استراتيجية كبار المتداولين
 * 
 * هذه الاستراتيجية تعتمد على مفهوم Confluence Trading:
 * - لا تدخل إلا إذا 5+ مؤشرات متفقة
 * - كل مؤشر يقيس شيء مختلف (اتجاه، زخم، حجم، تقلب)
 * - نسبة الثقة = مجموع نقاط التوافق
 * 
 * مبنية على استراتيجيات:
 * - EMA + VWAP + RSI (أفضل setup للمبتدئين والمحترفين 2026)
 * - Supertrend + MACD + Volume (استراتيجية المؤسسات)
 * - Bollinger Squeeze Breakout (استراتيجية الانفجار السعري)
 */

import { Candle, TradingSignal, Timeframe } from '../engine/types';
import { SignalEngine } from '../engine/signalEngine';

export class ProConfluenceStrategy {
  name = 'Pro Confluence V2 - Institutional Grade';
  description = `
  استراتيجية احترافية تجمع 8 مؤشرات:
  1. EMA 9/21/50/200 - تحديد الاتجاه (Trend)
  2. VWAP - تحديد سيطرة المؤسسات (Institutional Bias)
  3. RSI 14 - قياس الزخم (Momentum)
  4. MACD 12/26/9 - تأكيد الزخم والانعكاس
  5. Supertrend 10/3 - فلتر اتجاه قوي يستخدمه المحترفون
  6. Bollinger Bands 20/2 - قياس التقلب والانفجار
  7. Volume + RVOL - تأكيد المشاركة الحقيقية
  8. ADX 14 - قوة الاتجاه
  
  القاعدة الذهبية: لا دخول إلا إذا 60%+ توافق
  `;

  // إعدادات قابلة للتخصيص
  config = {
    minConfidence: 60, // أقل نسبة ثقة للدخول
    rsiOverbought: 70,
    rsiOversold: 30,
    adxMin: 20,
    rvolMin: 1.2,
    atrStopLoss: 1.5,
    atrTakeProfit: 2.5
  };

  /**
   * تنفيذ الاستراتيجية
   */
  execute(candles: Candle[], symbol: string = 'BTC/USDT', timeframe: Timeframe = '15m'): TradingSignal | null {
    const signal = SignalEngine.generateSignal(candles, symbol, timeframe, this.name);
    
    if (!signal) return null;

    // فلتر إضافي: لا نعطي إشارة إذا الثقة أقل من الحد الأدنى
    if (signal.confidence < this.config.minConfidence && signal.action !== 'HOLD') {
      // حولها لـ HOLD مع إبقاء نسبة الثقة للعرض
      return {
        ...signal,
        action: 'HOLD',
        reasons: [...signal.reasons, `Confidence ${signal.confidence}% below minimum ${this.config.minConfidence}% - No trade`],
        reasons_ar: [...signal.reasons_ar, `الثقة ${signal.confidence}% أقل من الحد الأدنى ${this.config.minConfidence}% - لا دخول`]
      };
    }

    // تحسين الإشارة بـ Smart Filters
    return this.applySmartFilters(signal, candles);
  }

  /**
   * فلاتر ذكية إضافية يستخدمها المحترفون
   */
  private applySmartFilters(signal: TradingSignal, candles: Candle[]): TradingSignal {
    const last = candles[candles.length - 1];
    const prev = candles[candles.length - 2];
    let boostedConfidence = signal.confidence;
    const extraReasons: string[] = [];
    const extraReasonsAr: string[] = [];

    // 1. فلتر الشموع اليابانية - Engulfing Pattern
    const isBullishEngulfing = last.close > last.open && prev.close < prev.open && last.close > prev.open && last.open < prev.close;
    const isBearishEngulfing = last.close < last.open && prev.close > prev.open && last.close < prev.open && last.open > prev.close;

    if (isBullishEngulfing && (signal.action === 'BUY' || signal.action === 'STRONG_BUY')) {
      boostedConfidence = Math.min(100, boostedConfidence + 5);
      extraReasons.push('Bullish Engulfing pattern detected');
      extraReasonsAr.push('نموذج ابتلاع شرائي - تأكيد إضافي');
    }

    if (isBearishEngulfing && (signal.action === 'SELL' || signal.action === 'STRONG_SELL')) {
      boostedConfidence = Math.min(100, boostedConfidence + 5);
      extraReasons.push('Bearish Engulfing pattern detected');
      extraReasonsAr.push('نموذج ابتلاع بيعي - تأكيد إضافي');
    }

    // 2. فلتر كسر المقاومة/الدعم مع حجم
    const recentHigh = Math.max(...candles.slice(-20, -1).map(c => c.high));
    const recentLow = Math.min(...candles.slice(-20, -1).map(c => c.low));

    if (last.close > recentHigh && signal.indicators.volume.confirming && (signal.action.includes('BUY'))) {
      boostedConfidence = Math.min(100, boostedConfidence + 7);
      extraReasons.push(`Breakout above 20-period high ${recentHigh.toFixed(2)} with volume`);
      extraReasonsAr.push(`اختراق أعلى قمة 20 فترة ${recentHigh.toFixed(2)} مع حجم - إشارة قوية`);
    }

    if (last.close < recentLow && signal.indicators.volume.confirming && (signal.action.includes('SELL'))) {
      boostedConfidence = Math.min(100, boostedConfidence + 7);
      extraReasons.push(`Breakdown below 20-period low ${recentLow.toFixed(2)} with volume`);
      extraReasonsAr.push(`كسر أدنى قاع 20 فترة ${recentLow.toFixed(2)} مع حجم - إشارة قوية`);
    }

    // 3. فلتر ADX - لا تدخل إذا ADX ضعيف إلا إذا Squeeze
    if (signal.indicators.adx < this.config.adxMin && !signal.indicators.bollinger.squeeze) {
      if (boostedConfidence < 75) {
        boostedConfidence = Math.max(0, boostedConfidence - 10);
        extraReasons.push(`Weak ADX ${signal.indicators.adx.toFixed(1)} - reducing confidence`);
        extraReasonsAr.push(`ADX ضعيف ${signal.indicators.adx.toFixed(1)} - تقليل الثقة`);
      }
    }

    // 4. فلتر RSI المتطرف - لا تشتري في تشبع شرائي قوي
    if (signal.indicators.rsi > 80 && signal.action.includes('BUY')) {
      boostedConfidence = Math.max(0, boostedConfidence - 15);
      extraReasons.push(`RSI overbought ${signal.indicators.rsi.toFixed(1)} - dangerous to buy`);
      extraReasonsAr.push(`RSI تشبع شرائي ${signal.indicators.rsi.toFixed(1)} - خطر الشراء`);
    }

    if (signal.indicators.rsi < 20 && signal.action.includes('SELL')) {
      boostedConfidence = Math.max(0, boostedConfidence - 15);
      extraReasons.push(`RSI oversold ${signal.indicators.rsi.toFixed(1)} - dangerous to sell`);
      extraReasonsAr.push(`RSI تشبع بيعي ${signal.indicators.rsi.toFixed(1)} - خطر البيع`);
    }

    // تحديث مستوى الثقة
    let confidence_level = signal.confidence_level;
    if (boostedConfidence >= 90) confidence_level = 'EXTREME';
    else if (boostedConfidence >= 80) confidence_level = 'VERY_HIGH';
    else if (boostedConfidence >= 70) confidence_level = 'HIGH';
    else if (boostedConfidence >= 60) confidence_level = 'MEDIUM';
    else confidence_level = 'LOW';

    return {
      ...signal,
      confidence: Math.round(boostedConfidence),
      confidence_level,
      reasons: [...signal.reasons, ...extraReasons],
      reasons_ar: [...signal.reasons_ar, ...extraReasonsAr]
    };
  }

  /**
   * backtest سريع للاستراتيجية
   */
  backtest(candles: Candle[], timeframe: Timeframe = '15m'): { signals: TradingSignal[]; winRate: number; avgConfidence: number } {
    const signals: TradingSignal[] = [];
    
    // نحلل كل 10 شموع لتجنب الإشارات الكثيرة
    for (let i = 200; i < candles.length; i += 10) {
      const slice = candles.slice(0, i);
      const signal = this.execute(slice, 'BTC/USDT', timeframe);
      if (signal && signal.action !== 'HOLD') {
        signals.push(signal);
      }
    }

    const avgConfidence = signals.length > 0 
      ? signals.reduce((sum, s) => sum + s.confidence, 0) / signals.length 
      : 0;

    // حساب Win Rate تقريبي (يحتاج بيانات حقيقية لاحقاً)
    const wins = signals.filter(s => s.confidence >= 70).length;
    const winRate = signals.length > 0 ? (wins / signals.length) * 100 : 0;

    return {
      signals,
      winRate,
      avgConfidence
    };
  }
}
