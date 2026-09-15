# 🚀 دليل النشر - Deployment Guide

## خطوات النشر الآمن

### 1. إعداد GitHub Secrets

اذهب إلى: **Settings → Secrets and variables → Actions**

أضف الـ Secrets التالية:

```
GEMINI_API_KEY          → مفتاح API من Google Gemini
APP_URL                 → رابط الموقع الفعلي (مثل https://yourapp.com)
ADMIN_EMAIL             → بريد مسؤول الحساب
ADMIN_PASSWORD          → كلمة مرور الإدارة (قوية جداً)
TRADER_EMAIL            → بريد حساب التاجر
TRADER_PASSWORD         → كلمة مرور التاجر (قوية جداً)
```

### 2. التحقق من الأمان

✅ **تم القيام به:**
- ملف `.env.example` يحتوي على placeholder فقط (بدون كلمات مرور حقيقية)
- ملف `.gitignore` يستثني `.env*` من Git
- متغيرات البيئة الحساسة في GitHub Secrets فقط
- GitHub Actions Workflow جاهز للنشر التلقائي

### 3. بدء النشر

#### الخطوة 1: أضف Secrets
```
اذهب إلى GitHub → Settings → Secrets → اضغط "New repository secret"
```

#### الخطوة 2: انتظر Workflow
عند push إلى `main`:
```bash
git add .
git commit -m "deploy: push to main"
git push origin main
```

#### الخطوة 3: راقب البناء
اذهب إلى: **Actions** tab في GitHub

### 4. خيارات النشر

#### خيار A: Google Cloud Run
```bash
gcloud run deploy ai-trading-bot \
  --source . \
  --platform managed \
  --region us-central1 \
  --set-env-vars GEMINI_API_KEY=$GEMINI_API_KEY,\
APP_URL=https://ai-trading-bot.run.app \
  --allow-unauthenticated
```

#### خيار B: Vercel
```bash
npm install -g vercel
vercel --prod
```

#### خيار C: Netlify
```bash
npm install -g netlify-cli
netlify deploy --prod --dir=dist
```

#### خيار D: خادم Linux عادي
```bash
# على الخادم:
git clone https://github.com/firashamdani/ai-triding-bot-in-bainanci.git
cd ai-triding-bot-in-bainanci
npm install
npm run build

# استخدم PM2 للإدارة:
npm install -g pm2
pm2 start dist/server.cjs --name "trading-bot"
```

## 🔒 إجراءات الأمان المهمة

### قبل النشر:
- [ ] تحقق أن جميع Secrets تم إضافتها
- [ ] لا توجد كلمات مرور في الـ commits
- [ ] التحقق من أن `NODE_ENV=production`

### بعد النشر:
- [ ] اختبر جميع الميزات
- [ ] تحقق من السجلات (Logs) للأخطاء
- [ ] راقب استهلاك الموارد
- [ ] اختبر تسجيل الدخول

## 📊 مراقبة النشر

### عرض السجلات
```bash
# GitHub Actions
اذهب إلى: Actions → آخر Workflow

# Google Cloud Run
gcloud run logs read ai-trading-bot

# خادم Linux
pm2 logs trading-bot
```

### التحديثات التلقائية
عند كل push إلى `main`:
1. ✅ يتم فحص الكود (Lint)
2. ✅ يتم البناء (Build)
3. ✅ يتم النشر (Deploy)

## 🆘 استكشاف الأخطاء

### خطأ: "GEMINI_API_KEY is missing"
```
✅ الحل: أضف GEMINI_API_KEY إلى GitHub Secrets
```

### خطأ: "Port 5000 already in use"
```
✅ الحل: استخدم منفذ آخر أو قتل العملية السابقة
kill $(lsof -t -i:5000)
```

### خطأ: "Cannot find module"
```
✅ الحل: أعد تثبيت المتطلبات
npm ci
npm run build
```

## 📝 ملاحظات مهمة

⚠️ **التحذيرات الأمنية:**
- لا تشارك Secrets مع أحد
- غيّر كلمات المرور بشكل دوري
- استخدم VPN/SSH Keys للوصول الآمن
- راجع Audit Logs بانتظام

✅ **أفضل الممارسات:**
- استخدم HTTPS دائماً
- فعّل 2FA على الحساب
- نسخ احتياطية منتظمة
- مراقبة الأداء والأمان

---

**آخر تحديث:** 2026-09-15
**الإصدار:** 1.0.0
