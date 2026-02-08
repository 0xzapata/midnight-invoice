# Task: Setup Resend Account

**Task ID**: P1.1.4  
**Created**: Feb 8, 2026  
**Updated**: Feb 8, 2026  
**Status**: 🔴 Pending  
**Priority**: High  
**Effort**: Small (1 day)  
**Component**: Email

---

## Problem Statement
The application cannot send emails, preventing users from sending invoices directly to clients and tracking email delivery status.

---

## Objective
Create a Resend account to enable transactional email sending with excellent deliverability.

---

## Implementation Plan

### 1. Create Resend Account
- Sign up at https://resend.com
- Verify email address
- Complete account setup

### 2. Generate API Key
- Navigate to API Keys section
- Create new API key with "Sending" permissions
- Copy and securely store the key (format: `re_xxxxxxxxxxxxxxxxxxxxxxxxxxxx`)

### 3. Configure Domain (Initial Setup)
- Add domain in Resend dashboard
- Note DNS records to configure (will be done in P5.1.1)
- For now, use Resend's test domain for development

### 4. Set Up Webhook Endpoint (Optional Preview)
- Note webhook secret for later use (format: `whsec_xxxxxxxxxxxxxxxxxxxx`)
- Will configure full webhook handling in P5.3.2

### 5. Set Environment Variables
Add to Convex dashboard (server secrets):
```bash
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxxxxxxxxx
RESEND_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxxxxxxxxx
```

Add to `.env.local`:
```bash
EMAIL_FROM_DOMAIN=midnight-invoice.com
EMAIL_FROM_NAME=Midnight Invoice
```

### 6. Test Email Sending
- Use Resend dashboard to send test email
- Verify email delivery and rendering
- Check spam score

---

## File Structure

```
.env.local (updated)
├── EMAIL_FROM_DOMAIN
├── EMAIL_FROM_NAME

Convex Dashboard (secrets)
├── RESEND_API_KEY
├── RESEND_WEBHOOK_SECRET
```

---

## Dependencies

- Resend account (free tier: 3,000 emails/day)
- Domain ownership (for production sending)

---

## Acceptance Criteria

- [ ] Resend account created and verified
- [ ] API key generated with sending permissions
- [ ] Domain added to Resend (for verification in next task)
- [ ] Environment variables configured
- [ ] Test email sent successfully via dashboard
- [ ] Webhook secret obtained for later use
- [ ] Documentation updated with Resend setup

---

## Related Documentation

- Spec: [PLAN-004](../plans/PLAN-004-resend-email-delivery-feb-8-2026_09-49-am.md)
- Main Index: [tasks.md](../tasks.md)
- Related Task: [P5.1.1](./task-p5.1.1-verify-domain-configure-dns.md) - Domain verification
- Resend Docs: https://resend.com/docs

---

## Notes

- Free tier: 3,000 emails/day, no credit card required
- Excellent deliverability rates (built by former Lob engineers)
- Native React Email support for component-based templates
- Built-in webhooks for delivery tracking
- Supports attachments up to 40MB
