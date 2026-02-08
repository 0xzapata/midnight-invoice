# Task: Build ConsentBanner Component

**Task ID**: P3.3.1  
**Created**: Feb 8, 2026  
**Updated**: Feb 8, 2026  
**Status**: 🔴 Pending  
**Priority**: High  
**Effort**: Medium (2 days)  
**Component**: Frontend

---

## Problem Statement
GDPR compliance requires explicit user consent for analytics tracking. We need a non-intrusive consent banner that allows users to choose their privacy preferences.

---

## Objective
Create a `ConsentBanner` component that:
- Appears on first visit for new users
- Provides options: Accept All, Essential Only, Customize
- Matches the app's dark theme
- Is dismissible but persists choice
- Links to privacy policy

---

## Implementation Plan

### 1. Create ConsentBanner Component
Create `src/components/analytics/ConsentBanner.tsx`:
```typescript
interface ConsentBannerProps {
  onAcceptAll: () => void;
  onEssentialOnly: () => void;
  onCustomize: () => void;
  onClose: () => void;
}
```

### 2. Design the Banner
- Fixed position at bottom of viewport
- Dark theme matching app design
- Clear, concise copy explaining analytics use
- Three action buttons:
  - "Accept All" - enables PostHog + Plausible
  - "Essential Only" - enables Plausible only
  - "Customize" - opens detailed settings

### 3. Implement Consent Storage
Use localStorage to persist consent choice:
```typescript
const CONSENT_KEY = 'analytics_consent';
type ConsentLevel = 'all' | 'essential' | 'none';
```

### 4. Add Animation
- Slide up animation on appear
- Fade out on dismiss
- Smooth transitions between states

### 5. Create Customize Modal
Create `src/components/analytics/ConsentCustomizeModal.tsx`:
- Toggle switches for each analytics service
- Detailed explanations of what each service does
- Save and Cancel buttons

### 6. Ensure Accessibility
- Keyboard navigation support
- Screen reader friendly
- Focus trap when open
- ARIA labels for buttons

---

## File Structure

```
src/
  components/
    analytics/
      ConsentBanner.tsx           # Main banner component
      ConsentCustomizeModal.tsx   # Detailed settings modal
      index.ts
```

---

## Dependencies

- P3.1.3 (AnalyticsProvider created - for integration context)

---

## Acceptance Criteria

- [ ] ConsentBanner component created with dark theme styling
- [ ] Three main action buttons: Accept All, Essential Only, Customize
- [ ] Banner appears on first visit (no prior consent)
- [ ] Consent choice persisted to localStorage
- [ ] Customize modal allows granular control
- [ ] Banner dismisses smoothly after selection
- [ ] Privacy policy link included
- [ ] Responsive design (mobile-friendly)
- [ ] Accessible (keyboard nav, ARIA labels, focus trap)
- [ ] Animation/transition effects implemented
- [ ] Component tested with React Testing Library

---

## Related Documentation

- Spec: [PLAN-002](../plans/PLAN-002-analytics-integration-feb-8-2026_09-47-am.md)
- Main Index: [tasks.md](../tasks.md)
