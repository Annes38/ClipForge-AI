# استراتيجيات احترافية متوافقة مع Haehnchen Crypto Trading Bot

هذه الاستراتيجيات مطورة لتكون أقوى من الاستراتيجيات العادية في المشروع الأصلي.
تعتمد على بحث عن استراتيجيات كبار المتداولين 2024-2026.

## كيف تستعملها؟

انسخ الملفات إلى:
```
var/strategies/
```

أو في مشروع Haehnchen الأصلي:
```
src/strategy/strategies/
```

## الاستراتيجيات

### 1. pro_confluence_v2.ts
**Pro Confluence V2 - Institutional Grade**
- 8 مؤشرات: EMA 9/21/50/200 + VWAP + RSI + MACD + Supertrend + BB + Volume + ADX
- نظام نقاط 0-100 = نسبة الثقة
- لا دخول إلا إذا 60%+ توافق
- إذا 2 استراتيجيات متفقة = +8% ثقة

**مميزات:**
- يعطيك نسبة ثقة 80% بيع مثلاً
- يعطيك وقت دخول ومدة الصفقة
- وقف خسارة وهدف بناء على ATR

### 2. institutional_vwap_pro.ts
**VWAP Institutional - Wall Street**
- أفضل مؤشر يومي 9/10 حسب بحث 2026
- فوق VWAP = سيطرة مشترين
- تحت VWAP = سيطرة بائعين
- إشارة الارتداد من VWAP = قوية جداً

### 3. smart_money_momentum_pro.ts
**Momentum Breakout + Smart Money**
- يصيد الانفجارات السعرية
- انضغاط Bollinger + كسر + حجم عالي RVOL >1.5
- تأكيد RSI + MACD + ADX
- R/R عالي: وقف ضيق 1.2 ATR وهدف 3-5 ATR

## نظام الإشارات المطلوب

كل استراتيجية ترجع:

```typescript
{
  action: 'BUY' | 'SELL' | 'HOLD' | 'STRONG_BUY' | 'STRONG_SELL',
  confidence: 80, // %
  entryTime: ISO string,
  suggestedDuration: "1س - 4س",
  stopLoss, takeProfit, riskReward,
  reasons_ar: ["ارتداد VWAP شرائي", "RSI 55 - زخم صاعد"]
}
```

## الفرق عن الاستراتيجيات العادية

المطور قال "الاستراتيجيات العادية أغلبها ماشي مربحة" لأنه:
- تستخدم مؤشر واحد فقط
- لا يوجد نظام ثقة
- لا يوجد فلتر حجم

استراتيجياتنا:
- ✅ توافق 5-8 مؤشرات (Confluence)
- ✅ نسبة ثقة 0-100%
- ✅ فلتر حجم أموال ذكية
- ✅ فلتر ADX لتجنب السوق الجانبي
- ✅ شموع يابانية (Engulfing)
- ✅ كسر مقاومة/دعم مع حجم

## اختبار

```bash
npm run test:strategies
```

## Dashboard

افتح `http://localhost:8080` تشوف كل الإشارات مع نسبة الثقة والوقت والمدة.
