# كيف تنقل المشروع إلى frmach

## الطريقة 1: من GitHub (سهلة)
1. اذهب إلى https://github.com/Annes38/ClipForge-AI/tree/arena/01a0313c-clipforge-ai
2. اضغط Code → Download ZIP
3. فك الضغط
4. اذهب إلى https://github.com/Annes38/frmach
5. اضغط Add file → Upload files → ارفع كل الملفات
6. Commit

## الطريقة 2: من جهازك (Git)
```bash
# استنسخ المشروع الحالي
git clone https://github.com/Annes38/ClipForge-AI.git
cd ClipForge-AI
git checkout arena/01a0313c-clipforge-ai

# أضف frmach كـ remote
git remote add frmach https://github.com/Annes38/frmach.git

# ادفع إلى frmach
git push frmach arena/01a0313c-clipforge-ai:main --force
```

## الطريقة 3: انتظر إعادة ربط GitHub
- اذهب إلى Arena → Settings → GitHub → Disconnect
- ثم Connect again واختر "All repositories" أو على الأقل frmach و ClipForge-AI
- ثم قل لي "حاول مجدداً" وسأدفع مباشرة

## ما تم حفظه في frmach حالياً؟
المشروع كامل:
- 6 منصات (Binance, Bybit, OKX, Coinbase, Kraken, Bitget)
- 3 استراتيجيات احترافية مع نسبة ثقة
- WebSocket LIVE كل ثانية
- بيانات حقيقية من المنصات
- Dashboard عربي

## الملفات المهمة
- src/ - كود المشروع
- public/ - واجهة الموقع
- exchanges/ - 6 مشاريع منفصلة
- docs/ - توثيق
