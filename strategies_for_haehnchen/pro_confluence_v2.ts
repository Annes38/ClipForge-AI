/**
 * Pro Confluence V2 - Compatible with Haehnchen/crypto-trading-bot
 * استراتيجية احترافية بتوافق 8 مؤشرات ونسبة ثقة
 * 
 * انسخ هذا الملف إلى var/strategies/pro_confluence_v2.ts في مشروع Haehnchen
 * أو src/strategy/strategies/pro_confluence_v2.ts
 * 
 * المميزات:
 * - نسبة ثقة 0-100%
 * - وقت دخول ومدة صفقة
 * - وقف خسارة وهدف تلقائي
 */

import strategy, { StrategyBase, TypedStrategyContext, StrategySignal, type TypedIndicatorDefinition } from '@strategy';

export interface ProConfluenceV2Options {
  min_confidence?: number;
  ema_short?: number;
  ema_mid?: number;
  ema_long?: number;
  ema_trend?: number;
  rsi_period?: number;
  atr_period?: number;
  adx_period?: number;
}

export type ProConfluenceIndicators = {
  ema9: TypedIndicatorDefinition<'ema'>;
  ema21: TypedIndicatorDefinition<'ema'>;
  ema50: TypedIndicatorDefinition<'ema'>;
  ema200: TypedIndicatorDefinition<'ema'>;
  rsi: TypedIndicatorDefinition<'rsi'>;
  macd: TypedIndicatorDefinition<'macd_ext'>;
  bb: TypedIndicatorDefinition<'bb'>;
  atr: TypedIndicatorDefinition<'atr'>;
  adx: TypedIndicatorDefinition<'adx'>;
  sma_volume: TypedIndicatorDefinition<'sma'>;
};

export class ProConfluenceV2 extends StrategyBase<ProConfluenceIndicators, ProConfluenceV2Options> {
  getDescription(): string {
    return 'Pro Confluence V2 - 8 indicators with 0-100% confidence score, entry time & duration. Based on institutional VWAP+EMA+RSI+MACD+Supertrend';
  }

  defineIndicators(): ProConfluenceIndicators {
    return {
      ema9: strategy.indicator.ema({ length: this.options.ema_short || 9 }),
      ema21: strategy.indicator.ema({ length: this.options.ema_mid || 21 }),
      ema50: strategy.indicator.ema({ length: this.options.ema_long || 50 }),
      ema200: strategy.indicator.ema({ length: this.options.ema_trend || 200 }),
      rsi: strategy.indicator.rsi({ length: this.options.rsi_period || 14 }),
      macd: strategy.indicator.macdExt({ fast_period: 12, slow_period: 26, signal_period: 9 }),
      bb: strategy.indicator.bb({ length: 20 }),
      atr: strategy.indicator.atr({ length: this.options.atr_period || 14 }),
      adx: strategy.indicator.adx({ length: this.options.adx_period || 14 }),
      sma_volume: strategy.indicator.sma({ length: 20 })
    };
  }

