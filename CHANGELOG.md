# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Changed
- **Dependencies**: Upgraded to current major versions: React 19.3, React Router 8 (replaces `react-router-dom` 6), Tailwind CSS 4, Vite 8, Vitest 5, TypeScript 6.0, ESLint 10, Zod 4, date-fns 4, lucide-react 1, Sonner 2, tailwind-merge 3, next-themes 0.4, vite-plugin-pwa 2, jsdom 31 and more.
- **Tailwind CSS 4**: CSS-first configuration in `src/index.css` via `@tailwindcss/vite`; removed `tailwind.config.ts`, `postcss.config.js` and autoprefixer; `tailwindcss-animate` replaced by `tw-animate-css`. Compatibility rules keep the UI visually unchanged.
- **Tooling**: Switched to `@vitejs/plugin-react`; lockfile migrated to the text `bun.lock`; husky is now a dev dependency; Node.js 22.22+ is required.
- **Environment**: No `.env` file is needed; `VITE_APP_NAME` defaults to "Midnight Invoice". `.env.example` documents both variables.

### Added
- `typecheck` script and a GitHub Actions CI workflow (lint, typecheck, tests, build).
- SPA fallback rewrite in `vercel.json` so deep links work (excludes `/api/*`).

### Removed
- Unused shadcn/ui components (skeleton, toggle, Radix toast), unused helpers (NavLink, use-mobile) and ~30 unused packages (react-hook-form, recharts, embla-carousel, react-day-picker, input-otp, vaul, unused Radix packages, lovable-tagger, etc.).
- Committed `.env` and `package-lock.json`.

### Fixed
- Infinite render loop ("Maximum update depth exceeded") that left the create invoice page blank.
- All lint errors and warnings.
- README inaccuracies (form library, PDF library, dev server port, project structure).

## [1.1.0] - 2025-12-13

### Added
- **Storage Versioning**: Implemented robust backward compatibility for local storage with schema migrations.
- **Development Experience**: Added "DEV" badge and custom favicon for development environment.
- **Git Hooks**: Added Husky pre-commit hooks to run tests automatically.

### Fixed
- **Settings**: Fixed missing banner in settings drawer.
- **Currency Selector**: Fixed display issues (clipping long names) and added fuzzy search.
- **Create Invoice**: Resolved black screen issue and form validation errors.
- **Tests**: Fixed failing tests in InvoiceList, InvoiceForm, and ViewInvoice.

### Changed
- **Dependencies**: Updated various dependencies.

## [1.0.0] - 2024-12-13

### Added
- **Core Invoice Features**
  - Create, edit, and duplicate invoices
  - Auto-save drafts to localStorage
  - Persistent invoice URLs
  - "Load Session" to restore previous work
  - PDF export with custom monospace font and selectable text

- **Multi-Currency Support**
  - Extensive currency list with fuzzy search
  - Currency symbol handling in forms and PDF

- **UI/UX**
  - Modern, dark-themed design using Tailwind CSS & shadcn/ui
  - Responsive layout for mobile and desktop
  - Settings drawer for defaults (tax, currency, sender details)
  - Input sanitization for security

- **PWA Support**
  - Offline support via Service Workers
  - Installable as a progressive web app
  - Custom app icons
