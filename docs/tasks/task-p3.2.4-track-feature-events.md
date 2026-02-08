# Task: Track Feature Usage Events

**Task ID**: P3.2.4  
**Created**: Feb 8, 2026  
**Updated**: Feb 8, 2026  
**Status**: 🔴 Pending  
**Priority**: Medium  
**Effort**: Medium (2 days)  
**Component**: Frontend

---

## Problem Statement
We need to understand which features users engage with most to prioritize development efforts. Feature usage tracking provides insights into product adoption.

---

## Objective
Implement tracking for key feature usage: templates, teams, clients, settings changes, and logo uploads.

---

## Implementation Plan

### 1. Template Feature Tracking
```typescript
track('template_applied', {
  template_id: string,
  category: string,
  invoice_id: string,
});

track('template_customized', {
  template_id: string,
  customizations: string[],
});
```

### 2. Team Feature Tracking
```typescript
track('team_created', {
  team_id: string,
  initial_member_count: number,
});

track('team_joined', {
  team_id: string,
  role: 'admin' | 'member',
});

track('team_member_invited', {
  team_id: string,
  invite_method: 'email' | 'link',
});
```

### 3. Client Management Tracking
```typescript
track('client_added', {
  client_id: string,
  has_email: boolean,
  has_address: boolean,
});

track('client_updated', {
  client_id: string,
});
```

### 4. Settings Tracking
```typescript
track('settings_changed', {
  setting_key: string,
  category: 'profile' | 'company' | 'preferences',
});

track('logo_uploaded', {
  file_size_kb: number,
  file_type: string,
});
```

### 5. Navigation/Discovery Tracking
```typescript
track('feature_discovered', {
  feature: string,
  context: string,
});
```

---

## File Structure

```
src/
  components/
    templates/
      TemplateSelector.tsx    # Track template usage
    teams/
      TeamManager.tsx         # Track team operations
    clients/
      ClientForm.tsx          # Track client management
    settings/
      SettingsPanel.tsx       # Track settings changes
      LogoUpload.tsx          # Track logo uploads
```

---

## Dependencies

- P3.2.1 (useAnalytics hook implemented)

---

## Acceptance Criteria

- [ ] `template_applied` event tracked with template_id
- [ ] `team_created` and `team_joined` events tracked
- [ ] `client_added` event tracked with has_email, has_address
- [ ] `settings_changed` event tracked for key settings
- [ ] `logo_uploaded` event tracked with file metadata
- [ ] Feature usage visible in analytics funnels
- [ ] Events help identify most/least used features
- [ ] No sensitive data in event properties

---

## Related Documentation

- Spec: [PLAN-002](../plans/PLAN-002-analytics-integration-feb-8-2026_09-47-am.md)
- Main Index: [tasks.md](../tasks.md)
