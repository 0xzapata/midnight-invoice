# Task: Setup Error Tracking

**Task ID**: P3.2.5  
**Created**: Feb 8, 2026  
**Updated**: Feb 8, 2026  
**Status**: 🔴 Pending  
**Priority**: High  
**Effort**: Medium (2 days)  
**Component**: Frontend

---

## Problem Statement
Production errors need to be captured and tracked to identify and fix issues before users report them. Currently, there's no visibility into frontend errors.

---

## Objective
Set up comprehensive error tracking using PostHog with React error boundaries, API error tracking, and automatic error context collection.

---

## Implementation Plan

### 1. Configure PostHog Error Tracking
Enable error tracking in PostHog configuration:
```typescript
posthog.init(key, {
  capture_exceptions: true,
  // ... other options
});
```

### 2. Create Error Boundary Component
Create `src/components/ErrorBoundary.tsx`:
```typescript
class ErrorBoundary extends React.Component {
  componentDidCatch(error, errorInfo) {
    posthog.captureException(error, {
      componentStack: errorInfo.componentStack,
    });
  }
}
```

### 3. Add Global Error Handler
Create `src/lib/analytics/errorTracking.ts`:
```typescript
window.addEventListener('error', (event) => {
  track('error_occurred', {
    error_message: event.message,
    error_source: event.filename,
    error_line: event.lineno,
  });
});

window.addEventListener('unhandledrejection', (event) => {
  track('unhandled_promise_rejection', {
    reason: String(event.reason),
  });
});
```

### 4. Track API Errors
Add to API client/error handling:
```typescript
track('api_error', {
  endpoint: string,
  status_code: number,
  error_type: string,
  retry_count: number,
});
```

### 5. Track Component Render Errors
Wrap key components with error boundary:
```tsx
<ErrorBoundary>
  <InvoiceForm />
</ErrorBoundary>
```

### 6. Configure Source Maps
- Upload source maps to PostHog
- Configure build process to generate source maps
- Ensure stack traces are readable

---

## File Structure

```
src/
  components/
    ErrorBoundary.tsx         # React error boundary
    ErrorFallback.tsx         # Error UI component
  lib/
    analytics/
      errorTracking.ts        # Global error handlers
      config.ts               # PostHog config with error capture
```

---

## Dependencies

- P3.2.1 (useAnalytics hook implemented)

---

## Acceptance Criteria

- [ ] PostHog exception capture enabled
- [ ] React ErrorBoundary component created
- [ ] Global error handler captures uncaught errors
- [ ] Unhandled promise rejections tracked
- [ ] API errors tracked with endpoint and status code
- [ ] Key components wrapped with error boundary
- [ ] Source maps uploaded to PostHog
- [ ] Errors visible in PostHog with stack traces
- [ ] Error alerts configured (prepare for P3.4.2)

---

## Related Documentation

- Spec: [PLAN-002](../plans/PLAN-002-analytics-integration-feb-8-2026_09-47-am.md)
- Main Index: [tasks.md](../tasks.md)
- PostHog Error Tracking: https://posthog.com/docs/error-tracking
