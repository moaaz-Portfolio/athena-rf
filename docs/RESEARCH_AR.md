# المبررات البحثية والقرارات التقنية — ATHENA RF 0.2

## لماذا CSI بدل RSSI فقط؟
RSSI هو مؤشر قوة إجمالي تقريبي، ولا يوفّر شكل الاستجابة عبر الحوامل الفرعية. ESP-IDF يتيح CSI على ESP32-S3، حيث تحمل بيانات كل حامل فرعي مركبات I/Q، مع معلومات إضافية مثل RSSI والقناة ووقت الاستقبال. يستخدم المشروع CSI خامًا ويشتق متجه سعة ثابت الطول كبداية؛ هذا استخراج أولي وليس معايرة طور أو فصلًا كاملًا لكل LTF.

مرجع رسمي: https://docs.espressif.com/projects/esp-idf/en/latest/esp32s3/api-guides/wifi-driver/wifi-vendor-features.html

## لماذا التدريب على الكمبيوتر؟
حجم الفلاش البالغ 16 MiB هو تخزين البرنامج/البيانات، وليس ذاكرة SRAM أو PSRAM. لذلك تستخدم هذه النسخة اللوحة لالتقاط CSI وإرساله عبر UDP، بينما يجري التدريب والاستدلال في Python/PyTorch على الكمبيوتر. يمكن لاحقًا اختبار نموذج كمي صغير على الجهاز بعد قياس RAM ووقت الاستدلال؛ هذا غير مفعّل في 0.2.

## بنية النموذج
- إدخال: نافذة من 64 إطار CSI، بكل إطار 64 سمة سعة مستخرجة بإعادة أخذ عينات خطية.
- معماريّة: طبقتا Conv1D لاستخراج الأنماط الزمنية ثم BiLSTM وattention pooling ثم مصنف.
- المخرجات: تصنيف النشاط من الوسوم التي جُمعت فعليًا (مثل still/walking/sitting/standing/fall/other).
- التقييم: تقسيم الجلسات الكاملة إلى تدريب/تحقق/اختبار؛ الدرجات المنشورة في metrics تخص تقسيمات التسجيلات الموجودة فقط.
- عتبة مبدئية: 0.65 لعرض فئة متوقعة؛ وإلا يعرض النظام «غير معروف». قيمة softmax ليست احتمالًا معايرًا ولا مقياسًا طبيًا.

## ما لا يعد به الإصدار
- لا يحسب عدد الأشخاص ولا يقدّر إحداثيات/هيكلًا عظميًا ثلاثي الأبعاد.
- لا يقيس نبض القلب أو معدل التنفس.
- لا يتعرّف على «السلوك» بمعناه النفسي أو التشخيصي.
- لا يُدرَّب على الصور الاصطناعية أو رسومات الواجهة؛ يحتاج تسجيلات CSI موسومة إلى جانب التسميات المرجعية المناسبة.

## مراجع تنفيذ ESP-IDF وبيانات عامة أحدث
- توثيق ESP-IDF v5.5.5 الخاص بـ ESP32-S3: https://documentation.espressif.com/esp-idf/en/v5.5.5/esp32s3/index.html
- مثال Espressif الرسمي لجمع CSI والتحليل/التدريب والتعرف على الحركة: https://github.com/espressif/esp-csi/tree/master/examples/esp-radar/console_test
- مثال رصد وجود البشر/الحركة: https://github.com/espressif/esp-csi/tree/master/examples/esp-radar/wifi_sensing_demo
- ESP-Fi HAR (مجموعة نشاط بشرية جُمعت باستخدام ESP32-C3): https://github.com/AutoSmartGroup/ESP-Fi-HAR
- EHUNAM (عدّ الأشخاص ونشاط بشري عبر بيئات وأيام متعددة؛ 72 GB تقريبًا): https://doi.org/10.6084/m9.figshare.28541225

- CSI-Bench (مستودع/benchmark لاستشعار Wi-Fi): https://github.com/johannayara/CSI-Bench
- WiRe-Breath (مراقبة التنفس عبر Wi-Fi): https://github.com/Yunpeng-Ge/WiRe-Breath
- بيانات NIST عن التنفس عبر CSI: https://catalog.data.gov/dataset/raw-data-used-to-investigate-the-use-of-wi-fi-signals-to-monitor-human-respiratory-motion
- ESP-IDF CSI API: https://docs.espressif.com/projects/esp-idf/en/latest/esp32s3/api-guides/wifi-driver/wifi-vendor-features.html
