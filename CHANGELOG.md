# Changelog

All notable changes to this project will be documented in this file.

## [1.2.0] - 2026-02-08

### Added
- **Team Management (Phase 2B)**
  - Multi-tenant architecture with team workspaces
  - Role-based access control (Owner, Admin, Member, Viewer)
  - Team invitations system with secure token generation
  - Team logo/avatar upload with validation
  - Team onboarding flow for new users
  - Team switcher with quick invite and settings access

- **Client Management**
  - Team-aware client list with role-based permissions
  - Clients scoped to teams or personal workspace
  - Viewers cannot create clients; only admins/owners can delete

- **Cloud Sync & Offline Support**
  - Real-time Convex database integration
  - Conflict detection and resolution modal
  - Local-to-cloud migration wizard
  - Optimistic updates with sync status indicator
  - Offline mode with automatic conflict handling

- **Authentication**
  - WorkOS authentication via Convex Auth
  - Secure session management

### Fixed
- **Security**
  - Added authorization checks for all team-scoped operations
  - Fixed insecure token generation (now uses crypto.randomBytes)
  - Fixed duplicate member check in invitations
  - Fixed ownership transfer logic in team role updates

- **Type Safety**
  - Added missing teamId field to Client interface
  - Fixed Invoice status to use union type
  - Guarded against undefined query results

- **UX Improvements**
  - Fixed Settings menu item visibility when no handler provided
  - Fixed team label display when team is loading
  - Fixed logo upload error handling with try-catch-finally
  - Fixed currency symbol display in conflict resolution

### Changed
- **Architecture**
  - Migrated from localStorage-only to Convex cloud sync
  - Added server-side invoice number generation
  - Updated schema with team membership indexes

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
