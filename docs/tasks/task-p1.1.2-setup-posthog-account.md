# Task: Setup PostHog Account

**Task ID**: P1.1.2  
**Created**: Feb 8, 2026  
**Updated**: Feb 8, 2026  
**Status**: 🔴 Pending  
**Priority**: High  
**Effort**: Small (1 day)  
**Component**: Analytics

---

## Problem Statement
The application currently has no product analytics, making it impossible to understand user behavior, measure feature adoption, or track conversion funnels.

---

## Objective
Create a PostHog account and project for comprehensive product analytics tracking.

---

## Implementation Plan

### 1. Create PostHog Account
- Sign up at https://posthog.com
- Choose cloud-hosted option (free tier: 1M events/month)
- Verify email address

### 2. Create New Project
- Project name: "Midnight Invoice"
- Configure timezone and currency settings
- Set data retention policy (recommend 1 year)

### 3. Get API Keys
- Copy Project API Key (format: `phc_xxxxxxxxxxxxxxxxxxxx`)
- Copy API Host URL (e.g., `https://us.i.posthog.com`)
- Generate Personal API Key for server-side usage (optional)

### 4. Configure Project Settings
- Enable session recording (for UX insights)
- Set up autocapture for pageviews and clicks
- Configure user identification strategy
- Set up data masking for sensitive fields

### 5. Set Environment Variables
Add to `.env.local`:
```bash
VITE_POSTHOG_KEY=phc_xxxxxxxxxxxxxxxxxxxx
VITE_POSTHOG_HOST=https://us.i.posthog.com
VITE_ANALYTICS_DEBUG=false
```

### 6. Invite Team Members
- Add team members with appropriate permissions
- Set up admin and viewer roles

---

## File Structure

```
.env.local (updated)
├── VITE_POSTHOG_KEY
├── VITE_POSTHOG_HOST
├── VITE_ANALYTICS_DEBUG
```

---

## Dependencies

- PostHog account (free tier sufficient for MVP)
- Team access to PostHog dashboard

---

## Acceptance Criteria

- [ ] PostHog account created and verified
- [ ] "Midnight Invoice" project created with proper settings
- [ ] API keys obtained and documented securely
- [ ] Environment variables configured in project
- [ ] Project settings configured (timezone, retention)
- [ ] Team members invited with appropriate permissions
- [ ] Test event sent and received in PostHog dashboard
- [ ] Documentation updated with analytics setup

---

## Related Documentation

- Spec: [PLAN-002](../plans/PLAN-002-analytics-integration-feb-8-2026_09-47-am.md)
- Main Index: [tasks.md](../tasks.md)
- PostHog Docs: https://posthog.com/docs

---

## Notes

- Free tier includes 1M events/month and 5,000 session recordings
- PostHog offers product analytics, feature flags, A/B testing, and session replay
- Consider GDPR compliance - data is stored in US by default
- Can self-host PostHog later if needed for data residency
