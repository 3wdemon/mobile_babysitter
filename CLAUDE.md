# Mobile Babysitter

P2P baby monitor app: 2 смартфона, без облачной зависимости, privacy-first.

## Контекст проекта

См. `product-spec.md` в корне (рядом с этим файлом) — там полное описание продукта, конкурентный анализ и MVP scope.

Ключевое позиционирование: премиум-функционал отдельного устройства за цену приложения, с честной моделью монетизации без weekly paywall.

## Стек

**React Native bare** (без Expo, чтобы был доступ к нативным модулям CallKit/ConnectionService).

### Обоснование (решение по DMY-5)

| Критерий | Выбор |
|---|---|
| Язык | TypeScript — прямой transfer с JS-опыта (Cypress) |
| WebRTC | `react-native-webrtc` — зрелая библиотека |
| iOS background audio | `react-native-callkeep` (CallKit + PushKit VoIP) |
| Android background audio | `react-native-incall-manager` + foreground service через native module |
| ML on-device | TensorFlow Lite через `react-native-fast-tflite` |
| Local discovery | `react-native-zeroconf` (mDNS/Bonjour) |
| QR | `react-native-vision-camera` + `react-native-qrcode-svg` |
| E2E web-частей | Playwright (см. .claude/agents/qa.md) |
| E2E native-частей | Detox (определимся в отдельной issue) |
| Storage | MMKV (быстрый, надёжный) |
| Push | `@react-native-firebase/messaging` (FCM) + native APNS bridge |
| Биометрия | `react-native-keychain` + `react-native-biometrics` |
| Покупки | `react-native-iap` |

### Версии (зафиксировать в DMY-13)

- Node: 22 LTS (Active LTS; зафиксировано в `.nvmrc`, `engines.node >= 22.11.0`). Node 20 — EOL, не используем.
- React Native: latest stable (на момент init)
- iOS deployment target: 14.0+
- Android minSdkVersion: 26 (Android 8.0)

### Что не используем

- Expo (нужны нативные модули вне Expo Go)
- Cypress (используем Playwright — см. [feedback memory])
- Redux (для соло-проекта overkill, начинаем с Zustand или React Context)

## Workflow

### Task tracker

Linear workspace: **Dmytro Ripa** → Project **Mobile Babysitter MVP**.

Каждая задача в работе должна иметь линковку на Linear issue в title PR: `feat: <description> (DMY-NN)`.

### Branch naming

`<type>/<dmy-id>-<short-slug>`, например:

- `feat/dmy-3-webrtc-handshake`
- `fix/dmy-12-ios-background-audio`
- `chore/dmy-7-ci-setup`

### Commit messages

Conventional Commits: `type(scope): description`.

Типы: `feat`, `fix`, `chore`, `refactor`, `test`, `docs`.

### PR требования

- Title содержит `(DMY-NN)`
- Description со ссылкой на Linear issue
- Все тесты проходят
- Линтеры на изменённых файлах чисто
- Reviewer-agent дал approve

## Агенты

Архитектура — 4 субагента в `.claude/agents/`:

1. **pm.md** — триаж Linear, декомпозиция, acceptance criteria
2. **dev.md** — issue → code → Draft PR
3. **qa.md** — тесты + acceptance check
4. **reviewer.md** — строгий ревью в стиле review-quill

Полный flow:

```
Linear Issue → PM (acceptance) → Dev (PR) → QA (tests) → Reviewer (approve) → Merge → Done
```

## Конвенции кода

### Структура проекта

```
src/
  components/         # Переиспользуемые UI-компоненты
  screens/            # Экраны приложения
  features/           # Бизнес-фичи (pairing/, webrtc/, ml/, alerts/)
  services/           # Сервисный слой (api, storage, push)
  hooks/              # Кастомные React-хуки
  types/              # TS-типы
  utils/              # Утилиты
  native/             # Нативные мосты (Swift/Kotlin)
__tests__/            # Unit-тесты рядом с кодом или здесь
tests/
  e2e/                # Playwright-тесты (web-вьюхи)
  detox/              # Detox-тесты (native)
```

### Линтеры

- ESLint с `@react-native` config
- TypeScript strict mode
- Prettier для форматирования
- Запуск **только на изменённых файлах** (не на всём репо)

### Тесты

- Unit: Jest + React Native Testing Library
- Integration: Jest для сервисов с моками
- E2E web: Playwright (`tests/e2e/`)
- E2E native: Detox (`tests/detox/`)
- Минимальное покрытие: 70% (statements + branches)

### Имена

- Компоненты: PascalCase (`BabyMonitor.tsx`)
- Файлы хуков: camelCase с `use` (`useWebRTC.ts`)
- Сервисы: camelCase (`pairingService.ts`)
- Константы: SCREAMING_SNAKE_CASE

## Что НЕ делать

- Не добавлять wearable health-датчики (территория Owlet с FDA)
- Не делать собственное hardware
- Не делать агрессивный paywall с триалами и автосписаниями
- Не вводить тяжёлый AI sleep coaching (занято Huckleberry/Nanit)

## Поведение агентов при неопределённости (ночные прогоны)

Если ты не уверен в шаге и обычно бы попросил разрешения у человека:

1. НЕ блокируйся в ожидании ответа
2. Создай комментарий к текущей Linear issue с описанием неопределённости
3. Поставь на issue label `needs-human-review`
4. Зафиксируй текущий прогресс (коммит + push в draft PR)
5. Если задача полностью заблокирована — перейди к следующей независимой задаче из cycle
6. Если все задачи cycle заблокированы — оставь сводный комментарий в проекте Mobile Babysitter MVP и завершай работу

Не делай деструктивных операций без подтверждения человека:
- rm с критичными путями
- git push --force / git reset --hard
- удаление файлов вне scope текущей задачи
- любые операции с секретами (.env, ключи)
