# Task: Add Privacy Settings

**Task ID**: P3.3.3  
**Created**: Feb 8, 2026  
**Updated**: Feb 8, 2026  
**Status**: 🔴 Pending  
**Priority**: Medium  
**Effort**: Small (1 day)  
**Component**: Frontend

---

## Problem Statement
Users need a way to view and modify their privacy preferences after the initial consent banner. This is required for GDPR compliance (right to change consent).

---

## Objective
Add a Privacy Settings section to the Settings panel where users can:
- View current consent status
- Change analytics preferences
- Export their data
- Request data deletion

---

## Implementation Plan

### 1. Create PrivacySettings Component
Create `src/components/settings/PrivacySettings.tsx`:
```typescript
export function PrivacySettings() {
  const { consent, setConsent } = useConsent();
  
  return (
    <SettingsSection title="Privacy">
      {/* Consent controls */}
      {/* Data export */}
      {/* Data deletion */}
    </SettingsSection>
  );
}
```

### 2. Implement Consent Controls
- Radio buttons or toggle for consent level
- Show current selection
- Apply changes immediately
- Show confirmation toast

### 3. Add Data Export Section
```typescript
track('data_export_requested');
// Trigger data export from backend
```

### 4. Add Data Deletion Section
```typescript
track('data_deletion_requested');
// Trigger deletion workflow
```

### 5. Add Privacy Policy Link
- Link to full privacy policy
- Brief summary of data practices
- What each analytics service collects

### 6. Integrate into Settings Panel
Add PrivacySettings as a section in the main Settings component.

---

## File Structure

```
src/
  components/
    settings/
      PrivacySettings.tsx    # New privacy settings component
      SettingsPanel.tsx      # Update to include PrivacySettings
```

---

## Dependencies

- P3.3.2 (Consent management implemented)

---

## Acceptance Criteria

- [ ] PrivacySettings component created
- [ ] Current consent status displayed
- [ ] Users can change consent level
- [ ] Changes apply immediately (analytics enable/disable)
- [ ] Data export option available
- [ ] Data deletion request option available
- [ ] Privacy policy link included
- [ ] Component integrated into Settings panel
- [ ] Responsive design
- [ ] Accessible (proper labels, focus management)

---

## Related Documentation

- Spec: [PLAN-002](../plans/PLAN-002-analytics-integration-feb-8-2026_09-47-am.md)
- Main Index: [tasks.md](../tasks.md)
