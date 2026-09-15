import React from 'react';
import {
  ShieldCheck,
  TrendingUp,
  Cpu,
  Layers,
  Terminal,
  Lock,
  ArrowRight,
  CheckCircle,
  AlertTriangle,
  Play,
  BarChart2,
  Zap,
} from 'lucide-react';
import { Language } from '../types';
import { translations } from '../i18n';

interface LandingPageProps {
  lang: Language;
  onLaunchStation: () => void;
  onDirectLogin: (email: string, pass: string) => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({
  lang,
  onLaunchStation,
  onDirectLogin,
}) => {
  const t = translations[lang];

  return (
    <div className="min-h-screen bg-[#0b0e14] text-slate-100 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-6xl mx-auto space-y-16">
        {/* Hero Section */}
        <div className="text-center space-y-6 pt-6 sm:pt-12">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-semibold tracking-wide">
            <Cpu className="w-4 h-4" />
            <span>Binance Spot Automated Quantitative Trading Architecture</span>
          </div>

          <h1 className="text-3xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-white max-w-4xl mx-auto leading-tight">
            {t.landingTitle}
          </h1>

          <p className="text-sm sm:text-lg text-slate-400 max-w-3xl mx-auto leading-relaxed">
            {t.landingSubtitle}
          </p>

          <div className="flex flex-wrap items-center justify-center gap-4 pt-4">
            <button
              onClick={onLaunchStation}
              className="px-6 py-3.5 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-400 hover:from-amber-400 hover:to-yellow-300 text-slate-950 font-bold text-sm shadow-xl shadow-amber-500/20 flex items-center gap-2 transition-all active:scale-95"
            >
              <Play className="w-4 h-4 fill-slate-950" />
              <span>{t.loginToDashboard}</span>
              <ArrowRight className="w-4 h-4" />
            </button>

            <button
              onClick={() => onDirectLogin('trader@trading.ai', 'Trader@AI2026!')}
              className="px-6 py-3.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 font-semibold text-sm flex items-center gap-2 transition-colors"
            >
              <Zap className="w-4 h-4 text-amber-400" />
              <span>{lang === 'ar' ? 'دخول فوري بحساب متداول تجريبي' : 'One-Click Trader Demo'}</span>
            </button>
          </div>
        </div>

        {/* Demo Credentials Box */}
        <div className="max-w-3xl mx-auto bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-2xl">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
            <div className="flex items-center gap-2">
              <Lock className="w-4 h-4 text-amber-400" />
              <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
                {lang === 'ar' ? 'حسابات تجريبية مهيأة للاختبار الفوري' : 'Pre-configured Test Environments'}
              </span>
            </div>
            <span className="text-[11px] text-emerald-400 font-mono-num font-semibold">Ready to Test</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-3.5 rounded-xl bg-slate-800/60 border border-slate-700/60 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold text-slate-200">Trader Role (المتداول)</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 font-mono-num">TRADER</span>
                </div>
                <p className="text-[11px] text-slate-400 font-mono-num">trader@trading.ai</p>
                <p className="text-[11px] text-slate-400 font-mono-num">Pass: Trader@AI2026!</p>
              </div>
              <button
                onClick={() => onDirectLogin('trader@trading.ai', 'Trader@AI2026!')}
                className="mt-3 w-full py-1.5 rounded-lg bg-blue-600/30 hover:bg-blue-600/50 text-blue-300 text-xs font-semibold border border-blue-500/40 transition-colors"
              >
                {lang === 'ar' ? 'تسجيل دخول المتداول' : 'Login as Trader'}
              </button>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-800/60 border border-slate-700/60 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold text-slate-200">Admin Role (المشرف)</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 font-mono-num">ADMIN</span>
                </div>
                <p className="text-[11px] text-slate-400 font-mono-num">admin@trading.ai</p>
                <p className="text-[11px] text-slate-400 font-mono-num">Pass: Admin@AI2026!</p>
              </div>
              <button
                onClick={() => onDirectLogin('admin@trading.ai', 'Admin@AI2026!')}
                className="mt-3 w-full py-1.5 rounded-lg bg-amber-500/30 hover:bg-amber-500/50 text-amber-300 text-xs font-semibold border border-amber-500/40 transition-colors"
              >
                {lang === 'ar' ? 'تسجيل دخول المشرف' : 'Login as Admin'}
              </button>
            </div>
          </div>
        </div>

        {/* Feature Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <h3 className="text-base font-bold text-slate-200">{t.featureNoWithdrawal}</h3>
            <p className="text-xs text-slate-400 leading-relaxed">{t.featureNoWithdrawalDesc}</p>
          </div>

          <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/30 flex items-center justify-center text-blue-400">
              <TrendingUp className="w-5 h-5" />
            </div>
            <h3 className="text-base font-bold text-slate-200">{t.featureMultiTimeframe}</h3>
            <p className="text-xs text-slate-400 leading-relaxed">{t.featureMultiTimeframeDesc}</p>
          </div>

          <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <BarChart2 className="w-5 h-5" />
            </div>
            <h3 className="text-base font-bold text-slate-200">{t.featureRiskEngine}</h3>
            <p className="text-xs text-slate-400 leading-relaxed">{t.featureRiskEngineDesc}</p>
          </div>

          <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-3">
            <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/30 flex items-center justify-center text-purple-400">
              <Terminal className="w-5 h-5" />
            </div>
            <h3 className="text-base font-bold text-slate-200">{t.featureBacktestWalkForward}</h3>
            <p className="text-xs text-slate-400 leading-relaxed">{t.featureBacktestWalkForwardDesc}</p>
          </div>
        </div>

        {/* 7-Step Institutional Gating for Live Trading */}
        <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-6">
          <div className="flex items-center gap-3">
            <Lock className="w-5 h-5 text-amber-400" />
            <div>
              <h2 className="text-lg font-bold text-slate-200">
                {lang === 'ar' ? 'بروتوكول الأمان الصارم قبل تفعيل التداول الحقيقي' : 'The 7-Step Live Trading Safety Gate'}
              </h2>
              <p className="text-xs text-slate-400">
                {lang === 'ar'
                  ? 'لا يسمح النظام ببدء التداول بأموال حقيقية إلا بعد استيفاء جميع الشروط التالية'
                  : 'The system strictly prohibits executing real orders until every security requirement is validated'}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {[
              { id: 1, textAr: 'ربط مفاتيح Binance API عبر الخادم الخلفي', textEn: 'Binance API Keys connected via backend proxy' },
              { id: 2, textAr: 'اجتياز اختبار الاتصال والكمون بنجاح', textEn: 'Latency ping & authentication tests passed' },
              { id: 3, textAr: 'التحقق الصارم من انعدام صلاحية السحب (CanWithdraw=false)', textEn: 'Zero-withdrawal permission verified (canWithdraw=false)' },
              { id: 4, textAr: 'تحديد رأس المال والمخاطرة بدقة (1-2% لكل صفقة)', textEn: 'Capital allocation & risk limits firmly configured' },
              { id: 5, textAr: 'تفعيل إشارات الوقف الوقائي والأهداف المتعددة', textEn: 'Stop loss and target ratios actively configured' },
              { id: 6, textAr: 'موافقة المشرف على بوابة التداول الحقيقي للمنصة', textEn: 'Global Live Trading gate unlocked by Administrator' },
              { id: 7, textAr: 'تأكيد المستخدم اليدوي وتفعيل زر التداول الحقيقي', textEn: 'Explicit manual confirmation and risk disclaimer acceptance' },
            ].map((step) => (
              <div key={step.id} className="p-3 rounded-xl bg-slate-900/80 border border-slate-800 flex items-start gap-2.5">
                <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <span className="text-xs text-slate-300">
                  {lang === 'ar' ? step.textAr : step.textEn}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Disclaimer Notice */}
        <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <p className="text-xs text-slate-300 leading-relaxed">{t.disclaimer}</p>
        </div>
      </div>
    </div>
  );
};
