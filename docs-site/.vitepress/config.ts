import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Zilventor',
  description: 'User manual for the Zilventor furniture-CAD app',
  lang: 'en-US',
  ignoreDeadLinks: false,

  themeConfig: {
    search: {
      provider: 'local'
    }
  },

  locales: {
    root: {
      label: 'English',
      lang: 'en-US',
      themeConfig: {
        nav: [
      { text: 'Getting Started', link: '/getting-started/' },
      { text: 'Modeling', link: '/modeling/' },
      { text: 'Furniture', link: '/furniture/' },
      { text: 'Drilling', link: '/drilling-prisadka/' },
      { text: 'Manufacturing', link: '/manufacturing/' },
      { text: 'Reference', link: '/reference/' }
        ],
        sidebar: [
        {
          text: "Getting Started",
          collapsed: true,
          items: [
          { text: "Getting Started", link: '/getting-started/' },
          { text: "Browser Support", link: '/getting-started/browser-support' },
          { text: "Interface Tour", link: '/getting-started/interface-tour' },
          { text: "Your First Project", link: '/getting-started/your-first-project' }
          ]
        },
        {
          text: "Concepts",
          collapsed: true,
          items: [
          { text: "Concepts", link: '/concepts/' },
          { text: "Documents and Kinds", link: '/concepts/documents-and-kinds' },
          { text: "Materials", link: '/concepts/materials' },
          { text: "Parameters and Configurations", link: '/concepts/parameters-and-configurations' },
          { text: "Saving and Sessions", link: '/concepts/saving-and-sessions' },
          { text: "The Browser Tree", link: '/concepts/the-browser-tree' }
          ]
        },
        {
          text: "Modeling",
          collapsed: true,
          items: [
          { text: "Modeling", link: '/modeling/' },
          { text: "Sketching", link: '/modeling/sketching' },
          { text: "Constraints", link: '/modeling/constraints' },
          { text: "Dimensions", link: '/modeling/dimensions' },
          { text: "Extrude, Revolve & Sweep", link: '/modeling/extrude-revolve-sweep' },
          { text: "Modify Features", link: '/modeling/modify-features' },
          { text: "Work Features", link: '/modeling/work-features' },
          { text: "Patterns and Mirror", link: '/modeling/patterns-and-mirror' }
          ]
        },
        {
          text: "Assemblies",
          collapsed: true,
          items: [
          { text: "Assemblies", link: '/assemblies/' },
          { text: "Placing Components", link: '/assemblies/placing-components' },
          { text: "Constraints", link: '/assemblies/constraints' },
          { text: "Patterns and Mirror", link: '/assemblies/patterns-and-mirror' },
          { text: "Bill of Materials", link: '/assemblies/bill-of-materials' },
          { text: "Interference Check", link: '/assemblies/interference-check' }
          ]
        },
        {
          text: "Furniture",
          collapsed: true,
          items: [
          { text: "Furniture", link: '/furniture/' },
          { text: "Panels", link: '/furniture/panels' },
          { text: "Cabinets", link: '/furniture/cabinets' },
          { text: "Doors", link: '/furniture/doors' },
          { text: "Drawer Banks", link: '/furniture/drawer-banks' },
          { text: "Face Frames", link: '/furniture/face-frames' },
          { text: "Hardware", link: '/furniture/hardware' },
          { text: "Cut List", link: '/furniture/cut-list' },
          { text: "Cost and Statistics", link: '/furniture/cost-and-statistics' }
          ]
        },
        {
          text: "Drilling / Присадка",
          collapsed: true,
          items: [
          { text: "Drilling / Присадка", link: '/drilling-prisadka/' },
          { text: "Generate Carcass Boring", link: '/drilling-prisadka/generate-carcass-boring' },
          { text: "System-32 Shelf Pins", link: '/drilling-prisadka/system-32-shelf-pins' },
          { text: "Grooves and Dados", link: '/drilling-prisadka/grooves-and-dados' },
          { text: "Keyhole Slots", link: '/drilling-prisadka/keyhole-slots' },
          { text: "Mortise and Tenon", link: '/drilling-prisadka/mortise-and-tenon' },
          { text: "Handles and Pulls", link: '/drilling-prisadka/handles-and-pulls' },
          { text: "Leg Levelers", link: '/drilling-prisadka/leg-levelers' },
          { text: "Machining Presets", link: '/drilling-prisadka/machining-presets' },
          { text: "Editing and Clearing Bores", link: '/drilling-prisadka/editing-and-clearing-bores' },
          { text: "Exporting Boring Data", link: '/drilling-prisadka/exporting-boring-data' }
          ]
        },
        {
          text: "Drawings",
          collapsed: true,
          items: [
          { text: "Drawings", link: '/drawings/' },
          { text: "Sheets", link: '/drawings/sheets' },
          { text: "Base and Projected Views", link: '/drawings/base-and-projected-views' },
          { text: "Section Views", link: '/drawings/section-views' },
          { text: "Detail Views", link: '/drawings/detail-views' },
          { text: "Broken Views", link: '/drawings/broken-views' },
          { text: "Dimensions", link: '/drawings/dimensions' },
          { text: "Annotations", link: '/drawings/annotations' },
          { text: "Hole Tables and Parts Lists", link: '/drawings/hole-tables-and-parts-lists' },
          { text: "Templates", link: '/drawings/templates' },
          { text: "Exporting Drawings", link: '/drawings/exporting-drawings' }
          ]
        },
        {
          text: "Manufacturing",
          collapsed: true,
          items: [
          { text: "Manufacturing", link: '/manufacturing/' },
          { text: "Manufacturing DXF", link: '/manufacturing/manufacturing-dxf' },
          { text: "Nesting", link: '/manufacturing/nesting' },
          { text: "Editing the Nest", link: '/manufacturing/editing-the-nest' },
          { text: "Labels and QR", link: '/manufacturing/labels-and-qr' },
          { text: "ABF Layer Scheme", link: '/manufacturing/abf-layer-scheme' },
          { text: "CAM Metadata", link: '/manufacturing/cam-metadata' },
          { text: "Cost Report", link: '/manufacturing/cost-report' },
          { text: "Packing Slip", link: '/manufacturing/packing-slip' },
          { text: "Production Reconciliation", link: '/manufacturing/production-reconciliation' }
          ]
        },
        {
          text: "Import & Migration",
          collapsed: true,
          items: [
          { text: "Import & Migration", link: '/import-migration/' },
          { text: "STEP Files", link: '/import-migration/step-files' },
          { text: "DXF Files", link: '/import-migration/dxf-files' },
          { text: "ABF Flatten Import", link: '/import-migration/abf-flatten-import' },
          { text: "Convert to Panel", link: '/import-migration/convert-to-panel' },
          { text: "Inventor Migration", link: '/import-migration/inventor-migration' },
          { text: "SolidWorks Files", link: '/import-migration/solidworks-files' }
          ]
        },
        {
          text: "Reference",
          collapsed: true,
          items: [
          { text: "Reference", link: '/reference/' },
          { text: "Keyboard Shortcuts", link: '/reference/keyboard-shortcuts' },
          { text: "File Formats", link: '/reference/file-formats' },
          { text: "Export Formats", link: '/reference/export-formats' },
          { text: "Glossary", link: '/reference/glossary' }
          ]
        },
        {
          text: "Troubleshooting",
          collapsed: true,
          items: [
          { text: "Troubleshooting", link: '/troubleshooting/' },
          { text: "Known Limitations", link: '/troubleshooting/known-limitations' },
          { text: "Browser Issues", link: '/troubleshooting/browser-issues' },
          { text: "FAQ", link: '/troubleshooting/faq' }
          ]
        }
        ]
      }
    },
    uk: {
      label: 'Українська',
      lang: 'uk-UA',
      link: '/uk/',
      themeConfig: {
        nav: [
          { text: 'Початок роботи', link: '/uk/getting-started/' },
          { text: 'Моделювання', link: '/uk/modeling/' },
          { text: 'Меблі', link: '/uk/furniture/' },
          { text: 'Присадка', link: '/uk/drilling-prisadka/' },
          { text: 'Виробництво', link: '/uk/manufacturing/' },
          { text: 'Довідка', link: '/uk/reference/' }
        ],
        sidebar: [
          {
            text: 'Початок роботи',
            collapsed: true,
            items: [
              { text: 'Початок роботи', link: '/uk/getting-started/' },
              { text: 'Підтримка браузерів', link: '/uk/getting-started/browser-support' },
              { text: 'Огляд інтерфейсу', link: '/uk/getting-started/interface-tour' },
              { text: 'Ваш перший проєкт', link: '/uk/getting-started/your-first-project' }
            ]
          },
          {
            text: 'Основні поняття',
            collapsed: true,
            items: [
              { text: 'Основні поняття', link: '/uk/concepts/' },
              { text: 'Документи та їх типи', link: '/uk/concepts/documents-and-kinds' },
              { text: 'Матеріали', link: '/uk/concepts/materials' },
              { text: 'Параметри та конфігурації', link: '/uk/concepts/parameters-and-configurations' },
              { text: 'Збереження та сесії', link: '/uk/concepts/saving-and-sessions' },
              { text: 'Дерево браузера', link: '/uk/concepts/the-browser-tree' }
            ]
          },
          {
            text: 'Моделювання',
            collapsed: true,
            items: [
              { text: 'Моделювання', link: '/uk/modeling/' },
              { text: 'Ескізи', link: '/uk/modeling/sketching' },
              { text: 'Обмеження', link: '/uk/modeling/constraints' },
              { text: 'Розміри', link: '/uk/modeling/dimensions' },
              { text: 'Видавлювання, обертання та зсув', link: '/uk/modeling/extrude-revolve-sweep' },
              { text: 'Редагування елементів', link: '/uk/modeling/modify-features' },
              { text: 'Робочі елементи', link: '/uk/modeling/work-features' },
              { text: 'Масиви та дзеркало', link: '/uk/modeling/patterns-and-mirror' }
            ]
          },
          {
            text: 'Складання',
            collapsed: true,
            items: [
              { text: 'Складання', link: '/uk/assemblies/' },
              { text: 'Розміщення компонентів', link: '/uk/assemblies/placing-components' },
              { text: 'Обмеження', link: '/uk/assemblies/constraints' },
              { text: 'Масиви та дзеркало', link: '/uk/assemblies/patterns-and-mirror' },
              { text: 'Специфікація (BOM)', link: '/uk/assemblies/bill-of-materials' },
              { text: 'Перевірка перетинів', link: '/uk/assemblies/interference-check' }
            ]
          },
          {
            text: 'Меблі',
            collapsed: true,
            items: [
              { text: 'Меблі', link: '/uk/furniture/' },
              { text: 'Панелі', link: '/uk/furniture/panels' },
              { text: 'Шафи', link: '/uk/furniture/cabinets' },
              { text: 'Двері', link: '/uk/furniture/doors' },
              { text: 'Блоки шухляд', link: '/uk/furniture/drawer-banks' },
              { text: 'Лицьові рамки', link: '/uk/furniture/face-frames' },
              { text: 'Фурнітура', link: '/uk/furniture/hardware' },
              { text: 'Список розкрою', link: '/uk/furniture/cut-list' },
              { text: 'Вартість і статистика', link: '/uk/furniture/cost-and-statistics' }
            ]
          },
          {
            text: 'Присадка',
            collapsed: true,
            items: [
              { text: 'Присадка', link: '/uk/drilling-prisadka/' },
              { text: 'Генерувати присадку корпусу', link: '/uk/drilling-prisadka/generate-carcass-boring' },
              { text: 'Полицетримачі System-32', link: '/uk/drilling-prisadka/system-32-shelf-pins' },
              { text: 'Пази та фальці', link: '/uk/drilling-prisadka/grooves-and-dados' },
              { text: 'Замкові пази', link: '/uk/drilling-prisadka/keyhole-slots' },
              { text: 'Шип і паз', link: '/uk/drilling-prisadka/mortise-and-tenon' },
              { text: 'Ручки', link: '/uk/drilling-prisadka/handles-and-pulls' },
              { text: 'Регульовані ніжки', link: '/uk/drilling-prisadka/leg-levelers' },
              { text: 'Пресети обробки', link: '/uk/drilling-prisadka/machining-presets' },
              { text: 'Редагування та очищення присадки', link: '/uk/drilling-prisadka/editing-and-clearing-bores' },
              { text: 'Експорт даних присадки', link: '/uk/drilling-prisadka/exporting-boring-data' }
            ]
          },
          {
            text: 'Креслення',
            collapsed: true,
            items: [
              { text: 'Креслення', link: '/uk/drawings/' },
              { text: 'Аркуші', link: '/uk/drawings/sheets' },
              { text: 'Основні та проєкційні види', link: '/uk/drawings/base-and-projected-views' },
              { text: 'Розрізи', link: '/uk/drawings/section-views' },
              { text: 'Виносні елементи', link: '/uk/drawings/detail-views' },
              { text: 'Розірвані види', link: '/uk/drawings/broken-views' },
              { text: 'Розміри', link: '/uk/drawings/dimensions' },
              { text: 'Позначення', link: '/uk/drawings/annotations' },
              { text: 'Таблиці отворів і специфікації', link: '/uk/drawings/hole-tables-and-parts-lists' },
              { text: 'Шаблони', link: '/uk/drawings/templates' },
              { text: 'Експорт креслень', link: '/uk/drawings/exporting-drawings' }
            ]
          },
          {
            text: 'Виробництво',
            collapsed: true,
            items: [
              { text: 'Виробництво', link: '/uk/manufacturing/' },
              { text: 'Виробничий DXF', link: '/uk/manufacturing/manufacturing-dxf' },
              { text: 'Розкладка на листі', link: '/uk/manufacturing/nesting' },
              { text: 'Редагування розкладки', link: '/uk/manufacturing/editing-the-nest' },
              { text: 'Етикетки та QR', link: '/uk/manufacturing/labels-and-qr' },
              { text: 'Схема шарів ABF', link: '/uk/manufacturing/abf-layer-scheme' },
              { text: 'Метадані CAM', link: '/uk/manufacturing/cam-metadata' },
              { text: 'Звіт про вартість', link: '/uk/manufacturing/cost-report' },
              { text: 'Пакувальний лист', link: '/uk/manufacturing/packing-slip' },
              { text: 'Звірка виробництва', link: '/uk/manufacturing/production-reconciliation' }
            ]
          },
          {
            text: 'Імпорт і міграція',
            collapsed: true,
            items: [
              { text: 'Імпорт і міграція', link: '/uk/import-migration/' },
              { text: 'Файли STEP', link: '/uk/import-migration/step-files' },
              { text: 'Файли DXF', link: '/uk/import-migration/dxf-files' },
              { text: 'Імпорт ABF (розгортка)', link: '/uk/import-migration/abf-flatten-import' },
              { text: 'Перетворення на панель', link: '/uk/import-migration/convert-to-panel' },
              { text: 'Міграція з Inventor', link: '/uk/import-migration/inventor-migration' },
              { text: 'Файли SolidWorks', link: '/uk/import-migration/solidworks-files' }
            ]
          },
          {
            text: 'Довідка',
            collapsed: true,
            items: [
              { text: 'Довідка', link: '/uk/reference/' },
              { text: 'Гарячі клавіші', link: '/uk/reference/keyboard-shortcuts' },
              { text: 'Формати файлів', link: '/uk/reference/file-formats' },
              { text: 'Формати експорту', link: '/uk/reference/export-formats' },
              { text: 'Глосарій', link: '/uk/reference/glossary' }
            ]
          },
          {
            text: 'Усунення несправностей',
            collapsed: true,
            items: [
              { text: 'Усунення несправностей', link: '/uk/troubleshooting/' },
              { text: 'Відомі обмеження', link: '/uk/troubleshooting/known-limitations' },
              { text: 'Проблеми з браузером', link: '/uk/troubleshooting/browser-issues' },
              { text: 'Часті запитання', link: '/uk/troubleshooting/faq' }
            ]
          }
        ]
      }
    }
  }
})
