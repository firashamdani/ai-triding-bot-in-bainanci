# 🤖 AI Trading Bot في Binance

تطبيق ذكي للتداول بواسطة الذكاء الاصطناعي (Gemini AI) مع واجهة مستخدم حديثة باستخدام React و Express.

## 🚀 الميزات

- **تحليل ذكي:** استخدام Gemini AI لتحليل أسواق التداول
- **واجهة مستخدم سهلة:** بناؤها بـ React و Tailwind CSS
- **آمنة:** إدارة بيانات الاعتماد من خلال متغيرات البيئة
- **مراقبة متقدمة:** رسوم بيانية وتنبيهات فعلية

## 📋 المتطلبات

- Node.js 20+
- npm أو yarn
- مفتاح API من Google Gemini
- بيانات اعتماد Binance

## 🔧 الإعداد المحلي

### 1. استنساخ المشروع
```bash
git clone https://github.com/firashamdani/ai-triding-bot-in-bainanci.git
cd ai-triding-bot-in-bainanci
```

### 2. تثبيت المتطلبات
```bash
npm install
```

### 3. تكوين متغيرات البيئة
```bash
cp .env.example .env.local
```

ثم عدّل ملف `.env.local` بإضافة بيانات الاعتماد الحقيقية:
```env
GEMINI_API_KEY=your-actual-api-key
APP_URL=http://localhost:5173
ADMIN_EMAIL=your-admin-email@example.com
ADMIN_PASSWORD=your-secure-password
TRADER_EMAIL=your-trader-email@example.com
TRADER_PASSWORD=your-secure-password
```

### 4. تشغيل التطبيق محلياً
```bash
npm run dev
```

التطبيق سيكون متاحاً على `http://localhost:5173`

## 🏗️ البناء والإنتاج

### بناء المشروع
```bash
npm run build
```

### تشغيل في الإنتاج
```bash
npm run start
```

### التحقق من الأخطاء
```bash
npm run lint
```

## 🔒 أمان البيانات

⚠️ **مهم جداً:** 
- لا تلتزم كلمات المرور أو مفاتيح API إلى Git
- استخدم ملف `.env.local` محلياً
- في الإنتاج، قم بتعيين متغيرات البيئة في منصة النشر (مثل GitHub Secrets أو Cloud Run)

## 🚢 النشر

### النشر على Google Cloud Run
```bash
gcloud run deploy ai-trading-bot \
  --source . \
  --platform managed \
  --region us-central1 \
  --set-env-vars GEMINI_API_KEY=your-key
```

### النشر على منصات أخرى
قم بضبط ملف `package.json` و `.github/workflows/deploy.yml` حسب احتياجات منصة النشر الخاصة بك.

## 📊 ملفات المشروع

```
.
├── src/                    # كود مصدر React
├── server.ts              # خادم Express الرئيسي
├── package.json           # المتطلبات
├── .env.example           # مثال على متغيرات البيئة
├── .gitignore             # ملفات مستثناة من Git
└── dist/                  # ملفات مبنية (للإنتاج)
```

## 🔄 GitHub Actions

يتم تشغيل الـ workflow التالية تلقائياً:
- **Build & Test:** عند كل push أو PR
- **Deploy:** عند push إلى `main` فقط

تأكد من إضافة الأسرار المطلوبة في GitHub Secrets:
- `GEMINI_API_KEY`
- `APP_URL`
- `ADMIN_EMAIL` / `ADMIN_PASSWORD`
- `TRADER_EMAIL` / `TRADER_PASSWORD`

## 📝 التطوير

### إنشاء فرع جديد
```bash
git checkout -b feature/اسم-الميزة
```

### إرسال تغييرات
```bash
git add .
git commit -m "feat: وصف التغيير"
git push origin feature/اسم-الميزة
```

ثم أنشئ Pull Request على GitHub.

## 🐛 الدعم والمشاكل

للإبلاغ عن مشاكل أو اقتراحات، يرجى فتح Issue في GitHub.

## 📄 الترخيص

هذا المشروع مفتوح المصدر.

---

**آخر تحديث:** 2026-09-15
