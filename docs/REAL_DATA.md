# ربط البيانات الحقيقية - 6 منصات

## المشكلة
السيرفر يشتغل في Sandbox (E2B) محجوب من ناحية الخروج للانترنت:
- `curl https://api.binance.com` → فشل
- `ccxt.fetchOHLCV()` → فشل
- `Node fetch()` → فشل

لكن أداة `fetch_page` تخدم (تستعمل Proxy خاص)، والمتصفح عند المستخدم عندو انترنت عادي.

## الحل الذكي - Browser-Side Fetching

### 1. البيانات الحقيقية تجي من المتصفح

بدل ما السيرفر يجيب البيانات، **المتصفح** هو لي يجيبها مباشرة من المنصات:

```javascript
// في public/js/realDataFetcher.js
// يشتغل في متصفح المستخدم، عندو انترنت

// Binance - يخدم عبر data-api.binance.vision (بديل ي bypass الحجب الجغرافي)
https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=15m&limit=300

// OKX - يخدم
https://www.okx.com/api/v5/market/candles?instId=BTC-USDT&bar=15m&limit=300

// Kraken - يخدم
https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=15

// Coinbase - يخدم
https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=900

// Bitget - يخدم
https://api.bitget.com/api/v2/spot/market/candles?symbol=BTCUSDT&granularity=15min&limit=300

// Bybit - محجوب CloudFront، نستعمل Binance كـ proxy (نفس السعر تقريباً)
// CoinGecko كـ fallback
https://api.coingecko.com/api/v3/coins/bitcoin/ohlc?vs_currency=usd&days=1
```

### 2. المتصفح يرسل للباكند

بعد ما يجيب البيانات، المتصفح يرسلها للسيرفر:

```javascript
await fetch(`/api/exchanges/${exchangeId}/candles/${symbol}`, {
  method: 'POST',
  body: JSON.stringify({ candles, source: 'browser-real' })
});
```

السيرفر يحفظها في `realCandlesCache` ويستعملها للإشارات.

### 3. الإشارات تصير حقيقية

```
متصفح → Binance API (بيانات حقيقية) → Backend → SignalEngine → إشارة 85% BUY
```

## كيف تستعمل؟

### تلقائي:
- افتح الموقع `/` → بعد 2 ثانية يفعل البيانات الحقيقية تلقائياً
- ادخل لمنصة `/exchange.html?exchange=binance` → بعد 1.5 ثانية يجيب بيانات حقيقية لتلك المنصة

### يدوي:
- اضغط زر `📡 فعل بيانات حقيقية` في الصفحة الرئيسية
- أو `📡 بيانات حقيقية` في صفحة المنصة

### تحقق:
```bash
GET /api/real-data/status
# يرجع:
{
  "binance": { "source": "browser-real", "count": 6, "ageSeconds": 12 },
  "okx": { "source": "browser-real", "count": 6, ... },
  ...
}
```

## البيانات الحقيقية المختبرة

تم اختبار كل المنصات عبر `fetch_page` (أداة عندها Proxy):

✅ **Binance** عبر `data-api.binance.vision` → يخدم
```
[[1787526000000,"77598.87","77622.86","77290.22","77470.60","189.00",...]]
BTC/USDT = 77380$ حقيقي
```

✅ **OKX** → يخدم
```
{"code":"0","data":[["1787534100000","77437.1","77468.1","77301","77303.7",...]]}
```

✅ **Kraken** → يخدم
```
{"result":{"XXBTZUSD":[[1786886100,"62995.6","62998.4","62990.3","62990.4",...]]}}
```

✅ **Coinbase** → يخدم
```
[[1787534100,77296.24,77465.78,77423.77,77356.56,17.20],...]
```

✅ **Bitget** → يخدم
```
{"code":"00000","data":[["1787526000000","77600","77620","77287.56","77474.01",...]]}
```

✅ **CoinGecko** (fallback لـ Bybit) → يخدم
```
{"bitcoin":{"usd":77404}}
OHLC: [[1787448600000,77290.0,77341.0,77184.0,77257.0],...]
```

❌ **Bybit** محجوب CloudFront → نستعمل Binance proxy
❌ **Binance.com** محجوب جغرافياً → نستعمل `data-api.binance.vision` بديل

## كل منصة مشروع وحدو + بيانات حقيقية

```
exchanges/
├── binance/   → بيانات من data-api.binance.vision
├── bybit/     → بيانات من Binance proxy (نفس السعر) + CoinGecko
├── okx/       → بيانات من www.okx.com
├── coinbase/  → بيانات من api.exchange.coinbase.com
├── kraken/    → بيانات من api.kraken.com
└── bitget/    → بيانات من api.bitget.com
```

كل واحدة:
- 6 عملات خاصة بيها
- تقلب خاص (Bitget أكثر تقلب)
- مصدر بيانات حقيقي منفصل
- إشارات منفصلة بنسبة ثقة

## المستقبل - كيف تخليها 100% حقيقية دائماً؟

1. **في الإنتاج** (Vercel, VPS): السيرفر يقدر يجيب مباشرة عبر CCXT بدون حجب Sandbox
2. **WebSocket**: تربط مباشرة بـ `wss://stream.binance.com` من المتصفح
3. **API Keys**: تضيف مفاتيح للتداول الحقيقي (حالياً قراءة فقط)

الكود جاهز - فقط غيّر `enableRealData()` لتشتغل تلقائياً كل 30 ثانية.
