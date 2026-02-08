# Midnight Invoice

A modern, dark-themed invoice generator built with React 19, TypeScript, and Tailwind CSS. Now powered by **Convex** for real-time cloud sync.

![Midnight Invoice](https://img.shields.io/badge/React-19-blue) ![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue) ![Convex](https://img.shields.io/badge/Convex-DB-orange)

## Features

- 📝 Create and edit professional invoices
- ☁️ **Cloud Sync** (Real-time via Convex)
- 🔒 **Secure Auth** (WorkOS)
- 💾 Offline support (PWA)
- 📄 Export to PDF
- 🌙 Dark mode design
- 💱 Multi-currency support
- ⚙️ Comprehensive settings management
- 📱 Responsive layout

## Tech Stack

- **Framework**: React 19 with TypeScript
- **Build Tool**: Vite
- **Database**: Convex
- **Auth**: WorkOS
- **Styling**: Tailwind CSS
- **UI Components**: shadcn/ui
- **State Management**: Zustand + Convex
- **PDF Generation**: html2canvas + jsPDF

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

# Start Convex (in a separate terminal)
npx convex dev
```

The app will be available at `http://localhost:5173`

## Project Structure

```
src/
├── components/
│   ├── invoice/           # Invoice-related components
│   └── ui/                # shadcn/ui components
├── convex/                # Backend functions & schema
├── hooks/
│   └── useInvoices.ts     # Invoice management hook
├── lib/
│   └── utils.ts           # General utilities
├── pages/
├── stores/
└── types/
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Open a Pull Request

## License

This project is licensed under the MIT License.
