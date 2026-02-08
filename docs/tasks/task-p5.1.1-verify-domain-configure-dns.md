# Task: Verify Domain and Configure DNS

**Task ID**: P5.1.1  
**Created**: Feb 8, 2026  
**Updated**: Feb 8, 2026  
**Status**: 🔴 Pending  
**Priority**: High  
**Effort**: Small (1 day)  
**Component**: Infrastructure

---

## Problem Statement
To send emails from Midnight Invoice with high deliverability and avoid spam folders, we need to verify our domain with Resend and configure the necessary DNS records (SPF, DKIM, DMARC).

---

## Objective
Complete domain verification and DNS configuration:
- Add and verify domain in Resend dashboard
- Configure SPF record for email authorization
- Configure DKIM record for email signing
- Configure DMARC record for policy enforcement
- Verify DNS propagation

---

## Implementation Plan

### 1. Add Domain to Resend
1. Log in to Resend dashboard (https://resend.com)
2. Navigate to Domains section
3. Click "Add Domain"
4. Enter domain: `midnight-invoice.com`
5. Select region (US or EU based on user base)
6. Save the domain

### 2. Configure DNS Records
Add the following DNS records in Cloudflare (or your DNS provider):

#### SPF Record (TXT)
```
Type: TXT
Name: @
Value: v=spf1 include:_spf.resend.com ~all
TTL: Auto
```

#### DKIM Record (TXT)
```
Type: TXT
Name: resend._domainkey
Value: [Copy from Resend dashboard]
TTL: Auto
```

#### DMARC Record (TXT)
```
Type: TXT
Name: _dmarc
Value: v=DMARC1; p=quarantine; rua=mailto:dmarc@midnight-invoice.com; ruf=mailto:dmarc@midnight-invoice.com; fo=1
TTL: Auto
```

### 3. Verify Domain in Resend
1. Return to Resend dashboard
2. Click "Verify" on the domain
3. Wait for DNS propagation (can take up to 24 hours, usually 5-30 minutes)
4. Verify status shows "Verified"

### 4. Test Email Deliverability
Send a test email using Resend API:

```bash
curl -X POST 'https://api.resend.com/emails' \
  -H 'Authorization: Bearer re_your_api_key' \
  -H 'Content-Type: application/json' \
  -d '{
    "from": "Midnight Invoice <invoices@midnight-invoice.com>",
    "to": ["test@example.com"],
    "subject": "Domain Verification Test",
    "html": "<p>This is a test email to verify domain configuration.</p>"
  }'
```

### 5. Document Environment Variables
Add to `.env` and `.env.example`:

```bash
# Resend Configuration
RESEND_API_KEY=re_your_api_key_here
RESEND_FROM_DOMAIN=midnight-invoice.com
RESEND_FROM_EMAIL=invoices@midnight-invoice.com
RESEND_FROM_NAME=Midnight Invoice
```

---

## File Structure

```
.env                  # Add Resend environment variables
.env.example          # Add Resend environment variables template
docs/
└── runbooks/
    └── email-setup.md  # Documentation for DNS setup
```

---

## Dependencies

- P1.1.4 (Resend account setup)
- Access to DNS provider (Cloudflare)
- Resend API key

---

## Acceptance Criteria

- [ ] Domain added to Resend dashboard
- [ ] SPF record configured: `v=spf1 include:_spf.resend.com ~all`
- [ ] DKIM record configured with value from Resend
- [ ] DMARC record configured
- [ ] Domain shows "Verified" status in Resend
- [ ] Test email sent successfully
- [ ] Environment variables documented in `.env.example`
- [ ] DNS records documented for future reference
- [ ] No deliverability warnings in Resend dashboard

---

## Related Documentation

- Spec: [PLAN-004](../plans/PLAN-004-resend-email-delivery-feb-8-2026_09-49-am.md)
- Main Index: [tasks.md](../tasks.md)
- Resend Docs: https://resend.com/docs/dashboard/domains/introduction
