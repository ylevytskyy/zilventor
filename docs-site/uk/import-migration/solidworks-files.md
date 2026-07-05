---
title: SolidWorks-файли
---
# SolidWorks-файли
> Відкриття файлу SolidWorks не провалюється мовчки — zilventor розпізнає його і підказує спершу
> експортувати STEP, бо рідний формат читати взагалі не вміє.

**Де:** вкладка File ▸ **Open…** · **Гарячі клавіші:** — · **Застосовується до:** деталь, збірка

## Що це робить

Нативні файли SolidWorks (`.sldprt` / `.sldasm`) — це пропрієтарні OLE-складені документи, що
обгортають геометрію Parasolid. Ядро zilventor на основі OCCT не вміє їх читати, і надійного
відкритого зчитувача цього формату для браузера не існує. Замість того щоб провалитися з
незрозумілою помилкою про архів, **File ▸ Open** одразу розпізнає розширення
`.sldprt`/`.sldasm` і показує діалог із підказкою замість спроби імпорту. Zilventor ніколи не
намагається виконати нативний імпорт SolidWorks — це навмисне рішення, а не відсутня функція.

## Перед початком

- Майте під рукою SolidWorks для повторного експорту файлу — zilventor не може конвертувати
  його за вас.

## Кроки

1. Вкладка **File** ▸ **Open…**, оберіть файл `.sldprt` або `.sldasm`.
2. Zilventor показує: *«SolidWorks files (.SLDPRT / .SLDASM) use a proprietary format and can't
   be opened directly. In SolidWorks: File → Save As → Save as type: STEP AP242 (*.step) → Save,
   then open the .step file here.»*
3. У SolidWorks: **File ▸ Save As** ▸ встановіть **Save as type** на **STEP AP242 (\*.step)** ▸
   **Save**.
4. Повернувшись у zilventor, виберіть **File ▸ Open…** та оберіть експортований файл `.step` —
   дивіться [STEP-файли](./step-files.md) про те, що відбувається далі.

## Поради та підводні камені

- Це стосується як деталей (`.sldprt`), так і збірок (`.sldasm`) — обидва розширення викликають
  той самий діалог з підказкою.
- STEP AP242 — рекомендований варіант експорту, оскільки він найповніший серед варіантів STEP у
  SolidWorks; AP214 теж підходить, якщо AP242 недоступний у вашій версії SolidWorks.
- Усе, що стосується звичайного імпорту STEP — геометрія тільки для читання, обмеження розміру
  50 МБ, можливість Explode для багатотільного експорту — стосується і цього шляху, оскільки
  на момент, коли zilventor бачить файл, це вже просто STEP.

<!-- SCREENSHOT: the SolidWorks guidance dialog shown after picking a .sldprt file — TODO follow-up -->

## Дивіться також

- [Огляд Import & Migration](./index.md)
- [STEP-файли](./step-files.md)
- [Міграція з Inventor](./inventor-migration.md)
