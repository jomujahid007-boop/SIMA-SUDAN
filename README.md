# سِمة | SIMA — منصة الخدمات السودانية

مشروع مستقل بالكامل عن أي تطبيق آخر.

## بيئة المشروع
- GitHub: `jomujahid007-boop/SIMA-SUDAN`
- Supabase project: `uzsmskwjtrffrtbvkdli`
- Supabase URL: `https://uzsmskwjtrffrtbvkdli.supabase.co`
- Region: `ap-south-1` (Mumbai)
- Frontend key: Supabase publishable key only. No service-role key is stored in this repository.

## قرارات المنتج
- الاسم: سِمة | SIMA
- السوق: السودان
- رسوم الإعلان: 20,000 SDG
- وسيلة الدفع: بنكك؛ التحقق يدوي من لوحة الإدارة قبل النشر
- أرقام الهاتف: إدخال محلي سوداني في الواجهة، وتحويلها داخلياً إلى صيغة +249 للمصادقة
- المدن والمحليات: 22 مدينة رئيسية، مرتبة حسب أولوية الإطلاق؛ جميعها غير مفعلة افتراضياً حتى يختار المشرف المدن التي سيبدأ بها
- الأحياء: تدار بشكل منفصل من قاعدة البيانات؛ لم يتضمن المصدر الإداري المفتوح بيانات أحياء تفصيلية، لذلك لا يتم اختلاقها

## البنية
- `index.html`: واجهة الجمهور وتسجيل مقدمي الخدمات وإرسال الإعلانات وإثبات بنكك
- `admin.html`: لوحة الإدارة
- `sima-config.js`: عنوان مشروع سِمة ومفتاح publishable العام فقط
- `service-worker.js`: PWA cache خاص باسم `sima-shell-*`
- `assets/`: هوية ورسومات سِمة
- Supabase tables: profiles, categories, cities, districts, listings, listing_payments, notifications, site_settings
- Storage buckets: sima-listing-images (public), sima-payment-proofs (private)

## الأمان
- RLS مفعّل على كل جداول `public`
- صلاحية الإدارة تعتمد على قائمة خاصة `private.admin_users` غير مكشوفة للـ Data API
- لا تضع مفاتيح `service_role` أو `sb_secret_*` في ملفات المتصفح أو GitHub
- لا تُنشر الإعلانات إلا بعد اعتماد التحويل من الإدارة

## بيانات التقسيم الإداري
قائمة المدن الحالية مختصرة إلى 22 مدينة رئيسية لتسهيل إطلاق الخدمة. تشمل القائمة الدامر وبربر ضمن ولاية نهر النيل. جميع المدن غير مفعلة افتراضياً. الأحياء تُضاف من لوحة الإدارة عند الحاجة ولا تُنشأ تلقائياً أو بالتخمين.

## قبل الإطلاق العام
1. إعداد مزود SMS في Supabase Auth لتفعيل تسجيل/دخول الهاتف بكلمة مرور مع تأكيد رقم الهاتف.
2. إنشاء حساب إدارة، ثم إضافة معرّف المستخدم إلى `private.admin_users` من خلال إعداد آمن.
3. إدخال اسم ورقم حساب بنكك من لوحة الإدارة.
4. مراجعة بيانات الأحياء وإضافتها للمدن التي سيتم تفعيلها.
5. تفعيل GitHub Pages من إعدادات المستودع واختيار GitHub Actions.
