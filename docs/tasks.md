# Midnight Invoice - Development Tasks

Master task index for the Q1 2026 Feature Implementation. This document tracks all tasks across the four major features: File Storage, Analytics, Templates, and Email Delivery.

---

## Table of Contents

- [Phase 1: Foundation](#phase-1-foundation)
- [Phase 2: File Storage](#phase-2-file-storage)
- [Phase 3: Analytics](#phase-3-analytics)
- [Phase 4: Templates](#phase-4-templates)
- [Phase 5: Email Delivery](#phase-5-email-delivery)
- [Phase 6: Integration & Launch](#phase-6-integration--launch)
- [Task Dependencies](#task-dependencies)
- [Definition of Done](#definition-of-done)

---

## Phase 1: Foundation

### P1.1 Environment Setup

#### P1.1.1: Create Cloudflare R2 Bucket
- **Effort**: Small (1 day)
- **Priority**: High
- **Component**: Infrastructure
- **Ref**: [Task P1.1.1](./tasks/task-p1.1.1-create-r2-bucket.md)
- **Status**: 🔴 Pending
- **Spec**: [PLAN-001](../plans/PLAN-001-cloudflare-r2-file-storage-feb-8-2026_09-46-am.md)
- **Dependencies**: None

#### P1.1.2: Setup PostHog Account
- **Effort**: Small (1 day)
- **Priority**: High
- **Component**: Analytics
- **Ref**: [Task P1.1.2](./tasks/task-p1.1.2-setup-posthog-account.md)
- **Status**: 🔴 Pending
- **Spec**: [PLAN-002](../plans/PLAN-002-analytics-integration-feb-8-2026_09-47-am.md)
- **Dependencies**: None

#### P1.1.3: Setup Plausible Analytics
- **Effort**: Small (1 day)
- **Priority**: High
- **Component**: Analytics
- **Ref**: [Task P1.1.3](./tasks/task-p1.1.3-setup-plausible.md)
- **Status**: 🔴 Pending
- **Spec**: [PLAN-002](../plans/PLAN-002-analytics-integration-feb-8-2026_09-47-am.md)
- **Dependencies**: None

#### P1.1.4: Setup Resend Account
- **Effort**: Small (1 day)
- **Priority**: High
- **Component**: Email
- **Ref**: [Task P1.1.4](./tasks/task-p1.1.4-setup-resend-account.md)
- **Status**: 🔴 Pending
- **Spec**: [PLAN-004](../plans/PLAN-004-resend-email-delivery-feb-8-2026_09-49-am.md)
- **Dependencies**: None

### P1.2 Database Schema

#### P1.2.1: Add Files Table to Schema
- **Effort**: Small (1 day)
- **Priority**: High
- **Component**: Database
- **Ref**: [Task P1.2.1](./tasks/task-p1.2.1-add-files-table.md)
- **Status**: 🔴 Pending
- **Spec**: [PLAN-001](../plans/PLAN-001-cloudflare-r2-file-storage-feb-8-2026_09-46-am.md)
- **Dependencies**: P1.1.1

#### P1.2.2: Add Templates Table to Schema
- **Effort**: Small (1 day)
- **Priority**: High
- **Component**: Database
- **Ref**: [Task P1.2.2](./tasks/task-p1.2.2-add-templates-table.md)
- **Status**: 🔴 Pending
- **Spec**: [PLAN-003](../plans/PLAN-003-invoice-templates-feb-8-2026_09-48-am.md)
- **Dependencies**: None

#### P1.2.3: Add Email Logs Table
- **Effort**: Small (1 day)
- **Priority**: High
- **Component**: Database
- **Ref**: [Task P1.2.3](./tasks/task-p1.2.3-add-email-logs-table.md)
- **Status**: 🔴 Pending
- **Spec**: [PLAN-004](../plans/PLAN-004-resend-email-delivery-feb-8-2026_09-49-am.md)
- **Dependencies**: None

---

## Phase 2: File Storage

### P2.1 Infrastructure

#### P2.1.1: Configure R2 CORS and Access Policies
- **Effort**: Small (1 day)
- **Priority**: High
- **Component**: Infrastructure
- **Ref**: [Task P2.1.1](./tasks/task-p2.1.1-configure-r2-cors.md)
- **Status**: 🔴 Pending
- **Spec**: [PLAN-001](../plans/PLAN-001-cloudflare-r2-file-storage-feb-8-2026_09-46-am.md)
- **Dependencies**: P1.1.1, P1.2.1

#### P2.1.2: Implement File Upload Convex Actions
- **Effort**: Medium (2 days)
- **Priority**: High
- **Component**: Backend
- **Ref**: [Task P2.1.2](./tasks/task-p2.1.2-implement-file-upload-actions.md)
- **Status**: 🔴 Pending
- **Spec**: [PLAN-001](../plans/PLAN-001-cloudflare-r2-file-storage-feb-8-2026_09-46-am.md)
- **Dependencies**: P2.1.1

#### P2.1.3: Implement File Deletion and Queries
- **Effort**: Small (1 day)
- **Priority**: Medium
- **Component**: Backend
- **Ref**: [Task P2.1.3](./tasks/task-p2.1.3-implement-file-deletion-queries.md)
- **Status**: 🔴 Pending
- **Spec**: [PLAN-001](../plans/PLAN-001-cloudflare-r2-file-storage-feb-8-2026_09-46-am.md)
- **Dependencies**: P2.1.2

### P2.2 Frontend Components

#### P2.2.1: Create useFileUpload Hook
- **Effort**: Medium (2 days)
- **Priority**: High
- **Component**: Frontend
- **Ref**: [Task P2.2.1](./tasks/task-p2.2.1-create-use-file-upload-hook.md)
- **Status**: 🔴 Pending
- **Spec**: [PLAN-001](../plans/PLAN-001-cloudflare-r2-file-storage-feb-8-2026_09-46-am.md)
- **Dependencies**: P2.1.2

#### P2.2.2: Build LogoUpload Component
- **Effort**: Medium (2 days)
- **Priority**: High
- **Component**: Frontend
- **Ref**: [Task P2.2.2](./tasks/task-p2.2.2-build-logo-upload-component.md)
- **Status**: 🔴 Pending
- **Spec**: [PLAN-001](../plans/PLAN-001-cloudflare-r2-file-storage-feb-8-2026_09-46-am.md)
- **Dependencies**: P2.2.1

#### P2.2.3: Build FileDropzone Component
- **Effort**: Medium (2 days)
- **Priority**: Medium
- **Component**: Frontend
- **Ref**: [Task P2.2.3](./tasks/task-p2.2.3-build-file-dropzone-component.md)
- **Status**: 🔴 Pending
- **Spec**: [PLAN-001](../plans/PLAN-001-cloudflare-r2-file-storage-feb-8-2026_09-46-am.md)
- **Dependencies**: P2.2.1

#### P2.2.4: Integrate Logo Upload to Settings
- **Effort**: Small (1 day)
- **Priority**: High
- **Component**: Frontend
- **Ref**: [Task P2.2.4](./tasks/task-p2.2.4-integrate-logo-upload-settings.md)
- **Status**: 🔴 Pending
- **Spec**: [PLAN-001](../plans/PLAN-001-cloudflare-r2-file-storage-feb-8-2026_09-46-am.md)
- **Dependencies**: P2.2.2

### P2.3 Invoice Integration

#### P2.3.1: Add Logo Rendering to InvoicePDF
- **Effort**: Medium (2 days)
- **Priority**: High
- **Component**: PDF Generation
- **Ref**: [Task P2.3.1](./tasks/task-p2.3.1-add-logo-to-invoice-pdf.md)
- **Status**: 🔴 Pending
- **Spec**: [PLAN-001](../plans/PLAN-001-cloudflare-r2-file-storage-feb-8-2026_09-46-am.md)
- **Dependencies**: P2.2.4

#### P2.3.2: Build InvoiceAttachments Component
- **Effort**: Medium (2 days)
- **Priority**: Medium
- **Component**: Frontend
- **Ref**: [Task P2.3.2](./tasks/task-p2.3.2-build-invoice-attachments.md)
- **Status**: 🔴 Pending
- **Spec**: [PLAN-001](../plans/PLAN-001-cloudflare-r2-file-storage-feb-8-2026_09-46-am.md)
- **Dependencies**: P2.2.3

#### P2.3.3: Integrate Attachments to Invoice Form
- **Effort**: Medium (2 days)
- **Priority**: Medium
- **Component**: Frontend
- **Ref**: [Task P2.3.3](./tasks/task-p2.3.3-integrate-attachments-invoice-form.md)
- **Status**: 🔴 Pending
- **Spec**: [PLAN-001](../plans/PLAN-001-cloudflare-r2-file-storage-feb-8-2026_09-46-am.md)
- **Dependencies**: P2.3.2

### P2.4 Optimization

#### P2.4.1: Add File Cleanup Job
- **Effort**: Small (1 day)
- **Priority**: Low
- **Component**: Backend
- **Ref**: [Task P2.4.1](./tasks/task-p2.4.1-add-file-cleanup-job.md)
- **Status**: 🔴 Pending
- **Spec**: [PLAN-001](../plans/PLAN-001-cloudflare-r2-file-storage-feb-8-2026_09-46-am.md)
- **Dependencies**: P2.3.3

#### P2.4.2: Add Storage Usage Analytics
- **Effort**: Small (1 day)
- **Priority**: Low
- **Component**: Backend
- **Ref**: [Task P2.4.2](./tasks/task-p2.4.2-add-storage-analytics.md)
- **Status**: 🔴 Pending
- **Spec**: [PLAN-001](../plans/PLAN-001-cloudflare-r2-file-storage-feb-8-2026_09-46-am.md)
- **Dependencies**: P2.4.1

---

## Phase 3: Analytics

### P3.1 Setup

#### P3.1.1: Install and Configure PostHog SDK
- **Effort**: Small (1 day)
- **Priority**: High
- **Component**: Frontend
- **Ref**: [Task P3.1.1](./tasks/task-p3.1.1-install-configure-posthog.md)
- **Status**: 🔴 Pending
- **Spec**: [PLAN-002](../plans/PLAN-002-analytics-integration-feb-8-2026_09-47-am.md)
- **Dependencies**: P1.1.2

#### P3.1.2: Install and Configure Plausible
- **Effort**: Small (1 day)
- **Priority**: High
- **Component**: Frontend
- **Ref**: [Task P3.1.2](./tasks/task-p3.1.2-install-configure-plausible.md)
- **Status**: 🔴 Pending
- **Spec**: [PLAN-002](../plans/PLAN-002-analytics-integration-feb-8-2026_09-47-am.md)
- **Dependencies**: P1.1.3

#### P3.1.3: Create AnalyticsProvider Component
- **Effort**: Medium (2 days)
- **Priority**: High
- **Component**: Frontend
- **Ref**: [Task P3.1.3](./tasks/task-p3.1.3-create-analytics-provider.md)
- **Status**: 🔴 Pending
- **Spec**: [PLAN-002](../plans/PLAN-002-analytics-integration-feb-8-2026_09-47-am.md)
- **Dependencies**: P3.1.1, P3.1.2

### P3.2 Event Tracking

#### P3.2.1: Implement useAnalytics Hook
- **Effort**: Medium (2 days)
- **Priority**: High
- **Component**: Frontend
- **Ref**: [Task P3.2.1](./tasks/task-p3.2.1-implement-use-analytics-hook.md)
- **Status**: 🔴 Pending
- **Spec**: [PLAN-002](../plans/PLAN-002-analytics-integration-feb-8-2026_09-47-am.md)
- **Dependencies**: P3.1.3

#### P3.2.2: Track User Authentication Events
- **Effort**: Small (1 day)
- **Priority**: High
- **Component**: Frontend
- **Ref**: [Task P3.2.2](./tasks/task-p3.2.2-track-auth-events.md)
- **Status**: 🔴 Pending
- **Spec**: [PLAN-002](../plans/PLAN-002-analytics-integration-feb-8-2026_09-47-am.md)
- **Dependencies**: P3.2.1

#### P3.2.3: Track Invoice Lifecycle Events
- **Effort**: Medium (2 days)
- **Priority**: High
- **Component**: Frontend
- **Ref**: [Task P3.2.3](./tasks/task-p3.2.3-track-invoice-events.md)
- **Status**: 🔴 Pending
- **Spec**: [PLAN-002](../plans/PLAN-002-analytics-integration-feb-8-2026_09-47-am.md)
- **Dependencies**: P3.2.1

#### P3.2.4: Track Feature Usage Events
- **Effort**: Medium (2 days)
- **Priority**: Medium
- **Component**: Frontend
- **Ref**: [Task P3.2.4](./tasks/task-p3.2.4-track-feature-events.md)
- **Status**: 🔴 Pending
- **Spec**: [PLAN-002](../plans/PLAN-002-analytics-integration-feb-8-2026_09-47-am.md)
- **Dependencies**: P3.2.1

#### P3.2.5: Setup Error Tracking
- **Effort**: Medium (2 days)
- **Priority**: High
- **Component**: Frontend
- **Ref**: [Task P3.2.5](./tasks/task-p3.2.5-setup-error-tracking.md)
- **Status**: 🔴 Pending
- **Spec**: [PLAN-002](../plans/PLAN-002-analytics-integration-feb-8-2026_09-47-am.md)
- **Dependencies**: P3.2.1

### P3.3 Privacy

#### P3.3.1: Build ConsentBanner Component
- **Effort**: Medium (2 days)
- **Priority**: High
- **Component**: Frontend
- **Ref**: [Task P3.3.1](./tasks/task-p3.3.1-build-consent-banner.md)
- **Status**: 🔴 Pending
- **Spec**: [PLAN-002](../plans/PLAN-002-analytics-integration-feb-8-2026_09-47-am.md)
- **Dependencies**: P3.1.3

#### P3.3.2: Implement Consent Management
- **Effort**: Medium (2 days)
- **Priority**: High
- **Component**: Frontend
- **Ref**: [Task P3.3.2](./tasks/task-p3.3.2-implement-consent-management.md)
- **Status**: 🔴 Pending
- **Spec**: [PLAN-002](../plans/PLAN-002-analytics-integration-feb-8-2026_09-47-am.md)
- **Dependencies**: P3.3.1

#### P3.3.3: Add Privacy Settings
- **Effort**: Small (1 day)
- **Priority**: Medium
- **Component**: Frontend
- **Ref**: [Task P3.3.3](./tasks/task-p3.3.3-add-privacy-settings.md)
- **Status**: 🔴 Pending
- **Spec**: [PLAN-002](../plans/PLAN-002-analytics-integration-feb-8-2026_09-47-am.md)
- **Dependencies**: P3.3.2

#### P3.3.4: Implement PII Sanitization
- **Effort**: Small (1 day)
- **Priority**: High
- **Component**: Frontend
- **Ref**: [Task P3.3.4](./tasks/task-p3.3.4-implement-pii-sanitization.md)
- **Status**: 🔴 Pending
- **Spec**: [PLAN-002](../plans/PLAN-002-analytics-integration-feb-8-2026_09-47-am.md)
- **Dependencies**: P3.2.1

### P3.4 Dashboards

#### P3.4.1: Create PostHog Dashboards
- **Effort**: Medium (2 days)
- **Priority**: Medium
- **Component**: Analytics
- **Ref**: [Task P3.4.1](./tasks/task-p3.4.1-create-posthog-dashboards.md)
- **Status**: 🔴 Pending
- **Spec**: [PLAN-002](../plans/PLAN-002-analytics-integration-feb-8-2026_09-47-am.md)
- **Dependencies**: P3.2.3, P3.2.4

#### P3.4.2: Configure Alerting
- **Effort**: Small (1 day)
- **Priority**: Medium
- **Component**: Analytics
- **Ref**: [Task P3.4.2](./tasks/task-p3.4.2-configure-alerting.md)
- **Status**: 🔴 Pending
- **Spec**: [PLAN-002](../plans/PLAN-002-analytics-integration-feb-8-2026_09-47-am.md)
- **Dependencies**: P3.2.5

---

## Phase 4: Templates

### P4.1 Data Layer

#### P4.1.1: Add Templates Table to Schema
- **Effort**: Small (1 day)
- **Priority**: High
- **Component**: Database
- **Ref**: [Task P4.1.1](./tasks/task-p4.1.1-add-templates-table.md)
- **Status**: 🔴 Pending
- **Spec**: [PLAN-003](../plans/PLAN-003-invoice-templates-feb-8-2026_09-48-am.md)
- **Dependencies**: P1.2.2

#### P4.1.2: Add Template Fields to Invoices
- **Effort**: Small (1 day)
- **Priority**: High
- **Component**: Database
- **Ref**: [Task P4.1.2](./tasks/task-p4.1.2-add-template-fields-invoices.md)
- **Status**: 🔴 Pending
- **Spec**: [PLAN-003](../plans/PLAN-003-invoice-templates-feb-8-2026_09-48-am.md)
- **Dependencies**: P4.1.1

#### P4.1.3: Create Default Template Seed Data
- **Effort**: Small (1 day)
- **Priority**: High
- **Component**: Database
- **Ref**: [Task P4.1.3](./tasks/task-p4.1.3-create-default-template-seed.md)
- **Status**: 🔴 Pending
- **Spec**: [PLAN-003](../plans/PLAN-003-invoice-templates-feb-8-2026_09-48-am.md)
- **Dependencies**: P4.1.2

#### P4.1.4: Implement Template Backend API
- **Effort**: Medium (2 days)
- **Priority**: High
- **Component**: Backend
- **Ref**: [Task P4.1.4](./tasks/task-p4.1.4-implement-template-backend-api.md)
- **Status**: 🔴 Pending
- **Spec**: [PLAN-003](../plans/PLAN-003-invoice-templates-feb-8-2026_09-48-am.md)
- **Dependencies**: P4.1.3

### P4.2 Template Renderer

#### P4.2.1: Create TemplateRenderer Component
- **Effort**: Medium (2 days)
- **Priority**: High
- **Component**: PDF Generation
- **Ref**: [Task P4.2.1](./tasks/task-p4.2.1-create-template-renderer.md)
- **Status**: 🔴 Pending
- **Spec**: [PLAN-003](../plans/PLAN-003-invoice-templates-feb-8-2026_09-48-am.md)
- **Dependencies**: P4.1.4

#### P4.2.2: Implement StandardTemplate Layout
- **Effort**: Medium (2 days)
- **Priority**: High
- **Component**: PDF Generation
- **Ref**: [Task P4.2.2](./tasks/task-p4.2.2-implement-standard-template.md)
- **Status**: 🔴 Pending
- **Spec**: [PLAN-003](../plans/PLAN-003-invoice-templates-feb-8-2026_09-48-am.md)
- **Dependencies**: P4.2.1

#### P4.2.3: Implement Layout Variants
- **Effort**: Medium (2 days)
- **Priority**: Medium
- **Component**: PDF Generation
- **Ref**: [Task P4.2.3](./tasks/task-p4.2.3-implement-layout-variants.md)
- **Status**: 🔴 Pending
- **Spec**: [PLAN-003](../plans/PLAN-003-invoice-templates-feb-8-2026_09-48-am.md)
- **Dependencies**: P4.2.2

#### P4.2.4: Update InvoicePDF for Templates
- **Effort**: Medium (2 days)
- **Priority**: High
- **Component**: PDF Generation
- **Ref**: [Task P4.2.4](./tasks/task-p4.2.4-update-invoice-pdf-templates.md)
- **Status**: 🔴 Pending
- **Spec**: [PLAN-003](../plans/PLAN-003-invoice-templates-feb-8-2026_09-48-am.md)
- **Dependencies**: P4.2.3, P2.3.1

### P4.3 Template UI

#### P4.3.1: Build TemplateGallery Component
- **Effort**: Large (1 week)
- **Priority**: Medium
- **Component**: Frontend
- **Ref**: [Task P4.3.1](./tasks/task-p4.3.1-build-template-gallery.md)
- **Status**: 🔴 Pending
- **Spec**: [PLAN-003](../plans/PLAN-003-invoice-templates-feb-8-2026_09-48-am.md)
- **Dependencies**: P4.2.4

#### P4.3.2: Build TemplateEditor Component
- **Effort**: Large (1 week)
- **Priority**: Medium
- **Component**: Frontend
- **Ref**: [Task P4.3.2](./tasks/task-p4.3.2-build-template-editor.md)
- **Status**: 🔴 Pending
- **Spec**: [PLAN-003](../plans/PLAN-003-invoice-templates-feb-8-2026_09-48-am.md)
- **Dependencies**: P4.2.4

#### P4.3.3: Build TemplateSelector Component
- **Effort**: Medium (2 days)
- **Priority**: High
- **Component**: Frontend
- **Ref**: [Task P4.3.3](./tasks/task-p4.3.3-build-template-selector.md)
- **Status**: 🔴 Pending
- **Spec**: [PLAN-003](../plans/PLAN-003-invoice-templates-feb-8-2026_09-48-am.md)
- **Dependencies**: P4.2.4

#### P4.3.4: Integrate Templates into InvoiceForm
- **Effort**: Medium (2 days)
- **Priority**: High
- **Component**: Frontend
- **Ref**: [Task P4.3.4](./tasks/task-p4.3.4-integrate-templates-invoice-form.md)
- **Status**: 🔴 Pending
- **Spec**: [PLAN-003](../plans/PLAN-003-invoice-templates-feb-8-2026_09-48-am.md)
- **Dependencies**: P4.3.3

### P4.4 Polish

#### P4.4.1: Generate Template Thumbnails
- **Effort**: Small (1 day)
- **Priority**: Low
- **Component**: Backend
- **Ref**: [Task P4.4.1](./tasks/task-p4.4.1-generate-template-thumbnails.md)
- **Status**: 🔴 Pending
- **Spec**: [PLAN-003](../plans/PLAN-003-invoice-templates-feb-8-2026_09-48-am.md)
- **Dependencies**: P4.3.1

#### P4.4.2: Add Template Analytics Tracking
- **Effort**: Small (1 day)
- **Priority**: Low
- **Component**: Frontend
- **Ref**: [Task P4.4.2](./tasks/task-p4.4.2-add-template-analytics.md)
- **Status**: 🔴 Pending
- **Spec**: [PLAN-003](../plans/PLAN-003-invoice-templates-feb-8-2026_09-48-am.md)
- **Dependencies**: P4.3.4, P3.2.4

---

## Phase 5: Email Delivery

### P5.1 Setup

#### P5.1.1: Verify Domain and Configure DNS
- **Effort**: Small (1 day)
- **Priority**: High
- **Component**: Infrastructure
- **Ref**: [Task P5.1.1](./tasks/task-p5.1.1-verify-domain-configure-dns.md)
- **Status**: 🔴 Pending
- **Spec**: [PLAN-004](../plans/PLAN-004-resend-email-delivery-feb-8-2026_09-49-am.md)
- **Dependencies**: P1.1.4

#### P5.1.2: Install Resend SDK and React Email
- **Effort**: Small (1 day)
- **Priority**: High
- **Component**: Frontend
- **Ref**: [Task P5.1.2](./tasks/task-p5.1.2-install-resend-react-email.md)
- **Status**: 🔴 Pending
- **Spec**: [PLAN-004](../plans/PLAN-004-resend-email-delivery-feb-8-2026_09-49-am.md)
- **Dependencies**: P5.1.1

### P5.2 Templates

#### P5.2.1: Create InvoiceEmail Template
- **Effort**: Medium (2 days)
- **Priority**: High
- **Component**: Email
- **Ref**: [Task P5.2.1](./tasks/task-p5.2.1-create-invoice-email-template.md)
- **Status**: 🔴 Pending
- **Spec**: [PLAN-004](../plans/PLAN-004-resend-email-delivery-feb-8-2026_09-49-am.md)
- **Dependencies**: P5.1.2

#### P5.2.2: Create ReminderEmail Template
- **Effort**: Medium (2 days)
- **Priority**: Medium
- **Component**: Email
- **Ref**: [Task P5.2.2](./tasks/task-p5.2.2-create-reminder-email-template.md)
- **Status**: 🔴 Pending
- **Spec**: [PLAN-004](../plans/PLAN-004-resend-email-delivery-feb-8-2026_09-49-am.md)
- **Dependencies**: P5.2.1

### P5.3 Send & Track

#### P5.3.1: Implement sendInvoiceEmail Action
- **Effort**: Medium (2 days)
- **Priority**: High
- **Component**: Backend
- **Ref**: [Task P5.3.1](./tasks/task-p5.3.1-implement-send-invoice-email.md)
- **Status**: 🔴 Pending
- **Spec**: [PLAN-004](../plans/PLAN-004-resend-email-delivery-feb-8-2026_09-49-am.md)
- **Dependencies**: P5.2.1, P4.2.4, P2.3.1

#### P5.3.2: Setup Resend Webhook Handler
- **Effort**: Medium (2 days)
- **Priority**: High
- **Component**: Backend
- **Ref**: [Task P5.3.2](./tasks/task-p5.3.2-setup-resend-webhook-handler.md)
- **Status**: 🔴 Pending
- **Spec**: [PLAN-004](../plans/PLAN-004-resend-email-delivery-feb-8-2026_09-49-am.md)
- **Dependencies**: P5.3.1, P1.2.3

### P5.4 Frontend

#### P5.4.1: Build SendEmailModal Component
- **Effort**: Medium (2 days)
- **Priority**: High
- **Component**: Frontend
- **Ref**: [Task P5.4.1](./tasks/task-p5.4.1-build-send-email-modal.md)
- **Status**: 🔴 Pending
- **Spec**: [PLAN-004](../plans/PLAN-004-resend-email-delivery-feb-8-2026_09-49-am.md)
- **Dependencies**: P5.3.1

#### P5.4.2: Build EmailStatusBadge Component
- **Effort**: Small (1 day)
- **Priority**: High
- **Component**: Frontend
- **Ref**: [Task P5.4.2](./tasks/task-p5.4.2-build-email-status-badge.md)
- **Status**: 🔴 Pending
- **Spec**: [PLAN-004](../plans/PLAN-004-resend-email-delivery-feb-8-2026_09-49-am.md)
- **Dependencies**: P5.3.2

#### P5.4.3: Build EmailHistory Component
- **Effort**: Small (1 day)
- **Priority**: Medium
- **Component**: Frontend
- **Ref**: [Task P5.4.3](./tasks/task-p5.4.3-build-email-history.md)
- **Status**: 🔴 Pending
- **Spec**: [PLAN-004](../plans/PLAN-004-resend-email-delivery-feb-8-2026_09-49-am.md)
- **Dependencies**: P5.4.2

#### P5.4.4: Integrate Email Sending into Invoice View
- **Effort**: Small (1 day)
- **Priority**: High
- **Component**: Frontend
- **Ref**: [Task P5.4.4](./tasks/task-p5.4.4-integrate-email-invoice-view.md)
- **Status**: 🔴 Pending
- **Spec**: [PLAN-004](../plans/PLAN-004-resend-email-delivery-feb-8-2026_09-49-am.md)
- **Dependencies**: P5.4.1, P5.4.2

### P5.5 Reminders

#### P5.5.1: Implement Reminder Scheduling
- **Effort**: Medium (2 days)
- **Priority**: Medium
- **Component**: Backend
- **Ref**: [Task P5.5.1](./tasks/task-p5.5.1-implement-reminder-scheduling.md)
- **Status**: 🔴 Pending
- **Spec**: [PLAN-004](../plans/PLAN-004-resend-email-delivery-feb-8-2026_09-49-am.md)
- **Dependencies**: P5.3.2, P5.2.2

#### P5.5.2: Add Email Deliverability Monitoring
- **Effort**: Small (1 day)
- **Priority**: Low
- **Component**: Analytics
- **Ref**: [Task P5.5.2](./tasks/task-p5.5.2-add-deliverability-monitoring.md)
- **Status**: 🔴 Pending
- **Spec**: [PLAN-004](../plans/PLAN-004-resend-email-delivery-feb-8-2026_09-49-am.md)
- **Dependencies**: P5.3.2

---

## Phase 6: Integration & Launch

### P6.1 Integration

#### P6.1.1: End-to-End Feature Integration
- **Effort**: Medium (3 days)
- **Priority**: High
- **Component**: All
- **Ref**: [Task P6.1.1](./tasks/task-p6.1.1-end-to-end-integration.md)
- **Status**: 🔴 Pending
- **Dependencies**: P2.3.3, P3.4.1, P4.3.4, P5.4.4

#### P6.1.2: Cross-Feature Testing
- **Effort**: Medium (3 days)
- **Priority**: High
- **Component**: QA
- **Ref**: [Task P6.1.2](./tasks/task-p6.1.2-cross-feature-testing.md)
- **Status**: 🔴 Pending
- **Dependencies**: P6.1.1

### P6.2 Launch

#### P6.2.1: Staging Deployment
- **Effort**: Small (1 day)
- **Priority**: High
- **Component**: DevOps
- **Ref**: [Task P6.2.1](./tasks/task-p6.2.1-staging-deployment.md)
- **Status**: 🔴 Pending
- **Dependencies**: P6.1.2

#### P6.2.2: Production Launch
- **Effort**: Small (1 day)
- **Priority**: High
- **Component**: DevOps
- **Ref**: [Task P6.2.2](./tasks/task-p6.2.2-production-launch.md)
- **Status**: 🔴 Pending
- **Dependencies**: P6.2.1

---

## Task Dependencies

```
# Phase 1: Foundation
P1.1.1 → P1.2.1
P1.1.2 → P3.1.1
P1.1.3 → P3.1.2
P1.1.4 → P5.1.1

# Phase 2: File Storage
P1.2.1 → P2.1.1
P2.1.1 → P2.1.2
P2.1.2 → P2.1.3, P2.2.1
P2.2.1 → P2.2.2, P2.2.3
P2.2.2 → P2.2.4
P2.2.3 → P2.3.2
P2.2.4 → P2.3.1
P2.3.1 → P4.2.4
P2.3.2 → P2.3.3
P2.3.3 → P2.4.1
P2.4.1 → P2.4.2

# Phase 3: Analytics
P3.1.1, P3.1.2 → P3.1.3
P3.1.3 → P3.2.1, P3.3.1
P3.2.1 → P3.2.2, P3.2.3, P3.2.4, P3.2.5, P3.3.4
P3.2.3, P3.2.4 → P3.4.1
P3.2.5 → P3.4.2
P3.3.1 → P3.3.2
P3.3.2 → P3.3.3

# Phase 4: Templates
P1.2.2 → P4.1.1
P4.1.1 → P4.1.2
P4.1.2 → P4.1.3
P4.1.3 → P4.1.4
P4.1.4 → P4.2.1
P4.2.1 → P4.2.2
P4.2.2 → P4.2.3
P4.2.3 → P4.2.4
P4.2.4 → P4.3.1, P4.3.2, P4.3.3
P4.3.1 → P4.4.1
P4.3.3 → P4.3.4
P4.3.4, P3.2.4 → P4.4.2

# Phase 5: Email
P5.1.1 → P5.1.2
P5.1.2 → P5.2.1
P5.2.1 → P5.2.2, P5.3.1
P5.2.2 → P5.5.1
P5.3.1 → P5.3.2, P5.4.1
P5.3.2, P1.2.3 → P5.4.2, P5.5.2
P5.4.1 → P5.4.4
P5.4.2 → P5.4.3
P5.3.2, P5.2.2 → P5.5.1

# Phase 6: Integration & Launch
P2.3.3, P3.4.1, P4.3.4, P5.4.4 → P6.1.1
P6.1.1 → P6.1.2
P6.1.2 → P6.2.1
P6.2.1 → P6.2.2
```

---

## Definition of Done

### For All Tasks
- [ ] Code complete and committed
- [ ] Unit tests written (>80% coverage)
- [ ] Integration tests passing
- [ ] Code reviewed and approved
- [ ] Documentation updated
- [ ] No console errors or warnings
- [ ] Responsive design verified
- [ ] Accessibility checked

### For Feature Tasks
- [ ] Feature works as specified in PLAN document
- [ ] Edge cases handled
- [ ] Error states implemented
- [ ] Loading states implemented
- [ ] Analytics events tracked (if applicable)

### For Backend Tasks
- [ ] API documented
- [ ] Validation rules implemented
- [ ] Error handling with proper HTTP status codes
- [ ] Database migrations tested

### For Frontend Tasks
- [ ] Component stories written (Storybook)
- [ ] TypeScript types complete
- [ ] Responsive tested (mobile, tablet, desktop)
- [ ] Dark mode support verified

---

## Progress Summary

| Phase | Total Tasks | Completed | In Progress | Pending |
|-------|-------------|-----------|-------------|---------|
| Phase 1: Foundation | 7 | 0 | 0 | 7 |
| Phase 2: File Storage | 13 | 0 | 0 | 13 |
| Phase 3: Analytics | 14 | 0 | 0 | 14 |
| Phase 4: Templates | 13 | 0 | 0 | 13 |
| Phase 5: Email Delivery | 14 | 0 | 0 | 14 |
| Phase 6: Integration | 4 | 0 | 0 | 4 |
| **Total** | **65** | **0** | **0** | **65** |

---

## Quick Links

### Specification Documents
- [PLAN-001: File Storage](../plans/PLAN-001-cloudflare-r2-file-storage-feb-8-2026_09-46-am.md)
- [PLAN-002: Analytics](../plans/PLAN-002-analytics-integration-feb-8-2026_09-47-am.md)
- [PLAN-003: Templates](../plans/PLAN-003-invoice-templates-feb-8-2026_09-48-am.md)
- [PLAN-004: Email](../plans/PLAN-004-resend-email-delivery-feb-8-2026_09-49-am.md)
- [ROADMAP-001: Master Roadmap](../plans/ROADMAP-001-feature-implementation-q1-2026-feb-8-2026_09-51-am.md)

### Task Files
All individual task files are in [`./tasks/`](./tasks/)

---

*Last updated: Feb 8, 2026*
