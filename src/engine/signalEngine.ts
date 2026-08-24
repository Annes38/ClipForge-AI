/**
 * ClipForge AI - Signal Engine with Confidence Scoring
 * محرك الإشارات مع نظام حساب نسبة الثقة المتقدم
 * 
 * يعتمد على مفهوم Confluence Trading الذي يستخدمه كبار المتداولين
 * كل مؤشر يعطي نقاط، المجموع = نسبة الثقة
 */

import { Candle, IndicatorValues, TradingSignal, ConfluenceScore, SignalAction, Timeframe } from './types';
import { TechnicalIndicators } from '../indicators/technical';

export class SignalEngine {
  
  /**
   * حساب Confluence Score - قلب النظام
   * كل استراتيجية محترفة تعتمد على توافق عدة مؤشرات
   */
  static calculateConfluence(indicators: IndicatorValues, candles: Candle[]): ConfluenceScore {
    let bullishPoints = 0;
    let bearishPoints = 0;

    // 1. EMA Trend - 20 points max (أهم مؤشر اتجاه)
    let emaScore = 0;
    let emaReason = '';
    let emaBullish = false;
    
    if (indicators.ema_alignment >= 75) {
      emaScore = 20;
      emaReason = `اتجاه صاعد قوي جداً - EMA 9>21>50>200`;
      emaBullish = true;
      bullishPoints += 20;
    } else if (indicators.ema_alignment >= 25) {
      emaScore = 12;
      emaReason = `اتجاه صاعد - EMA 9>21>50`;
      emaBullish = true;
      bullishPoints += 12;
    } else if (indicators.ema_alignment <= -75) {
      emaScore = 20;
      emaReason = `اتجاه هابط قوي جداً - EMA 9<21<50<200`;
      emaBullish = false;
      bearishPoints += 20;
    } else if (indicators.ema_alignment <= -25) {
      emaScore = 12;
      emaReason = `اتجاه هابط - EMA 9<21<50`;
      emaBullish = false;
      bearishPoints += 12;
    } else {
      emaScore = 0;
      emaReason = `اتجاه جانبي - EMA متداخلة`;
      emaBullish = indicators.ema_alignment > 0;
    }

    // 2. VWAP - 15 points max (مؤشر المؤسسات)
    let vwapScore = 0;
    let vwapReason = '';
    let vwapBullish = false;
    
    if (indicators.vwap_signal === 'above' && indicators.price_vs_vwap > 0.5) {
      vwapScore = 15;
      vwapReason = `السعر فوق VWAP بـ ${indicators.price_vs_vwap.toFixed(2)}% - سيطرة المشترين`;
      vwapBullish = true;
      bullishPoints += 15;
    } else if (indicators.vwap_signal === 'above') {
      vwapScore = 8;
      vwapReason = `السعر فوق VWAP - إيجابي`;
      vwapBullish = true;
      bullishPoints += 8;
    } else if (indicators.vwap_signal === 'below' && indicators.price_vs_vwap < -0.5) {
      vwapScore = 15;
      vwapReason = `السعر تحت VWAP بـ ${Math.abs(indicators.price_vs_vwap).toFixed(2)}% - سيطرة البائعين`;
      vwapBullish = false;
      bearishPoints += 15;
    } else {
      vwapScore = 8;
      vwapReason = `السعر تحت VWAP - سلبي`;
      vwapBullish = false;
      bearishPoints += 8;
    }

    // 3. RSI Momentum - 15 points max
    let rsiScore = 0;
    let rsiReason = '';
    let rsiBullish = false;

    if (indicators.rsi >= 50 && indicators.rsi <= 65) {
      rsiScore = 15;
      rsiReason = `RSI ${indicators.rsi.toFixed(1)} - زخم صاعد مثالي`;
      rsiBullish = true;
      bullishPoints += 15;
    } else if (indicators.rsi > 65 && indicators.rsi < 75) {
      rsiScore = 10;
      rsiReason = `RSI ${indicators.rsi.toFixed(1)} - زخم صاعد قوي`;
      rsiBullish = true;
      bullishPoints += 10;
    } else if (indicators.rsi >= 30 && indicators.rsi < 40 && indicators.rsi_trend === 'bullish') {
      rsiScore = 12;
      rsiReason = `RSI ${indicators.rsi.toFixed(1)} - ارتداد من تشبع بيعي`;
      rsiBullish = true;
      bullishPoints += 12;
    } else if (indicators.rsi <= 50 && indicators.rsi >= 35) {
      rsiScore = 15;
      rsiReason = `RSI ${indicators.rsi.toFixed(1)} - زخم هابط مثالي`;
      rsiBullish = false;
      bearishPoints += 15;
    } else if (indicators.rsi < 35 && indicators.rsi > 25) {
      rsiScore = 10;
      rsiReason = `RSI ${indicators.rsi.toFixed(1)} - زخم هابط قوي`;
      rsiBullish = false;
      bearishPoints += 10;
    } else if (indicators.rsi >= 60 && indicators.rsi < 70 && indicators.rsi_trend === 'bearish') {
      rsiScore = 12;
      rsiReason = `RSI ${indicators.rsi.toFixed(1)} - ارتداد من تشبع شرائي`;
      rsiBullish = false;
      bearishPoints += 12;
    } else {
      rsiScore = 3;
      rsiReason = `RSI ${indicators.rsi.toFixed(1)} - منطقة خطر`;
      rsiBullish = indicators.rsi > 50;
      if (rsiBullish) bullishPoints += 3; else bearishPoints += 3;
    }

    // 4. MACD - 15 points max
    let macdScore = 0;
    let macdReason = '';
    let macdBullish = false;

    if (indicators.macd.bullish && indicators.macd.histogram > 0 && Math.abs(indicators.macd.histogram) > Math.abs(indicators.macd.macd * 0.1)) {
      macdScore = 15;
      macdReason = `MACD صاعد قوي - Histogram ${indicators.macd.histogram.toFixed(4)}`;
      macdBullish = true;
      bullishPoints += 15;
    } else if (indicators.macd.bullish) {
      macdScore = 8;
      macdReason = `MACD صاعد - فوق خط الإشارة`;
      macdBullish = true;
      bullishPoints += 8;
    } else if (!indicators.macd.bullish && indicators.macd.histogram < 0 && Math.abs(indicators.macd.histogram) > Math.abs(indicators.macd.macd * 0.1)) {
      macdScore = 15;
      macdReason = `MACD هابط قوي - Histogram ${indicators.macd.histogram.toFixed(4)}`;
      macdBullish = false;
      bearishPoints += 15;
    } else {
      macdScore = 8;
      macdReason = `MACD هابط - تحت خط الإشارة`;
      macdBullish = false;
      bearishPoints += 8;
    }

    // 5. Supertrend - 15 points max (مؤشر كبار المتداولين)
    let stScore = 0;
    let stReason = '';
    let stBullish = false;

    if (indicators.supertrend.direction === 'bullish') {
      stScore = 15;
      stReason = `Supertrend صاعد - اتجاه مؤكد`;
      stBullish = true;
      bullishPoints += 15;
    } else {
      stScore = 15;
      stReason = `Supertrend هابط - اتجاه مؤكد`;
      stBullish = false;
      bearishPoints += 15;
    }

    // 6. Bollinger Bands - 10 points max
    let bbScore = 0;
    let bbReason = '';
    let bbBullish = false;

    if (indicators.bollinger.squeeze) {
      bbScore = 5;
      bbReason = `Bollinger Squeeze - انضغاط، انفجار سعري قريب`;
      bbBullish = indicators.bollinger.percentB > 0.5;
      if (bbBullish) bullishPoints += 5; else bearishPoints += 5;
    } else if (indicators.bollinger.percentB > 0.8) {
      bbScore = 10;
      bbReason = `اختراق Bollinger العلوي - قوة شرائية`;
      bbBullish = true;
      bullishPoints += 10;
    } else if (indicators.bollinger.percentB < 0.2) {
      bbScore = 10;
      bbReason = `كسر Bollinger السفلي - قوة بيعية`;
      bbBullish = false;
      bearishPoints += 10;
    } else if (indicators.bollinger.percentB > 0.6) {
      bbScore = 6;
      bbReason = `السعر في النصف العلوي من Bollinger`;
      bbBullish = true;
      bullishPoints += 6;
    } else if (indicators.bollinger.percentB < 0.4) {
      bbScore = 6;
      bbReason = `السعر في النصف السفلي من Bollinger`;
      bbBullish = false;
      bearishPoints += 6;
    } else {
      bbScore = 2;
      bbReason = `السعر في وسط Bollinger - حيادي`;
      bbBullish = indicators.bollinger.percentB > 0.5;
    }

    // 7. Volume - 5 points max (يؤكد الاتجاه السائد)
    let volScore = 0;
    let volReason = '';
    let volBullish = false;

    // نحدد الاتجاه الحالي قبل حساب الحجم
    const currentTrendBullish = bullishPoints > bearishPoints;

    if (indicators.volume.confirming && indicators.volume.rvol > 1.5) {
      volScore = 5;
      volReason = `حجم تداول عالي RVOL ${indicators.volume.rvol.toFixed(2)}x - تأكيد قوي`;
      volBullish = currentTrendBullish;
      if (currentTrendBullish) bullishPoints += 5;
      else bearishPoints += 5;
    } else if (indicators.volume.rvol > 1.2) {
      volScore = 3;
      volReason = `حجم جيد RVOL ${indicators.volume.rvol.toFixed(2)}x`;
      volBullish = currentTrendBullish;
      if (currentTrendBullish) bullishPoints += 3;
      else bearishPoints += 3;
    } else {
      volScore = 1;
      volReason = `حجم ضعيف RVOL ${indicators.volume.rvol.toFixed(2)}x - حذر`;
      volBullish = false;
      // لا نضيف نقاط إذا حجم ضعيف
    }

    // 8. ADX - 5 points max
    let adxScore = 0;
    let adxReason = '';
    let adxBullish = false;

    if (indicators.adx > 25) {
      adxScore = 5;
      adxReason = `ADX ${indicators.adx.toFixed(1)} - اتجاه قوي ${indicators.adx_trend_strength}`;
      adxBullish = bullishPoints > bearishPoints;
      if (adxBullish) bullishPoints += 5; else bearishPoints += 5;
    } else {
      adxScore = 2;
      adxReason = `ADX ${indicators.adx.toFixed(1)} - اتجاه ضعيف، سوق جانبي`;
      adxBullish = false;
    }

    const totalBullish = bullishPoints;
    const totalBearish = bearishPoints;
    const total = Math.max(totalBullish, totalBearish);
    const isBullish = totalBullish > totalBearish;

    return {
      total: Math.min(100, total),
      bullish_points: totalBullish,
      bearish_points: totalBearish,
      components: {
        trend_ema: { score: emaScore, max: 20, reason: emaReason, bullish: emaBullish },
        vwap: { score: vwapScore, max: 15, reason: vwapReason, bullish: vwapBullish },
        momentum_rsi: { score: rsiScore, max: 15, reason: rsiReason, bullish: rsiBullish },
        momentum_macd: { score: macdScore, max: 15, reason: macdReason, bullish: macdBullish },
        supertrend: { score: stScore, max: 15, reason: stReason, bullish: stBullish },
        bollinger: { score: bbScore, max: 10, reason: bbReason, bullish: bbBullish },
        volume: { score: volScore, max: 5, reason: volReason, bullish: volBullish },
        adx: { score: adxScore, max: 5, reason: adxReason, bullish: adxBullish }
      }
    };
  }

