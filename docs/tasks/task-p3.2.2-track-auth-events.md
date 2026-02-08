# Task: Track User Authentication Events

**Task ID**: P3.2.2  
**Created**: Feb 8, 2026  
**Updated**: Feb 8, 2026  
**Status**: 🔴 Pending  
**Priority**: High  
**Effort**: Small (1 day)  
**Component**: Frontend

---

## Problem Statement
User authentication is a critical conversion funnel. We need to track signup, login, and logout events to measure user acquisition and retention.

---

## Objective
Implement tracking for all user authentication events including signup, login, logout, and authentication failures.

---

## Implementation Plan

### 1. Identify Auth Event Locations
Locate authentication handling in:
- WorkOS/Convex auth integration
- Login/signup forms
- Auth callbacks

### 2. Track Signup Events
Add tracking after successful signup:
```typescript
const { track, identify } = useAnalytics();

// After signup success
track('user_signed_up', {
  method: 'oauth' | 'email',
  has_referral: boolean,
});
identify(user.id, {
  plan: 'free',
  created_at: new Date().toISOString(),
});
```

### 3. Track Login Events
Add tracking after successful login:
```typescript
track('user_logged_in', {
  method: 'oauth' | 'email',
  days_since_last_login: number,
});
```

### 4. Track Logout Events
Add tracking on logout:
```typescript
track('user_logged_out', {
  session_duration_minutes: number,
});
```

### 5. Track Auth Failures
Track failed authentication attempts:
```typescript
track('auth_failed', {
  reason: 'invalid_credentials' | 'network_error',
  method: 'oauth' | 'email',
});
```

---

## File Structure

```
src/
  components/
    auth/
      LoginForm.tsx      # Add login tracking
      SignupForm.tsx     # Add signup tracking
  hooks/
    useAuth.ts           # Add logout tracking if exists
  lib/
    analytics/
      events.ts          # Ensure AUTH events defined
```

---

## Dependencies

- P3.2.1 (useAnalytics hook implemented)

---

## Acceptance Criteria

- [ ] `user_signed_up` event tracked with method and has_referral properties
- [ ] `user_logged_in` event tracked with method property
- [ ] `user_logged_out` event tracked
- [ ] `auth_failed` event tracked for login failures
- [ ] User identified in PostHog after signup/login
- [ ] No PII (emails, names) sent in event properties
- [ ] Events visible in PostHog and Plausible dashboards
- [ ] Tests verify events are fired correctly

---

## Related Documentation

- Spec: [PLAN-002](../plans/PLAN-002-analytics-integration-feb-8-2026_09-47-am.md)
- Main Index: [tasks.md](../tasks.md)
