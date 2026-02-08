# Task: Install and Configure Plausible

**Task ID**: P3.1.2  
**Created**: Feb 8, 2026  
**Updated**: Feb 8, 2026  
**Status**: 🔴 Pending  
**Priority**: High  
**Effort**: Small (1 day)  
**Component**: Frontend

---

## Problem Statement
Plausible provides privacy-focused, GDPR-compliant analytics without cookies. We need to integrate Plausible for aggregated, anonymous page view tracking as a lightweight alternative to cookie-based analytics.

---

## Objective
Install and configure Plausible analytics script for page view tracking with automatic route change detection.

---

## Implementation Plan

### 1. Install Plausible
```bash
bun add next-plausible
```

### 2. Configure Environment Variables
Add to `.env`:
```bash
VITE_PLAUSIBLE_DOMAIN=midnight-invoice.com
```

### 3. Create Plausible Provider Configuration
Create `src/lib/analytics/plausible.ts`:
- Configure PlausibleProvider with domain
- Set up manual page view tracking
- Configure custom event support

### 4. Add Script to HTML (Fallback Option)
Alternative: Add script tag to `index.html` for simple integration:
```html
<script defer data-domain="midnight-invoice.com" src="https://plausible.io/js/script.js"></script>
```

### 5. Verify Installation
- Check network requests to Plausible
- Verify page views are tracked
- Test custom events

---

## File Structure

```
src/
  lib/
    analytics/
      plausible.ts
      index.ts
```

---

## Dependencies

- P1.1.3 (Plausible account setup complete)

---

## Acceptance Criteria

- [ ] Plausible package installed via package manager
- [ ] Environment variable `VITE_PLAUSIBLE_DOMAIN` configured
- [ ] Plausible provider/configuration file created
- [ ] Page view tracking working on route changes
- [ ] No cookies set (verify in Application tab)
- [ ] No console errors
- [ ] Events visible in Plausible dashboard

---

## Related Documentation

- Spec: [PLAN-002](../plans/PLAN-002-analytics-integration-feb-8-2026_09-47-am.md)
- Main Index: [tasks.md](../tasks.md)
- Plausible Docs: https://plausible.io/docs