  /**
   * توليد إشارة التداول النهائية مع كل التفاصيل
   */
  static generateSignal(
    candles: Candle[],
    symbol: string = 'BTC/USDT',
    timeframe: Timeframe = '15m',
    strategyName: string = 'Pro Confluence V2'
  ): TradingSignal | null {
    if (candles.length < 200) return null;

    const indicators = TechnicalIndicators.calculateAll(candles);
    if (!indicators) return null;

    const confluence = this.calculateConfluence(indicators, candles);
    const lastCandle = candles[candles.length - 1];
    const entryPrice = lastCandle.close;
    const entryTime = new Date(lastCandle.time).toISOString();

    // تحديد الإجراء
    let action: SignalAction = 'HOLD';
    let confidence = confluence.total;
    let confidence_level: TradingSignal['confidence_level'] = 'LOW';

    const bullish = confluence.bullish_points > confluence.bearish_points;
    const diff = Math.abs(confluence.bullish_points - confluence.bearish_points);

    // إذا الفرق قليل = HOLD
    if (diff < 10) {
      action = 'HOLD';
      confidence = 50 + diff;
    } else if (bullish) {
      if (confidence >= 80) action = 'STRONG_BUY';
      else if (confidence >= 60) action = 'BUY';
      else action = 'HOLD';
    } else {
      if (confidence >= 80) action = 'STRONG_SELL';
      else if (confidence >= 60) action = 'SELL';
      else action = 'HOLD';
    }

    // مستوى الثقة
    if (confidence >= 90) confidence_level = 'EXTREME';
    else if (confidence >= 80) confidence_level = 'VERY_HIGH';
    else if (confidence >= 70) confidence_level = 'HIGH';
    else if (confidence >= 60) confidence_level = 'MEDIUM';
    else confidence_level = 'LOW';

    // حساب وقف الخسارة وجني الأرباح بناء على ATR
    const atr = indicators.atr;
    let stopLoss: number;
    let takeProfit: number;
    let takeProfit2: number;

    if (bullish) {
      stopLoss = entryPrice - atr * 1.5;
      takeProfit = entryPrice + atr * 2;
      takeProfit2 = entryPrice + atr * 3.5;
    } else {
      stopLoss = entryPrice + atr * 1.5;
      takeProfit = entryPrice - atr * 2;
      takeProfit2 = entryPrice - atr * 3.5;
    }

    const risk = Math.abs(entryPrice - stopLoss);
    const reward = Math.abs(takeProfit - entryPrice);
    const riskReward = risk === 0 ? 0 : reward / risk;

    // مدة الصفقة المقترحة حسب الفريم
    const durationMap: Record<Timeframe, { min: number; max: number; estimated: number; label: string }> = {
      '1m': { min: 5, max: 30, estimated: 15, label: '5د - 30د (سكالبينج)' },
      '3m': { min: 15, max: 60, estimated: 30, label: '15د - 1ساعة (سكالبينج)' },
      '5m': { min: 30, max: 120, estimated: 60, label: '30د - 2ساعة (سكالبينج)' },
      '15m': { min: 60, max: 240, estimated: 120, label: '1ساعة - 4ساعات (يومي)' },
      '30m': { min: 120, max: 480, estimated: 240, label: '2ساعة - 8ساعات (يومي)' },
      '1h': { min: 240, max: 1440, estimated: 480, label: '4ساعات - يوم (سوينغ قصير)' },
      '4h': { min: 720, max: 4320, estimated: 1440, label: '12ساعة - 3أيام (سوينغ)' },
      '1d': { min: 1440, max: 10080, estimated: 4320, label: '1يوم - 7أيام (استثمار)' }
    };

    const duration = durationMap[timeframe];
    const expiryTime = new Date(lastCandle.time + duration.estimated * 60 * 1000).toISOString();

    // الأسباب
    const reasons: string[] = [];
    const reasons_ar: string[] = [];

    Object.values(confluence.components).forEach(comp => {
      if (comp.score >= comp.max * 0.6) {
        reasons.push(comp.reason);
        reasons_ar.push(comp.reason);
      }
    });

    // إضافة تحليل ADX
    if (indicators.adx > 25) {
      reasons.push(`Strong trend confirmed by ADX ${indicators.adx.toFixed(1)}`);
      reasons_ar.push(`اتجاه قوي مؤكد بـ ADX ${indicators.adx.toFixed(1)}`);
    }

    if (indicators.bollinger.squeeze) {
      reasons.push(`Bollinger squeeze detected - volatility expansion expected`);
      reasons_ar.push(`انضغاط Bollinger - توقع انفجار سعري قريب`);
    }

    if (indicators.volume.confirming) {
      reasons.push(`Volume confirmation RVOL ${indicators.volume.rvol.toFixed(2)}x`);
      reasons_ar.push(`تأكيد بالحجم RVOL ${indicators.volume.rvol.toFixed(2)}x`);
    }

    return {
      id: `${symbol}-${Date.now()}`,
      symbol,
      action,
      confidence: Math.round(confidence),
      confidence_level,
      entryTime,
      entryPrice,
      timeframe,
      suggestedDuration: duration.label,
      duration_minutes: {
        min: duration.min,
        max: duration.max,
        estimated: duration.estimated
      },
      stopLoss: Number(stopLoss.toFixed(2)),
      takeProfit: Number(takeProfit.toFixed(2)),
      takeProfit2: Number(takeProfit2.toFixed(2)),
      riskReward: Number(riskReward.toFixed(2)),
      indicators,
      confluence,
      reasons,
      reasons_ar,
      strategy_used: strategyName,
      timestamp: lastCandle.time,
      expiryTime
    };
  }

  /**
   * تحليل سريع لمجموعة شموع
   */
  static quickAnalysis(candles: Candle[]): { bullish: number; bearish: number; neutral: number } {
    if (candles.length < 50) return { bullish: 0, bearish: 0, neutral: 100 };
    
    const last20 = candles.slice(-20);
    let bullish = 0;
    let bearish = 0;

    for (const candle of last20) {
      if (candle.close > candle.open) bullish++;
      else if (candle.close < candle.open) bearish++;
    }

    const total = last20.length;
    return {
      bullish: Math.round((bullish / total) * 100),
      bearish: Math.round((bearish / total) * 100),
      neutral: Math.round(((total - bullish - bearish) / total) * 100)
    };
  }
}
