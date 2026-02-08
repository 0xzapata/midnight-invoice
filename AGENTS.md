# Agent Guide

This documentation is intended for AI agents working on the Midnight Invoice project. It provides an overview of the architecture, key files, and development workflows.

## Project Overview

Midnight Invoice is a modern invoice generator built with React 19, Vite, and TypeScript. It features a dark-themed UI, offline support, and PDF export capabilities.

## Tech Stack

- **Framework**: React 19
- **Build Tool**: Vite
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **Components**: shadcn/ui
- **Database**: Convex (Realtime DB & Backend)
- **Authentication**: WorkOS (via Convex Auth)
- **State Management**: 
    - *Local:* Zustand (UI state)
    - *Remote:* Convex (Data sync)
- **PDF Generation**: @react-pdf/renderer
- **Routing**: react-router-dom
- **Testing**: Vitest + React Testing Library

## Architecture

### Data Layer (New)
- **Source of Truth**: Convex Database.
- **Offline Strategy**: Optimistic updates for PWA; LocalStorage fallback for unauthenticated users.
- **Schema**: Defined in `convex/schema.ts`.

### State Management
- `src/stores/`: Legacy local-only stores (migrating to Convex queries).
- `useInvoiceStore.ts`: Currently manages local invoices.

### Routing
Routes are defined in `src/App.tsx`.
- `/`: Dashboard
- `/create`: Create new invoice
- `/invoice/:id`: View saved invoice

### Components
- `src/components/invoice/`: Core business logic components.
- `src/components/ui/`: Reusable UI components.

## Development Workflows

### Running Locally
```bash
bun install
bun run dev
npx convex dev # Run in a separate terminal
```

### Testing
Tests are co-located with components.
```bash
bun run test
```

## Contribution Guidelines
- Use the `bun` runtime for scripts.
- Ensure all new features have accompanying tests.
- Keep the `README.md` updated.
