---
title: Підтримка браузерів
---
# Підтримка браузерів
> Які браузери підтримує Zilventor, і які саме функції потребують браузера родини Chromium.

**Застосовується до:** усіх документів

## Що це робить

Zilventor — це CAD-інструмент на основі браузера без серверного зберігання документів: йому
потрібні дві функції браузера, щоб взагалі працювати — сховище **Origin Private File System
(OPFS)** та **модульні Web Workers**. Також застосунок має обслуговуватися через **HTTPS або
localhost**. Якщо чогось із цього немає, Zilventor показує заставку «Browser not supported»
замість завантаження застосунку з таким текстом:

> "ZilInventor requires features that are not available in your current browser: Origin Private
> File System (OPFS) storage and module Web Workers."

<!-- SCREENSHOT: the "Browser not supported" splash screen shown when OPFS or module Web Workers are missing — TODO follow-up -->

## Підтримувані браузери

| Браузер | Мінімальна версія |
|---|---|
| Google Chrome | 86+ |
| Microsoft Edge | 86+ |
| Mozilla Firefox | 111+ |

**Safari не підтримується.** Його немає в переліку підтримуваних браузерів на заставці, і
Zilventor у ньому не працює.

## Доступність функцій

Більшість функцій Zilventor працюють однаково в усіх трьох підтримуваних браузерах. Одна функція
доступна лише в браузерах на основі Chromium:

| Функція | Працює у |
|---|---|
| Новий / Відкрити / Зберегти / Зберегти як | Усі підтримувані браузери (Chrome, Edge, Firefox) — використовує File System Access API там, де він доступний, і автоматично переходить на звичайний вибір файлу / завантаження там, де його немає |
| Імпорт з Inventor | Лише браузери родини Chromium (Chrome, Edge, Brave, Arc) |

Імпорту з Inventor потрібно одразу обійти все дерево каталогу експортованого проєкту, що
вимагає `showDirectoryPicker` — API, доступний лише в Chromium. У браузерах без нього (Firefox)
пункт **Імпорт з Inventor** просто вимкнено. Його підказка говорить:

> "Import from Inventor requires Chrome, Edge, Brave, or Arc (uses showDirectoryPicker)."

Звичайна робота з документами — створення, відкриття та збереження файлів — **не** обмежена
Chromium: вона працює однаково в усіх перелічених вище браузерах.

## Поради та підводні камені

- **Safari не підтримується, а не просто не тестувався** — не очікуйте, що будь-яка частина
  Zilventor запрацює в ньому.
- **Потрібен HTTPS або localhost.** Zilventor не запуститься, якщо обслуговується через звичайний
  HTTP на адресі, відмінній від localhost.
- **Файли SolidWorks (.SLDPRT / .SLDASM) не можна відкрити в жодному браузері** — це обмеження
  формату файлу, а не браузера. Відкриття такого файлу показує:

  > «Файли SolidWorks (.SLDPRT / .SLDASM) використовують власний формат і не можуть бути
  > відкриті безпосередньо. У SolidWorks: Файл → Зберегти як → Тип файлу: STEP AP242 (*.step) →
  > Зберегти, потім відкрийте файл .step тут.»

  Див. [Файли SolidWorks](../import-migration/solidworks-files.md) щодо процесу конвертації.

## Дивіться також

- [Міграція з Inventor](../import-migration/inventor-migration.md)
- [Файли SolidWorks](../import-migration/solidworks-files.md)
- [Файли STEP](../import-migration/step-files.md)
