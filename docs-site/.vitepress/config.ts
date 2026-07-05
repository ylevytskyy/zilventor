import { defineConfig } from 'vitepress'

// TODO: flip to false once UK tree is complete
export default defineConfig({
  title: 'Zilventor',
  description: 'User manual for the Zilventor furniture-CAD app',
  lang: 'en-US',
  ignoreDeadLinks: true,

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
          { text: 'Home', link: '/uk/' }
        ],
        sidebar: [
          {
            text: 'Головна',
            items: [
              { text: 'Home', link: '/uk/' }
            ]
          }
        ]
      }
    }
  }
})
