# Task: Configure R2 CORS and Access Policies

**Task ID**: P2.1.1  
**Created**: Feb 8, 2026  
**Updated**: Feb 8, 2026  
**Status**: 🔴 Pending  
**Priority**: High  
**Effort**: Small (1 day)  
**Component**: Infrastructure

---

## Problem Statement
The R2 bucket needs proper CORS configuration and access policies to allow secure file uploads from the web application and public access to stored files.

---

## Objective
Configure R2 CORS policies, access controls, and security settings for the file storage bucket.

---

## Implementation Plan

### 1. Configure CORS Policy
Set CORS rules in Cloudflare R2 dashboard:

```json
[
  {
    "AllowedOrigins": [
      "http://localhost:5173",
      "https://midnight-invoice.com",
      "https://*.midnight-invoice.com"
    ],
    "AllowedMethods": ["GET", "PUT", "POST", "DELETE", "HEAD"],
    "AllowedHeaders": ["*"],
    "MaxAgeSeconds": 3600,
    "ExposeHeaders": ["ETag", "Content-Length", "Content-Type"]
  }
]
```

### 2. Configure Bucket Access Policy
Set public read access for file delivery:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicReadGetObject",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::midnight-invoice-files/*"
    }
  ]
}
```

### 3. Set Up Custom Domain (Optional but Recommended)
- Configure `files.midnight-invoice.com` as custom domain
- Enable Cloudflare proxy for CDN benefits
- Set cache rules for static assets

### 4. Configure Cache Headers
Set default cache behavior:
- Images: 1 year cache (`Cache-Control: public, max-age=31536000`)
- PDFs: 1 day cache (`Cache-Control: public, max-age=86400`)

### 5. Set Up Security Headers
Configure security headers for served files:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY` (for non-image files)

### 6. Test Configuration
- Test CORS preflight requests
- Verify public access works
- Confirm cache headers are set correctly

---

## File Structure

```
Cloudflare Dashboard (R2 Configuration)
├── Bucket: midnight-invoice-files
│   ├── CORS Policy
│   ├── Access Policy
│   └── Custom Domain
```

---

## Dependencies

- P1.1.1: R2 bucket created
- P1.2.1: Files table added (to understand access patterns)
- Domain DNS access (for custom domain)

---

## Acceptance Criteria

- [ ] CORS policy configured for localhost and production domains
- [ ] Public read access enabled for file delivery
- [ ] Custom domain configured (files.midnight-invoice.com)
- [ ] Cache headers configured for optimal performance
- [ ] Security headers set for file serving
- [ ] CORS preflight requests succeed
- [ ] Files accessible via public URL
- [ ] Documentation updated with configuration details

---

## Related Documentation

- Spec: [PLAN-001](../plans/PLAN-001-cloudflare-r2-file-storage-feb-8-2026_09-46-am.md)
- Main Index: [tasks.md](../tasks.md)
- Depends On: [P1.1.1](./task-p1.1.1-create-r2-bucket.md), [P1.2.1](./task-p1.2.1-add-files-table.md)
- Cloudflare R2 CORS Docs: https://developers.cloudflare.com/r2/buckets/cors/

---

## Notes

- CORS must allow the application's origin(s) for direct browser uploads
- Public access is safe because file IDs are unguessable UUIDs
- Custom domain provides cleaner URLs and Cloudflare CDN benefits
- Cache headers optimize performance for repeated file access
