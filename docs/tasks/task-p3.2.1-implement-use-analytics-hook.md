# Task: Implement useAnalytics Hook

**Task ID**: P3.2.1  
**Created**: Feb 8, 2026  
**Updated**: Feb 8, 2026  
**Status**: 🔴 Pending  
**Priority**: High  
**Effort**: Medium (2 days)  
**Component**: Frontend

---

## Problem Statement
Components need a unified way to track events to both PostHog and Plausible with consistent API, automatic consent checking, and PII sanitization.

---

## Objective
Create a `useAnalytics` hook that provides:
- `track()` method for custom events
- `identify()` method for user identification
- `pageView()` method for manual page tracking
- Automatic consent checking before sending
- PII sanitization for all event properties

---

## Implementation Plan

### 1. Create useAnalytics Hook
Create `src/hooks/useAnalytics.ts`:
```typescript
import { usePostHog } from 'posthog-js/react';
import { usePlausible } from 'next-plausible';

export function useAnalytics() {
  const posthog = usePostHog();
  const plausible = usePlausible();
  const { consent } = useConsent(); // From consent management
  
  const track = useCallback((event: string, properties?: Record<string, unknown>) => {
    // Send to Plausible (if consented)
    // Send to PostHog (if full consent)
  }, [consent, posthog, plausible]);
  
  const identify = useCallback((userId: string, properties?: object) => {
    // Hash user ID, sanitize properties
  }, [consent, posthog]);
  
  const pageView = useCallback((path: string) => {
    // Track page view to both services
  }, [consent, posthog, plausible]);
  
  return { track, identify, pageView };
}
```

### 2. Implement PII Sanitization
Create `src/lib/analytics/sanitization.ts`:
- Remove email addresses
- Remove phone numbers
- Remove names and addresses
- Hash user IDs
- Redact sensitive query parameters

### 3. Define Event Types
Create `src/lib/analytics/events.ts`:
```typescript
export const AnalyticsEvents = {
  USER_SIGNED_UP: 'user_signed_up',
  USER_LOGGED_IN: 'user_logged_in',
  INVOICE_CREATED: 'invoice_created',
  // ... more events
} as const;
```

### 4. Add Helper Functions
- `sanitizeProperties()`: Clean event properties
- `hashUserId()`: Anonymize user identifiers
- `getPageContext()`: Get current page metadata

### 5. Create Tests
Write unit tests for:
- Hook returns correct methods
- Events are sent to appropriate services based on consent
- PII is properly sanitized
- No events sent when consent is 'none'

---

## File Structure

```
src/
  hooks/
    useAnalytics.ts
    index.ts
  lib/
    analytics/
      events.ts         # Event constants and types
      sanitization.ts   # PII sanitization functions
      types.ts          # Shared TypeScript types
```

---

## Dependencies

- P3.1.3 (AnalyticsProvider created)
- P3.3.2 (Consent management - or use temporary mock)

---

## Acceptance Criteria

- [ ] useAnalytics hook created in `src/hooks/`
- [ ] Hook returns `track()`, `identify()`, and `pageView()` methods
- [ ] Events sent to Plausible when consent !== 'none'
- [ ] Events sent to PostHog only when consent === 'all'
- [ ] PII sanitization applied to all event properties
- [ ] User IDs are hashed before sending to PostHog
- [ ] Event constants defined in `events.ts`
- [ ] TypeScript types exported for event properties
- [ ] Unit tests with >80% coverage
- [ ] Hook works correctly in components

---

## Related Documentation

- Spec: [PLAN-002](../plans/PLAN-002-analytics-integration-feb-8-2026_09-47-am.md)
- Main Index: [tasks.md](../tasks.md)
