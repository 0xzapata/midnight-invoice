# Task: Setup Plausible Analytics

**Task ID**: P1.1.3  
**Created**: Feb 8, 2026  
**Updated**: Feb 8, 2026  
**Status**: 🔴 Pending  
**Priority**: High  
**Effort**: Small (1 day)  
**Component**: Analytics

---

## Problem Statement
The application needs privacy-focused analytics that work without cookies and comply with GDPR without requiring complex consent mechanisms.

---

## Objective
Set up Plausible Analytics for privacy-compliant, lightweight web analytics.

---

## Implementation Plan

### 1. Create Plausible Account
- Sign up at https://plausible.io
- Choose subscription plan ($9/month for 10k pageviews)
- Or self-host if preferred (requires server)

### 2. Add New Site
- Domain: `midnight-invoice.com`
- Timezone: Set to primary user timezone
- Configure reporting preferences

### 3. Get Tracking Script
- Copy the tracking snippet provided by Plausible
- Script format: `https://plausible.io/js/script.js`

### 4. Configure Enhanced Measurements
- Enable outbound link tracking (optional)
- Enable file download tracking (optional)
- Set up custom events for feature tracking

### 5. Set Environment Variables
Add to `.env.local`:
```bash
VITE_PLAUSIBLE_DOMAIN=midnight-invoice.com
```

### 6. Enable Public Dashboard (Optional)
- Create shareable dashboard link
- Useful for transparency and team visibility
- No login required to view

---

## File Structure

```
.env.local (updated)
├── VITE_PLAUSIBLE_DOMAIN
```

---

## Dependencies

- Plausible account (subscription or self-hosted)
- Domain ownership verification

---

## Acceptance Criteria

- [ ] Plausible account created and site added
- [ ] Domain `midnight-invoice.com` registered in Plausible
- [ ] Tracking script obtained and documented
- [ ] Environment variable configured
- [ ] Test pageview appears in Plausible dashboard
- [ ] Custom events configured (if applicable)
- [ ] Public dashboard enabled (optional)
- [ ] Documentation updated with Plausible setup

---

## Related Documentation

- Spec: [PLAN-002](../plans/PLAN-002-analytics-integration-feb-8-2026_09-47-am.md)
- Main Index: [tasks.md](../tasks.md)
- Plausible Docs: https://plausible.io/docs

---

## Notes

- Plausible is GDPR compliant without needing cookie consent banners
- No cookies used, no personal data collected
- Bypasses most ad blockers (lightweight script)
- Simple, privacy-focused alternative to Google Analytics
- Can run without user consent (privacy-by-design)
