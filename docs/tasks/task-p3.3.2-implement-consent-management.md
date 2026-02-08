# Task: Implement Consent Management

**Task ID**: P3.3.2  
**Created**: Feb 8, 2026  
**Updated**: Feb 8, 2026  
**Status**: 🔴 Pending  
**Priority**: High  
**Effort**: Medium (2 days)  
**Component**: Frontend

---

## Problem Statement
We need a centralized consent management system that tracks user privacy preferences and controls which analytics services are active based on those preferences.

---

## Objective
Create a consent management context/provider that:
- Stores and retrieves consent preferences
- Provides current consent state to all components
- Reacts to consent changes (enable/disable analytics)
- Persists preferences across sessions

---

## Implementation Plan

### 1. Create ConsentContext
Create `src/contexts/ConsentContext.tsx`:
```typescript
type ConsentLevel = 'all' | 'essential' | 'none';

interface ConsentContextType {
  consent: ConsentLevel;
  hasConsent: boolean;
  hasFullConsent: boolean;
  setConsent: (level: ConsentLevel) => void;
  clearConsent: () => void;
}
```

### 2. Create ConsentProvider
Create `src/providers/ConsentProvider.tsx`:
```typescript
export function ConsentProvider({ children }: Props) {
  const [consent, setConsent] = useState<ConsentLevel>(() => {
    // Load from localStorage or default to null
  });
  
  // Persist to localStorage on change
  useEffect(() => {
    if (consent) localStorage.setItem('analytics_consent', consent);
  }, [consent]);
  
  // React to consent changes - enable/disable analytics
  useEffect(() => {
    // Trigger analytics enable/disable
  }, [consent]);
  
  return (
    <ConsentContext.Provider value={{ consent, setConsent, ... }}>
      {children}
    </ConsentContext.Provider>
  );
}
```

### 3. Create useConsent Hook
Create `src/hooks/useConsent.ts`:
```typescript
export function useConsent() {
  const context = useContext(ConsentContext);
  if (!context) throw new Error('useConsent must be used within ConsentProvider');
  return context;
}
```

### 4. Integrate with AnalyticsProvider
Modify AnalyticsProvider to:
- Use consent state from ConsentProvider
- Conditionally load PostHog (only on 'all')
- Conditionally load Plausible (on 'all' or 'essential')
- Handle consent changes dynamically

### 5. Handle Consent Changes
When consent changes:
- 'none' → disable all tracking
- 'essential' → enable Plausible only
- 'all' → enable both services
- Load/unload scripts as needed

---

## File Structure

```
src/
  contexts/
    ConsentContext.tsx
  providers/
    ConsentProvider.tsx
  hooks/
    useConsent.ts
```

---

## Dependencies

- P3.3.1 (ConsentBanner component created)

---

## Acceptance Criteria

- [ ] ConsentContext created with consent state and methods
- [ ] ConsentProvider wraps the application
- [ ] useConsent hook provides access to consent state
- [ ] Consent persisted to localStorage
- [ ] Analytics services react to consent changes
- [ ] Consent can be changed at any time via settings
- [ ] Initial consent load from localStorage on app start
- [ ] TypeScript types exported for external use
- [ ] Provider handles SSR/hydration correctly
- [ ] Unit tests for context and hook

---

## Related Documentation

- Spec: [PLAN-002](../plans/PLAN-002-analytics-integration-feb-8-2026_09-47-am.md)
- Main Index: [tasks.md](../tasks.md)
