# Task: Create Cloudflare R2 Bucket

**Task ID**: P1.1.1  
**Created**: Feb 8, 2026  
**Updated**: Feb 8, 2026  
**Status**: 🔴 Pending  
**Priority**: High  
**Effort**: Small (1 day)  
**Component**: Infrastructure

---

## Problem Statement
The application currently has no file storage capability. We need to set up a Cloudflare R2 bucket to store user files including company logos, invoice attachments, and other assets.

---

## Objective
Create and configure a Cloudflare R2 bucket with proper access policies and credentials for integration with the Convex backend.

---

## Implementation Plan

### 1. Create Cloudflare Account (if needed)
- Sign up at https://dash.cloudflare.com
- Verify email and complete onboarding

### 2. Create R2 Bucket
- Navigate to R2 section in Cloudflare dashboard
- Create new bucket named: `midnight-invoice-files`
- Choose region closest to primary users (e.g., US East)

### 3. Configure Public Access
- Enable public access for the bucket
- Configure custom domain (optional): `files.midnight-invoice.com`
- Set up CDN caching rules

### 4. Create API Tokens
- Generate R2 API token with read/write permissions
- Save credentials securely for Convex integration

### 5. Set Environment Variables
Add to Convex dashboard environment variables:
```bash
R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=your-access-key
R2_SECRET_ACCESS_KEY=your-secret-key
R2_BUCKET_NAME=midnight-invoice-files
```

Add to `.env.local`:
```bash
VITE_R2_PUBLIC_URL=https://files.midnight-invoice.com
```

---

## File Structure

```
.env.local (updated)
├── VITE_R2_PUBLIC_URL

Convex Dashboard (secrets)
├── R2_ENDPOINT
├── R2_ACCESS_KEY_ID
├── R2_SECRET_ACCESS_KEY
├── R2_BUCKET_NAME
```

---

## Dependencies

- Cloudflare account
- Domain configured in Cloudflare (for custom domain option)

---

## Acceptance Criteria

- [ ] R2 bucket created with name `midnight-invoice-files`
- [ ] Public access enabled with proper CORS configuration
- [ ] API credentials generated and securely stored
- [ ] Environment variables configured in Convex dashboard
- [ ] Test upload/download works via Cloudflare dashboard
- [ ] Custom domain configured (optional but recommended)
- [ ] Documentation updated with bucket details

---

## Related Documentation

- Spec: [PLAN-001](../plans/PLAN-001-cloudflare-r2-file-storage-feb-8-2026_09-46-am.md)
- Main Index: [tasks.md](../tasks.md)
- Cloudflare R2 Docs: https://developers.cloudflare.com/r2/

---

## Notes

- R2 has zero egress fees - cost-effective for file downloads
- First 10GB/month storage is free
- No request charges for A/B/C class operations within free tier
