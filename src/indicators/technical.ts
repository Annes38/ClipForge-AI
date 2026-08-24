/**
 * ClipForge AI - Technical Indicators Engine
 * محرك المؤشرات الفنية المتقدم
 * يستخدم technicalindicators + حسابات مخصصة لـ VWAP و Supertrend
 */

import { RSI, EMA, MACD, BollingerBands, ATR, ADX, SMA } from 'technicalindicators';
import { Candle, IndicatorValues } from '../engine/types';

export class TechnicalIndicators {
  
  static calculateRSI(closes: number[], period = 14): number[] {
    return RSI.calculate({ values: closes, period });
  }

  static calculateEMA(values: number[], period: number): number[] {
    return EMA.calculate({ values, period });
  }

  static calculateMACD(closes: number[], fast = 12, slow = 26, signal = 9) {
    return MACD.calculate({
      values: closes,
      fastPeriod: fast,
      slowPeriod: slow,
      signalPeriod: signal,
      SimpleMAOscillator: false,
      SimpleMASignal: false
    });
  }

  static calculateBB(closes: number[], period = 20, stdDev = 2) {
    return BollingerBands.calculate({
      period,
      values: closes,
      stdDev
    });
  }

  static calculateATR(candles: Candle[], period = 14): number[] {
    const high = candles.map(c => c.high);
    const low = candles.map(c => c.low);
    const close = candles.map(c => c.close);
    return ATR.calculate({ high, low, close, period });
  }

  static calculateADX(candles: Candle[], period = 14): number[] {
    const high = candles.map(c => c.high);
    const low = candles.map(c => c.low);
    const close = candles.map(c => c.close);
    return ADX.calculate({ high, low, close, period }).map(v => v.adx);
  }

  // VWAP - Volume Weighted Average Price
  static calculateVWAP(candles: Candle[]): number[] {
    const vwap: number[] = [];
    let cumulativePV = 0;
    let cumulativeVolume = 0;

    for (const candle of candles) {
      const typicalPrice = (candle.high + candle.low + candle.close) / 3;
      cumulativePV += typicalPrice * candle.volume;
      cumulativeVolume += candle.volume;
      vwap.push(cumulativeVolume === 0 ? typicalPrice : cumulativePV / cumulativeVolume);
    }
    return vwap;
  }

  // Supertrend - أحد أقوى مؤشرات كبار المتداولين
  static calculateSupertrend(candles: Candle[], atrPeriod = 10, multiplier = 3): { value: number; direction: 'bullish' | 'bearish' }[] {
    const atr = this.calculateATR(candles, atrPeriod);
    const result: { value: number; direction: 'bullish' | 'bearish' }[] = [];
    
    let upperBand = 0;
    let lowerBand = 0;
    let prevUpperBand = 0;
    let prevLowerBand = 0;
    let prevClose = candles[0]?.close || 0;
    let direction: 'bullish' | 'bearish' = 'bullish';
    let supertrendValue = 0;

    // Align ATR (ATR array is shorter)
    const atrOffset = candles.length - atr.length;

    for (let i = 0; i < candles.length; i++) {
      const candle = candles[i];
      const hl2 = (candle.high + candle.low) / 2;
      const currentATR = i >= atrOffset ? atr[i - atrOffset] : atr[0] || 0;

      const basicUpper = hl2 + multiplier * currentATR;
      const basicLower = hl2 - multiplier * currentATR;

      if (i === 0) {
        upperBand = basicUpper;
        lowerBand = basicLower;
      } else {
        // Final bands
        upperBand = (basicUpper < prevUpperBand || prevClose > prevUpperBand) ? basicUpper : prevUpperBand;
        lowerBand = (basicLower > prevLowerBand || prevClose < prevLowerBand) ? basicLower : prevLowerBand;
      }

      // Direction
      if (i > 0) {
        if (prevClose <= prevUpperBand && candle.close > prevUpperBand) {
          direction = 'bullish';
        } else if (prevClose >= prevLowerBand && candle.close < prevLowerBand) {
          direction = 'bearish';
        }
      }

      supertrendValue = direction === 'bullish' ? lowerBand : upperBand;

      result.push({
        value: supertrendValue,
        direction
      });

      prevUpperBand = upperBand;
      prevLowerBand = lowerBand;
      prevClose = candle.close;
    }

    return result;
  }

  static calculateVolumeSMA(volumes: number[], period = 20): number[] {
    return SMA.calculate({ values: volumes, period });
  }

