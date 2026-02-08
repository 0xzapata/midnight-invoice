# Task: Staging Deployment

**Task ID**: P6.2.1  
**Created**: Feb 8, 2026  
**Updated**: Feb 8, 2026  
**Status**: 🔴 Pending  
**Priority**: High  
**Effort**: Medium (3 days)  
**Component**: DevOps

---

## Problem Statement

Before launching to production, we need a staging environment that mirrors production configuration to validate all features work correctly with real external services (R2, Resend, PostHog, Plausible). This prevents production issues by catching configuration errors, environment mismatches, and integration problems early.

---

## Objective

Deploy complete application to staging environment:
- Production-like environment configuration
- All external services integrated with test accounts
- Automated smoke tests passing
- Team validation completed

---

## Implementation Plan

### 1. Staging Environment Setup

Configure staging infrastructure:
- Vercel staging deployment target
- Convex staging project
- Environment variables for all services (staging keys)
- Separate R2 bucket for staging files
- Resend staging domain configuration
- PostHog/Plausible staging projects

### 2. Configuration Management

Set up environment-specific configs:

```
.env.staging
├── VITE_CONVEX_URL (staging)
├── VITE_R2_BUCKET (staging-bucket)
├── VITE_RESEND_API_KEY (test key)
├── VITE_POSTHOG_KEY (staging project)
├── VITE_PLAUSIBLE_DOMAIN (staging.midnight-invoice.dev)
└── ... other service keys
```

### 3. Database Migration

Prepare staging database:
- Run all schema migrations on staging Convex project
- Seed with test data representing various scenarios
- Verify migration rollback procedures

### 4. Smoke Test Suite

Automated validation tests:
- Application loads without errors
- Authentication flows work
- File upload/download functional
- Template rendering correct
- Email sending works (to test addresses)
- Analytics events firing
- Core API endpoints responding

### 5. Manual Validation Checklist

Team validation of staging:
- [ ] Create invoice with template and logo
- [ ] Send test email with PDF attachment
- [ ] Verify email delivery tracking
- [ ] Check analytics dashboard for events
- [ ] Test file attachments in emails
- [ ] Validate PWA functionality
- [ ] Cross-browser smoke test
- [ ] Mobile device testing

### 6. Performance Baseline

Establish staging performance metrics:
- Page load times
- PDF generation latency
- Email send latency
- File upload/download speeds
- API response times

---

## File Structure

```
.
├── .env.staging                    # Staging environment variables
├── vercel.json                     # Deployment configuration
├── convex/
│   └── _seedData/                 # Staging seed data
│       ├── test-invoices.ts
│       ├── test-templates.ts
│       └── test-users.ts
└── scripts/
    ├── staging-deploy.sh          # Deployment script
    ├── smoke-tests.sh             # Automated smoke tests
    └── seed-staging.ts            # Database seeding
```

---

## Dependencies

- P6.1.1 (End-to-End Feature Integration)
- P6.1.2 (Cross-Feature Testing)
- All external service accounts configured

---

## Acceptance Criteria

- [ ] Staging environment deployed and accessible
- [ ] All environment variables configured correctly
- [ ] Database migrations applied successfully
- [ ] Automated smoke tests passing (10+ tests)
- [ ] Manual validation checklist completed by team
- [ ] Performance baselines documented
- [ ] Rollback procedure tested and documented
- [ ] Staging URL shared with stakeholders
- [ ] No critical or high bugs blocking production

---

## Related Documentation

- Roadmap: [ROADMAP-001](../plans/ROADMAP-001-feature-implementation-q1-2026-feb-8-2026_09-51-am.md)
- Main Index: [tasks.md](../tasks.md)
- Launch Checklist: [ROADMAP-001 Section 10.1](../plans/ROADMAP-001-feature-implementation-q1-2026-feb-8-2026_09-51-am.md#101-pre-launch-week-11)
