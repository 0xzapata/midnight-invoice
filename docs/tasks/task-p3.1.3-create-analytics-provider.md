# Task: Create AnalyticsProvider Component

**Task ID**: P3.1.3  
**Created**: Feb 8, 2026  
**Updated**: Feb 8, 2026  
**Status**: 🔴 Pending  
**Priority**: High  
**Effort**: Medium (2 days)  
**Component**: Frontend

---

## Problem Statement
We need a unified provider component that wraps the application and manages both PostHog and Plausible analytics services based on user consent preferences.

---

## Objective
Create an `AnalyticsProvider` React component that:
- Wraps the app with PostHog and Plausible providers
- Conditionally enables services based on consent
- Initializes analytics only when appropriate
- Provides a clean API for child components

---

## Implementation Plan

### 1. Create AnalyticsProvider Component
Create `src/providers/AnalyticsProvider.tsx`:
```typescript
import { PostHogProvider } from 'posthog-js/react';
import PlausibleProvider from 'next-plausible';

interface AnalyticsProviderProps {
  children: React.ReactNode;
}

export function AnalyticsProvider({ children }: AnalyticsProviderProps) {
  // Implementation with consent-based conditional loading
}
```

### 2. Implement Consent-Based Loading Logic
- Plausible loads if consent !== 'none' (privacy-safe, no cookies)
- PostHog loads only if consent === 'all' (requires opt-in)
- Handle initialization errors gracefully

### 3. Configure PostHog Options
- `capture_pageview: false` (manual tracking)
- `persistence: 'memory'` (no cookies)
- `sanitize_properties`: custom sanitization function
- Disable session recording by default

### 4. Add Route Change Tracking
Create effect to track page views on route changes:
- Use react-router location
- Send pageview to both PostHog and Plausible
- Include path and referrer

### 5. Integrate with App
Wrap the application in `src/main.tsx`:
```tsx
<AnalyticsProvider>
  <App />
</AnalyticsProvider>
```

---

## File Structure

```
src/
  providers/
    AnalyticsProvider.tsx
    index.ts
  lib/
    analytics/
      config.ts       # Shared configuration
      sanitization.ts # PII sanitization
```

---

## Dependencies

- P3.1.1 (PostHog SDK installed)
- P3.1.2 (Plausible configured)

---

## Acceptance Criteria

- [ ] AnalyticsProvider component created in `src/providers/`
- [ ] Component conditionally loads PostHog based on consent
- [ ] Plausible loads for non-'none' consent states
- [ ] Route change tracking implemented
- [ ] Application wrapped with AnalyticsProvider in main.tsx
- [ ] No analytics scripts loaded when consent is 'none'
- [ ] Graceful error handling for initialization failures
- [ ] TypeScript types properly defined
- [ ] Unit tests for provider logic

---

## Related Documentation

- Spec: [PLAN-002](../plans/PLAN-002-analytics-integration-feb-8-2026_09-47-am.md)
- Main Index: [tasks.md](../tasks.md)
