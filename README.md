# Midnight Invoice

A modern, dark-themed invoice generator built with React 19, TypeScript, and Tailwind CSS.

![Midnight Invoice](https://img.shields.io/badge/React-19-blue) ![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue) ![License](https://img.shields.io/badge/license-MIT-green)

## Features

- 📝 Create and edit professional invoices
- 💾 Auto-save drafts to localStorage
- 📄 Export to PDF
- 🌙 Dark mode design
- 💱 Multi-currency support (All currencies)
- ⚙️ Comprehensive settings management
- 📋 Duplicate invoices
- 📱 Responsive layout

## Tech Stack

- **Framework**: React 19 with TypeScript
- **Build Tool**: Vite
- **Styling**: Tailwind CSS
- **UI Components**: shadcn/ui
- **State Management**: Zustand with persist middleware
- **Form Handling**: React Hook Form
- **PDF Generation**: html2canvas + jsPDF
- **Testing**: Vitest + React Testing Library

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) (recommended) or Node.js 18+

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

The app will be available at `http://localhost:5173`

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

### Linting

```bash
bun run lint
```

## Project Structure

```
src/
├── components/
│   ├── invoice/           # Invoice-related components
│   │   ├── InvoiceForm.tsx
│   │   ├── InvoicePreview.tsx
│   │   └── InvoiceList.tsx
│   └── ui/                # shadcn/ui components
├── hooks/
│   └── useInvoices.ts     # Invoice management hook
├── lib/
│   ├── invoice-utils.ts   # Currency/date formatting
│   ├── sanitize.ts        # Input sanitization
│   └── utils.ts           # General utilities
├── pages/
│   ├── Index.tsx          # Dashboard
│   ├── CreateInvoice.tsx  # Create/edit invoice
│   └── ViewInvoice.tsx    # View saved invoice
├── stores/
│   └── useInvoiceStore.ts # Zustand store
├── test/
│   └── setup.ts           # Test configuration
└── types/
    └── invoice.ts         # TypeScript interfaces
```

## Scripts

| Script | Description |
|--------|-------------|
| `bun run dev` | Start development server |
| `bun run build` | Build for production |
| `bun run preview` | Preview production build |
| `bun run lint` | Run ESLint |
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
