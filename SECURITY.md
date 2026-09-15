# 🔒 سياسة الأمان - Security Policy

## اكتشاف الثغرات الأمنية

إذا اكتشفت ثغرة أمنية، يرجى **عدم** فتح Issue علني.

بدلاً من ذلك:
1. أرسل بريد آمن إلى: `frasalsafeer@gmail.com`
2. صف المشكلة بالتفصيل
3. اترك وقتاً معقولاً للإصلاح (3-5 أيام)

## ممارسات الأمان

### 1. إدارة المفاتيح والكلمات المرور

```
✅ افعل:
- استخدم متغيرات البيئة للكلمات المرور
- استخدم مديري كلمات المرور
- غيّر كلمات المرور بشكل دوري
- استخدم كلمات مرور قوية (20+ حرف)

❌ لا تفعل:
- لا تلتزم كلمات مرور في الكود
- لا تشارك الـ Secrets مع أحد
- لا تكتبها في أسطر التعليقات
- لا تستخدم كلمات مرور ضعيفة
```

### 2. المتطلبات الأمنية

```json
{
  "api_key_length": "32+ حرف",
  "password_length": "20+ حرف",
  "password_format": "حروف + أرقام + رموز",
  "tls_version": "1.3 أو أعلى",
  "encryption": "SHA-256 على الأقل"
}
```

### 3. متغيرات البيئة الحساسة

```bash
# ❌ خطأ - لا تفعل هذا:
const API_KEY = "abc123xyz"  // في الكود مباشرة

# ✅ صحيح - افعل هذا:
const API_KEY = process.env.GEMINI_API_KEY
```

### 4. قائمة التحقق قبل النشر

- [ ] تم مراجعة جميع الـ Secrets
- [ ] لا توجد بيانات حساسة في الـ commits
- [ ] تم تفعيل 2FA على الحساب
- [ ] تم استخدام SSH Keys للـ Git
- [ ] تم اختبار جميع البيانات الحساسة

## الثغرات المعروفة

لا توجد ثغرات أمنية معروفة حالياً.

**آخر تحديث الأمان:** 2026-09-15

## الامتثال

يتبع هذا المشروع:
- ✅ OWASP Top 10
- ✅ CWE/SANS Top 25
- ✅ GitHub Security Best Practices
- ✅ Data Protection Regulations

## المراجع الأمنية

- [OWASP Security Guidelines](https://owasp.org)
- [GitHub Security Best Practices](https://docs.github.com/en/code-security)
- [Node.js Security Checklist](https://nodejs.org/en/docs/guides/security)
- [Environment Variables Best Practices](https://12factor.net/config)

---

**آخر تحديث:** 2026-09-15