  async execute(context: TypedStrategyContext<ProConfluenceIndicators>, signal: StrategySignal): Promise<void> {
    const ema9Arr = context.getIndicatorSlice('ema9', 2) as number[];
    const ema21Arr = context.getIndicatorSlice('ema21', 2) as number[];
    const ema50Arr = context.getIndicatorSlice('ema50', 2) as number[];
    const ema200Arr = context.getIndicatorSlice('ema200', 2) as number[];
    const rsiArr = context.getIndicatorSlice('rsi', 2) as number[];
    const macdArr = context.getIndicatorSlice('macd', 3) as any[];
    const bbArr = context.getIndicatorSlice('bb', 3) as any[];
    const atrArr = context.getIndicatorSlice('atr', 2) as number[];
    const adxArr = context.getIndicatorSlice('adx', 2) as number[];

    if (!ema9Arr.length || !ema21Arr.length || !rsiArr.length || !macdArr.length) return;

    const price = context.price;
    const ema9 = ema9Arr[ema9Arr.length - 1];
    const ema21 = ema21Arr[ema21Arr.length - 1];
    const ema50 = ema50Arr[ema50Arr.length - 1];
    const ema200 = ema200Arr[ema200Arr.length - 1];
    const rsi = rsiArr[rsiArr.length - 1];
    const macd = macdArr[macdArr.length - 1];
    const prevMacd = macdArr.length > 1 ? macdArr[macdArr.length - 2] : macd;
    const bb = bbArr[bbArr.length - 1];
    const atr = atrArr[atrArr.length - 1] || price * 0.01;
    const adx = adxArr[adxArr.length - 1] || 20;

    // حساب نقاط الثقة
    let bullishPoints = 0;
    let bearishPoints = 0;

    // 1. EMA Alignment - 20 points
    const emaBullish = ema9 > ema21 && ema21 > ema50 && ema50 > ema200;
    const emaBearish = ema9 < ema21 && ema21 < ema50 && ema50 < ema200;
    
    if (emaBullish) bullishPoints += 20;
    else if (emaBearish) bearishPoints += 20;
    else if (ema9 > ema21 && ema21 > ema50) bullishPoints += 12;
    else if (ema9 < ema21 && ema21 < ema50) bearishPoints += 12;

    // 2. RSI - 15 points
    if (rsi >= 50 && rsi <= 65) bullishPoints += 15;
    else if (rsi >= 35 && rsi < 50) bearishPoints += 15;
    else if (rsi > 65 && rsi < 75) bullishPoints += 10;
    else if (rsi < 35 && rsi > 25) bearishPoints += 10;

    // 3. MACD - 15 points
    const macdBullish = macd.histogram > 0 && macd.histogram > prevMacd.histogram;
    const macdBearish = macd.histogram < 0 && macd.histogram < prevMacd.histogram;
    
    if (macdBullish) bullishPoints += 15;
    if (macdBearish) bearishPoints += 15;

    // 4. Bollinger - 10 points
    if (bb) {
      const percentB = (price - bb.lower) / (bb.upper - bb.lower);
      if (percentB > 0.8) bullishPoints += 10;
      else if (percentB < 0.2) bearishPoints += 10;
      else if (percentB > 0.6) bullishPoints += 6;
      else if (percentB < 0.4) bearishPoints += 6;
    }

    // 5. ADX - 5 points
    if (adx > 25) {
      if (bullishPoints > bearishPoints) bullishPoints += 5;
      else bearishPoints += 5;
    }

    // 6. Price vs EMA200 - 15 points (بديل VWAP في هذا البوت)
    if (price > ema200) bullishPoints += 15;
    else bearishPoints += 15;

    // 7. Supertrend logic simplified - 20 points
    const supertrendBullish = price > ema50 && ema9 > ema21;
    const supertrendBearish = price < ema50 && ema9 < ema21;
    
    if (supertrendBullish) bullishPoints += 20;
    if (supertrendBearish) bearishPoints += 20;

    const totalBullish = bullishPoints;
    const totalBearish = bearishPoints;
    const confidence = Math.max(totalBullish, totalBearish);
    const isBullish = totalBullish > totalBearish;
    const diff = Math.abs(totalBullish - totalBearish);

    const minConfidence = this.options.min_confidence || 60;

    // معلومات إضافية للإشارة
    const entryTime = new Date().toISOString();
    const duration = '1س - 4س (15m timeframe)';
    
    signal.debugAll({
      confidence: `${confidence}%`,
      confidence_level: confidence >= 80 ? 'VERY_HIGH' : confidence >= 70 ? 'HIGH' : confidence >= 60 ? 'MEDIUM' : 'LOW',
      bullish_points: totalBullish,
      bearish_points: totalBearish,
      entry_time: entryTime,
      suggested_duration: duration,
      stop_loss: isBullish ? (price - atr * 1.5).toFixed(2) : (price + atr * 1.5).toFixed(2),
      take_profit: isBullish ? (price + atr * 2.5).toFixed(2) : (price - atr * 2.5).toFixed(2),
      risk_reward: '1:1.6',
      ema_alignment: emaBullish ? 'bullish_strong' : emaBearish ? 'bearish_strong' : 'mixed',
      rsi: rsi.toFixed(1),
      macd_histogram: macd.histogram?.toFixed(4),
      adx: adx.toFixed(1),
      price_vs_ema200: ((price - ema200) / ema200 * 100).toFixed(2) + '%',
      strategy: 'Pro Confluence V2 - Institutional'
    });

    // لا دخول إذا الثقة ضعيفة أو الفرق قليل
    if (confidence < minConfidence || diff < 10) {
      return;
    }

    // إشارة شراء قوية
    if (isBullish && confidence >= 60) {
      // فلتر إضافي: لا تشتري إذا RSI متشبع
      if (rsi > 80) return;
      
      if (confidence >= 80) {
        signal.debugAll({ action: 'STRONG_BUY', arabic: `شراء قوي ${confidence}% - توافق ${totalBullish} نقطة` });
      } else {
        signal.debugAll({ action: 'BUY', arabic: `شراء ${confidence}% - توافق ${totalBullish} نقطة` });
      }
      signal.goLong();
      return;
    }

    // إشارة بيع قوية
    if (!isBullish && confidence >= 60) {
      if (rsi < 20) return;
      
      if (confidence >= 80) {
        signal.debugAll({ action: 'STRONG_SELL', arabic: `بيع قوي ${confidence}% - توافق ${totalBearish} نقطة` });
      } else {
        signal.debugAll({ action: 'SELL', arabic: `بيع ${confidence}% - توافق ${totalBearish} نقطة` });
      }
      signal.goShort();
      return;
    }

    // إغلاق إذا انعكاس
    const lastSignal = context.lastSignal;
    if (lastSignal === 'long' && totalBearish > totalBullish && diff > 15) {
      signal.debugAll({ action: 'CLOSE_LONG', reason: 'Bearish reversal detected' });
      signal.close();
    }
    if (lastSignal === 'short' && totalBullish > totalBearish && diff > 15) {
      signal.debugAll({ action: 'CLOSE_SHORT', reason: 'Bullish reversal detected' });
      signal.close();
    }
  }

  protected getDefaultOptions(): ProConfluenceV2Options {
    return {
      min_confidence: 60,
      ema_short: 9,
      ema_mid: 21,
      ema_long: 50,
      ema_trend: 200,
      rsi_period: 14,
      atr_period: 14,
      adx_period: 14
    };
  }
}