  // الحساب الشامل لكل المؤشرات
  static calculateAll(candles: Candle[]): IndicatorValues | null {
    if (candles.length < 200) return null;

    const closes = candles.map(c => c.close);
    const volumes = candles.map(c => c.volume);
    const last = candles[candles.length - 1];

    // RSI
    const rsiValues = this.calculateRSI(closes, 14);
    const rsi = rsiValues[rsiValues.length - 1] || 50;
    let rsi_trend: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    if (rsi > 60) rsi_trend = 'bullish';
    else if (rsi < 40) rsi_trend = 'bearish';

    // EMAs
    const ema9Arr = this.calculateEMA(closes, 9);
    const ema21Arr = this.calculateEMA(closes, 21);
    const ema50Arr = this.calculateEMA(closes, 50);
    const ema200Arr = this.calculateEMA(closes, 200);

    const ema9 = ema9Arr[ema9Arr.length - 1];
    const ema21 = ema21Arr[ema21Arr.length - 1];
    const ema50 = ema50Arr[ema50Arr.length - 1];
    const ema200 = ema200Arr[ema200Arr.length - 1];

    // EMA alignment score
    let ema_alignment = 0;
    if (ema9 > ema21) ema_alignment += 25;
    else ema_alignment -= 25;
    if (ema21 > ema50) ema_alignment += 25;
    else ema_alignment -= 25;
    if (ema50 > ema200) ema_alignment += 25;
    else ema_alignment -= 25;
    if (ema9 > ema50) ema_alignment += 25;
    else ema_alignment -= 25;

    // MACD
    const macdArr = this.calculateMACD(closes);
    const lastMACD = macdArr[macdArr.length - 1];
    const macd = {
      macd: lastMACD?.MACD || 0,
      signal: lastMACD?.signal || 0,
      histogram: lastMACD?.histogram || 0,
      bullish: (lastMACD?.histogram || 0) > 0
    };

    // VWAP
    const vwapArr = this.calculateVWAP(candles);
    const vwap = vwapArr[vwapArr.length - 1];
    const price_vs_vwap = ((last.close - vwap) / vwap) * 100;
    const vwap_signal = last.close > vwap ? 'above' as const : 'below' as const;

    // Supertrend
    const supertrendArr = this.calculateSupertrend(candles);
    const supertrend = supertrendArr[supertrendArr.length - 1];

    // Bollinger Bands
    const bbArr = this.calculateBB(closes, 20, 2);
    const lastBB = bbArr[bbArr.length - 1];
    const bbWidth = lastBB ? (lastBB.upper - lastBB.lower) / lastBB.middle : 0;
    const percentB = lastBB ? (last.close - lastBB.lower) / (lastBB.upper - lastBB.lower) : 0.5;
    // Squeeze: width < 0.1 * average width of last 20
    const recentWidths = bbArr.slice(-20).map(b => (b.upper - b.lower) / b.middle);
    const avgWidth = recentWidths.reduce((a, b) => a + b, 0) / recentWidths.length;
    const squeeze = bbWidth < avgWidth * 0.7;

    const bollinger = {
      upper: lastBB?.upper || 0,
      middle: lastBB?.middle || 0,
      lower: lastBB?.lower || 0,
      width: bbWidth,
      percentB,
      squeeze
    };

    // ATR
    const atrArr = this.calculateATR(candles, 14);
    const atr = atrArr[atrArr.length - 1] || 0;
    const atr_percent = (atr / last.close) * 100;

    // Volume
    const volSMAArr = this.calculateVolumeSMA(volumes, 20);
    const volSMA = volSMAArr[volSMAArr.length - 1] || volumes[volumes.length - 1];
    const rvol = volSMA === 0 ? 1 : volumes[volumes.length - 1] / volSMA;
    const volume = {
      current: volumes[volumes.length - 1],
      sma20: volSMA,
      rvol,
      confirming: rvol > 1.2
    };

    // ADX
    const adxArr = this.calculateADX(candles, 14);
    const adx = adxArr[adxArr.length - 1] || 20;
    let adx_trend_strength: 'weak' | 'moderate' | 'strong' | 'very_strong' = 'weak';
    if (adx > 50) adx_trend_strength = 'very_strong';
    else if (adx > 25) adx_trend_strength = 'strong';
    else if (adx > 20) adx_trend_strength = 'moderate';

    return {
      rsi,
      rsi_trend,
      ema9,
      ema21,
      ema50,
      ema200,
      ema_alignment,
      macd,
      vwap,
      price_vs_vwap,
      vwap_signal,
      supertrend,
      bollinger,
      atr,
      atr_percent,
      volume,
      adx,
      adx_trend_strength
    };
  }
}
