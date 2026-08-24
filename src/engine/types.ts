/**
 * ClipForge AI - Enhanced Trading Engine Types
 * نظام الإشارات المتقدم مع نسبة الثقة
 */

export type SignalAction = 'BUY' | 'SELL' | 'HOLD' | 'STRONG_BUY' | 'STRONG_SELL';
export type Timeframe = '1m' | '3m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d';

export interface Candle {
  time: number; // timestamp
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface IndicatorValues {
  rsi: number;
  rsi_trend: 'bullish' | 'bearish' | 'neutral';
  ema9: number;
  ema21: number;
  ema50: number;
  ema200: number;
  ema_alignment: number; // -100 to 100 score
  macd: {
    macd: number;
    signal: number;
    histogram: number;
    bullish: boolean;
  };
  vwap: number;
  price_vs_vwap: number; // % distance
  vwap_signal: 'above' | 'below';
  supertrend: {
    value: number;
    direction: 'bullish' | 'bearish';
  };
  bollinger: {
    upper: number;
    middle: number;
    lower: number;
    width: number;
    percentB: number; // 0-1 where price is in bands
    squeeze: boolean;
  };
  atr: number;
  atr_percent: number;
  volume: {
    current: number;
    sma20: number;
    rvol: number; // relative volume
    confirming: boolean;
  };
  adx: number;
  adx_trend_strength: 'weak' | 'moderate' | 'strong' | 'very_strong';
}

export interface ConfluenceScore {
  total: number; // 0-100
  bullish_points: number;
  bearish_points: number;
  components: {
    trend_ema: { score: number; max: number; reason: string; bullish: boolean };
    vwap: { score: number; max: number; reason: string; bullish: boolean };
    momentum_rsi: { score: number; max: number; reason: string; bullish: boolean };
    momentum_macd: { score: number; max: number; reason: string; bullish: boolean };
    supertrend: { score: number; max: number; reason: string; bullish: boolean };
    bollinger: { score: number; max: number; reason: string; bullish: boolean };
    volume: { score: number; max: number; reason: string; bullish: boolean };
    adx: { score: number; max: number; reason: string; bullish: boolean };
  };
}

export interface TradingSignal {
  id: string;
  symbol: string;
  action: SignalAction;
  confidence: number; // 0-100 %
  confidence_level: 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH' | 'EXTREME';
  entryTime: string; // ISO
  entryPrice: number;
  timeframe: Timeframe;
  suggestedDuration: string; // e.g. "15m-1h", "2h-4h", "1d-3d"
  duration_minutes: { min: number; max: number; estimated: number };
  stopLoss: number;
  takeProfit: number;
  takeProfit2?: number;
  riskReward: number;
  indicators: IndicatorValues;
  confluence: ConfluenceScore;
  reasons: string[]; // Arabic + English explanations
  reasons_ar: string[];
  strategy_used: string;
  timestamp: number;
  expiryTime?: string;
}

export interface StrategyResult {
  signal: TradingSignal;
  raw_score: ConfluenceScore;
}
