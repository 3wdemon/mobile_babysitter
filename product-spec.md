# Топовое baby monitor приложение: спецификация

## Позиционирование

**"Премиум-функционал отдельного устройства за цену приложения, с privacy-first подходом и без подписочного грабежа"**

Целевая аудитория: родители 0-3 лет, у которых есть старый запасной смартфон (или готовы купить дешёвый Android за 50-80 USD).

## Решаемые боли (топ-10)

| # | Боль конкурентов | Решение |
|---|---|---|
| 1 | Аудио прерывается на iOS при заблокированном экране | Native VoIP-сессия (CallKit/PushKit) — система держит соединение как звонок |
| 2 | Жор батареи и cellular даже при WiFi | Жёсткий приоритет локальной WiFi-сети, adaptive bitrate, low-power режим |
| 3 | Слабое ночное видение | Активация ИК-режима через ML обработку + опциональный мягкий nightlight через экран baby-unit |
| 4 | Ложные срабатывания AI cry detection | Двухступенчатая модель: on-device детектор + контекст (время суток, фон. шум). Тренируемый на реальном плаче пользователя |
| 5 | Нет паузы алертов когда родитель в комнате | Auto-mute при BLE-близости родительского устройства к детскому |
| 6 | Алерты только на один телефон | Multi-parent broadcast: до 5 устройств одновременно (мама, папа, бабушка, няня) |
| 7 | Weekly paywall ($2.99/нед) раздражает | Прозрачная модель: free tier (1 час/день) + lifetime $29.99 ИЛИ $4.99/мес. Никаких триалов с автосписанием |
| 8 | Облако = privacy риск | End-to-end шифрование, локальный P2P по умолчанию (WiFi Direct), облако опционально |
| 9 | Dormi только Android | iOS + Android + iPad + Mac + Apple Watch + Wear OS |
| 10 | Видео перекрыто контролами | Auto-hide UI через 3 сек, gestural controls, AOD режим (только индикатор статуса) |

## Функционал (must-have)

**Видео и аудио:**

- 1080p H.265 видеопоток, адаптивный битрейт
- Ночное видение через ML enhancement (без отдельной ИК-камеры)
- Two-way talk с echo cancellation
- Wide-angle режим через крепление телефона

**Детекция и алерты:**

- On-device ML: плач (с adaptive learning под конкретного ребёнка), движение, отсутствие движения >30 сек, шум выше порога
- Smart-алерты: разные звуки для разных событий
- Snooze алертов через haptic-жест на parent-устройстве
- Background алерты через push даже при выгруженном приложении

**Сетевые сценарии (порядок fallback):**

1. WiFi Direct / P2P (без интернета)
2. Локальная WiFi сеть
3. Cellular/Internet (через TURN-сервер с E2E шифрованием)
4. Auto-reconnect при потере соединения с уведомлением

**Безопасность:**

- E2E шифрование (libsignal или WebRTC DTLS-SRTP)
- Pairing через QR-код, без облачных аккаунтов в локальном режиме
- Биометрический доступ к parent-режиму

**Энергия:**

- Baby-unit: оптимизация под зарядку, dim screen, отключение ненужных датчиков
- Parent-unit: low-power аудио-only режим, видео только по запросу
- Health check батареи с предупреждениями

## Функционал (differentiator)

- **Sleep timeline**: автоматическая запись фаз сна (бодрствование, движение, тишина) с экспортом — без подписки в отличие от Nanit
- **Voice memos для няни**: запись инструкций которые проигрываются в нужное время
- **White noise / lullabies локально**: 30+ треков встроены, без интернета
- **Multi-room**: подключение 3-4 baby-units (для близнецов или разных комнат)
- **Apple Watch / Wear OS**: индикатор статуса и quick-listen без доставания телефона
- **Family sharing**: invite link для второго родителя без передачи аккаунта
- **Offline mode**: всё работает без интернета вообще (WiFi Direct + локальная запись)
- **Wind-down таймер**: автоматическое включение белого шума по расписанию

## Чего НЕ делать (для фокуса)

- Не добавлять wearable health-датчики — это территория Owlet с FDA-регуляцией
- Не делать собственное hardware — это другой бизнес
- Не агрессивный paywall с триалами и автосписаниями — это убивает рейтинг
- Не делать тяжёлый AI sleep coaching — это уже занято Huckleberry/Nanit

## Технический стек (черновик)

- WebRTC для P2P видео/аудио (DataChannel + MediaStream)
- CoreML / TensorFlow Lite для on-device cry detection
- AVAudioSession (iOS) + Foreground Service (Android) для надёжного background аудио
- Bonjour/mDNS для local discovery
- Опциональный TURN-сервер на Cloudflare (дёшево)
- Push: APNS + FCM с VoIP-приоритетом

## Минимальный MVP (3-4 месяца)

1. P2P видео/аудио iOS↔Android через WebRTC
2. Background аудио через VoIP-сессии
3. Базовая cry/motion detection
4. Pairing через QR
5. Two-way talk
6. Push-алерты
7. Lifetime purchase + 1 час/день free

Этого достаточно чтобы выйти на рынок с лучшей надёжностью чем Bibino/Annie, и закрыть основные жалобы из App Store reviews.

## Метрики успеха

- Crash-free sessions > 99.5%
- Uptime ночной сессии (6+ часов без переподключения) > 95%
- App Store rating > 4.6 (у Bibino сейчас 4.5, у Annie 4.7)
- Conversion free→paid > 8%

## Краткий контекст рынка

- Объём рынка baby monitor: 1.95 млрд USD в 2026, CAGR 6.95%
- Smart baby monitor сегмент: CAGR 8.4%
- AI baby monitor сегмент: CAGR 12.5%
- Основные конкуренты-приложения: Cloud Baby Monitor, Annie Baby Monitor, Bibino, Dormi, Baby Monitor 3G, BabyCam
- Премиум-устройства: Nanit Pro ($299), Owlet Dream Duo 3 ($399)
