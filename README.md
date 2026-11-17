# Midnight Invoice

A modern, dark-themed invoice generator built with React 19, TypeScript, and Tailwind CSS.

![Midnight Invoice](https://img.shields.io/badge/React-19-blue) ![TypeScript](https://img.shields.io/badge/TypeScript-6.0-blue) ![License](https://img.shields.io/badge/license-MIT-green)

## Features

- 📝 Create and edit professional invoices
- 💾 Auto-save drafts to localStorage
- 📄 Export to PDF
- 🌙 Dark mode design
- 💱 Multi-currency support (All currencies)
- ⚙️ Comprehensive settings management
- 📋 Duplicate invoices
- 📱 Responsive layout
- ⚡ Installable PWA with offline support

## Tech Stack

- **Framework**: React 19 with TypeScript 6
- **Build Tool**: Vite 8
- **Routing**: React Router 8 (declarative mode)
- **Styling**: Tailwind CSS 4 (CSS-first config in `src/index.css`)
- **UI Components**: shadcn/ui (Radix UI) + lucide-react icons
- **State Management**: Zustand with persist middleware
- **Form Handling**: TanStack Form with Zod 4 validation
- **PDF Generation**: @react-pdf/renderer
- **Notifications**: Sonner
- **PWA**: vite-plugin-pwa
- **Testing**: Vitest + React Testing Library
- **Linting**: ESLint 10 + typescript-eslint

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) 1.4+ (package manager and script runner)
- [Node.js](https://nodejs.org/) 22.22+ (Vite, Vitest and React Router run on Node)

### Installation

```bash
# Clone the repository
git clone https://github.com/0xzapata/midnight-invoice.git
cd midnight-invoice

# Install dependencies
bun install
```

### Development

```bash
# Start the development server
bun run dev
```

The app will be available at `http://localhost:8080`

### Environment Variables

No `.env` file is required. To override the defaults, copy `.env.example` to
`.env.local`:

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_APP_NAME` | `Midnight Invoice` | Name shown in the header |
| `VITE_APP_ENV` | `DEVELOPMENT` | `DEVELOPMENT`, `STAGING`, `PREVIEW` or `PRODUCTION`; `DEVELOPMENT` shows the dev banner and favicon |

### Building for Production

```bash
# Create production build
bun run build

# Preview production build
bun run preview
```

### Testing

```bash
# Run tests in watch mode
bun run test

# Run tests once
bun run test:run

# Run tests with coverage
bun run test:coverage
```

### Linting and Type Checking

```bash
bun run lint
bun run typecheck
```

CI (`.github/workflows/ci.yml`) runs install, lint, typecheck, tests and build
on every push and pull request.

## Project Structure

```
src/
├── App.tsx                  # Providers and routes
├── main.tsx                 # Entry point
├── index.css                # Tailwind 4 theme, design tokens, global styles
├── env.ts                   # Typed environment variables
├── components/
│   ├── invoice/             # Invoice components
│   │   ├── InvoiceForm.tsx
│   │   ├── InvoicePreview.tsx
│   │   ├── InvoicePDF.tsx   # @react-pdf/renderer document
│   │   └── InvoiceList.tsx
│   ├── icons/               # Custom icons
│   ├── ui/                  # shadcn/ui components + CurrencySelector
│   ├── Footer.tsx
│   ├── SettingsDrawer.tsx
│   └── ThemeToggle.tsx
├── hooks/
│   └── useInvoices.ts       # Invoice management hook
├── lib/
│   ├── currencies.ts        # Currency list
│   ├── invoice-utils.ts     # Currency/date formatting
│   ├── sanitize.ts          # Input sanitization
│   ├── storageMigrations.ts # localStorage schema migrations
│   ├── validation.ts        # Zod schemas
│   └── utils.ts             # General utilities
├── pages/
│   ├── Index.tsx            # Dashboard
│   ├── CreateInvoice.tsx    # Create/edit invoice
│   ├── ViewInvoice.tsx      # View saved invoice
│   └── NotFound.tsx
├── stores/
│   ├── useInvoiceStore.ts   # Invoices and drafts (Zustand)
│   └── useSettingsStore.ts  # Default settings (Zustand)
├── test/
│   └── setup.ts             # Test configuration
└── types/
    └── invoice.ts           # TypeScript interfaces
```

## Scripts

| Script | Description |
|--------|-------------|
| `bun run dev` | Start development server |
| `bun run build` | Build for production |
| `bun run preview` | Preview production build |
| `bun run lint` | Run ESLint |
| `bun run typecheck` | Type-check with TypeScript |
| `bun run test` | Run tests in watch mode |
| `bun run test:run` | Run tests once |
| `bun run test:coverage` | Run tests with coverage report |

## State Management

The app uses [Zustand](https://github.com/pmndrs/zustand) for state management with the `persist` middleware for automatic localStorage synchronization.

```typescript
// Access the store directly
import { useInvoiceStore } from '@/stores/useInvoiceStore';

const invoices = useInvoiceStore((state) => state.invoices);
const saveInvoice = useInvoiceStore((state) => state.saveInvoice);

// Or use the hook wrapper for backwards compatibility
import { useInvoices } from '@/hooks/useInvoices';

const { invoices, saveInvoice, deleteInvoice } = useInvoices();
```

## Security

All user input is sanitized before rendering to prevent XSS attacks:

```typescript
import { sanitizeInvoiceData } from '@/lib/sanitize';

// Sanitize all invoice fields before rendering
const safeData = sanitizeInvoiceData(formData);
```

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License.
