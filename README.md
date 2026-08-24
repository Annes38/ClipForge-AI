# ClipForge AI - Enhanced Trading Bot 🚀

> **تطوير لمشروع Haehnchen/crypto-trading-bot مع استراتيجيات احترافية ونظام إشارات بنسبة ثقة**

## ❓ هل هذا ممكن؟ نعم 100% وتم تنفيذه!

المطور الأصلي قال "الاستراتيجيات العادية أغلبها ماشي مربحة" لأنه يستخدم مؤشر واحد فقط.

**نحن طورنا نظام احترافي:**
- ✅ **8 مؤشرات** توافق (Confluence) = نسبة ثقة 0-100%
- ✅ **وقت دخول** و **مدة صفقة** مقترحة
- ✅ **نسبة إشارة** مثلاً "بيع 80%" بناء على توافق الاستراتيجيات
- ✅ **3 استراتيجيات كبار متداولين** 2024-2026

---

## 🧠 كيف نحسب نسبة الثقة؟

### مثال: إشارة "بيع 80%"

معناه 80 نقطة من 100 متفقة على البيع:

| مؤشر | نقاط | يقيس |
|------|------|------|
| 📈 EMA 9/21/50/200 | 20 | الاتجاه |
| 🏦 VWAP (المؤسسات) | 15 | سيطرة المؤسسات |
| ⚡ RSI | 15 | الزخم |
| 📊 MACD | 15 | الزخم |
| 🔥 Supertrend | 15 | اتجاه محترفين |
| 📉 Bollinger | 10 | تقلب |
| 📦 Volume RVOL | 5 | حجم |
| 💪 ADX | 5 | قوة |
| **المجموع** | **100** | **= نسبة الثقة** |

إذا 2 أو 3 استراتيجيات متفقة = +8% لكل استراتيجية = ثقة 96% 🔥

---

## 📦 الاستراتيجيات المدمجة

### 1. Pro Confluence V2 (الأساسية)
- توافق 8 مؤشرات
- لا دخول إلا إذا 60%+ ثقة
- مبنية على بحث 2026: EMA+RSI+VWAP أفضل Setup

### 2. VWAP Institutional
- مؤشر المؤسسات 9/10 تقييم
- فوق VWAP = شراء، تحت = بيع
- ارتداد من VWAP = إشارة قوية جداً

### 3. Momentum Breakout + Smart Money
- يصيد الانفجارات السعرية
- انضغاط + كسر + حجم عالي RVOL>1.5
- R/R عالي 1:3 إلى 1:5

---

## 🚀 التشغيل السريع

```bash
# تثبيت
npm install

# اختبار سريع للإشارات
npm run test:strategies
# أو
npm start

# تشغيل Dashboard مع API
npm run api
# ثم افتح http://localhost:8080
```

### Dashboard يعطيك:
- 📡 كل العملات مع إشاراتها
- 💯 نسبة الثقة مع شريط ملون
- ⏰ وقت دخول وسعر دخول
- ⏱️ مدة الصفقة (مثلاً 1س-4س)
- 🛑 وقف خسارة و 🎯 هدف و R/R
- 🧠 تفصيل نقاط كل مؤشر
- 📝 أسباب الإشارة بالعربية

---

## 🔌 API

```bash
GET /api/signals/all?timeframe=15m&strategy=all
GET /api/signal/BTC/USDT?timeframe=15m&strategy=pro_confluence
GET /api/strategies
GET /api/health
```

**مثال إشارة:**
```json
{
  "symbol": "BTC/USDT",
  "action": "STRONG_BUY",
  "confidence": 85,
  "confidence_level": "VERY_HIGH",
  "entryTime": "2026-08-24T10:30:00Z",
  "entryPrice": 65000,
  "suggestedDuration": "1ساعة - 4ساعات (يومي)",
  "stopLoss": 64200,
  "takeProfit": 66500,
  "riskReward": 2.5,
  "reasons_ar": ["ارتداد VWAP شرائي", "RSI 55 - زخم صاعد مثالي"]
}
```

---

## 🔗 متوافق مع Haehnchen Bot

انسخ ملفات من `strategies_for_haehnchen/` إلى:

```bash
# في مشروع Haehnchen
var/strategies/pro_confluence_v2.ts
```

ثم البوت الأصلي سيستخدم استراتيجيتنا القوية بدل الضعيفة.

---

## 📚 التوثيق

- `docs/STRATEGIES.md` - شرح مفصل للاستراتيجيات وبحث كبار المتداولين
- `strategies_for_haehnchen/README.md` - كيف تستعمل مع البوت الأصلي
- `src/engine/types.ts` - أنواع الإشارات

---

## 🛠️ التقنيات

- TypeScript + Node.js
- technicalindicators
- Express API
- Tailwind Dashboard
- VWAP + Supertrend custom implementation
- Confluence Scoring System

---

## ⚠️ تنبيه

هذا نظام إشارات تعليمي. التداول مخاطرة. اختبر جيداً قبل استخدام مال حقيقي.

---

## 👨‍💻 المطور

تم التطوير بناء على طلب تحسين مشروع Haehnchen/crypto-trading-bot باستراتيجيات فعالة.

**الميزات المطلوبة وتم تنفيذها:**
- ✅ استراتيجيات أقوى وفعالة (بحث كبار المتداولين)
- ✅ إشارة بيع/شراء مع نسبة الثقة
- ✅ وقت دخول الصفقة ومدتها
- ✅ نسبة الإشارة بناء على الاستراتيجيات (مثلاً بيع 80%)

---

## 📄 الرخصة

MIT
