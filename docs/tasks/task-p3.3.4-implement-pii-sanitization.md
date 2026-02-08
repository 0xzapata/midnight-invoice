# Task: Implement PII Sanitization

**Task ID**: P3.3.4  
**Created**: Feb 8, 2026  
**Updated**: Feb 8, 2026  
**Status**: 🔴 Pending  
**Priority**: High  
**Effort**: Small (1 day)  
**Component**: Frontend

---

## Problem Statement
To ensure privacy compliance and user trust, we must prevent any personally identifiable information (PII) from being sent to analytics services.

---

## Objective
Create a comprehensive PII sanitization system that:
- Removes emails, phone numbers, names from event properties
- Hashes user identifiers
- Redacts sensitive query parameters
- Validates all data before sending to analytics

---

## Implementation Plan

### 1. Create Sanitization Utilities
Create `src/lib/analytics/sanitization.ts`:
```typescript
export function sanitizeProperties(
  properties: Record<string, unknown>
): Record<string, unknown> {
  // Deep clone and sanitize
}

export function sanitizeString(value: string): string {
  // Remove email patterns
  // Remove phone patterns
  // Remove address patterns
}

export function hashUserId(userId: string): string {
  // Hash with salt for anonymization
}
```

### 2. Define PII Patterns
Create patterns to detect and remove:
- Email addresses: `/[^\s@]+@[^\s@]+\.[^\s@]+/g`
- Phone numbers: various international formats
- Credit cards: masked or removed
- IP addresses
- Physical addresses

### 3. Implement URL Sanitization
```typescript
export function sanitizeUrl(url: string): string {
  // Remove query parameters that might contain PII
  // Keep only safe params like 'page', 'id'
}
```

### 4. Update useAnalytics Hook
Integrate sanitization into the hook:
```typescript
const track = useCallback((event, properties) => {
  const sanitized = sanitizeProperties(properties);
  // Send sanitized data
}, []);
```

### 5. Configure PostHog Sanitization
Add to PostHog config:
```typescript
posthog.init(key, {
  sanitize_properties: (properties) => {
    return sanitizeProperties(properties);
  },
});
```

### 6. Create Tests
Write tests to verify:
- Emails are removed/replaced
- Phone numbers are sanitized
- User IDs are hashed consistently
- Nested objects are sanitized
- Arrays are sanitized

---

## File Structure

```
src/
  lib/
    analytics/
      sanitization.ts       # PII sanitization functions
      sanitization.test.ts  # Unit tests
```

---

## Dependencies

- P3.2.1 (useAnalytics hook implemented)

---

## Acceptance Criteria

- [ ] sanitizeProperties function created and tested
- [ ] Email addresses removed from all event data
- [ ] Phone numbers removed from all event data
- [ ] User IDs hashed before sending to PostHog
- [ ] Query parameters with PII redacted
- [ ] PostHog configured with sanitize_properties callback
- [ ] All event properties pass through sanitization
- [ ] Unit tests cover various PII patterns
- [ ] No PII visible in analytics dashboards
- [ ] Performance impact is minimal

---

## Related Documentation

- Spec: [PLAN-002](../plans/PLAN-002-analytics-integration-feb-8-2026_09-47-am.md)
- Main Index: [tasks.md](../tasks.md)
