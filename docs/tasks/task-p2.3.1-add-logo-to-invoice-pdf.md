# Task: Add Logo Rendering to InvoicePDF

**Task ID**: P2.3.1  
**Created**: Feb 8, 2026  
**Updated**: Feb 8, 2026  
**Status**: 🔴 Pending  
**Priority**: High  
**Effort**: Medium (2 days)  
**Component**: PDF Generation

---

## Problem Statement
The InvoicePDF component doesn't render the company logo, missing an opportunity for professional branding on generated PDFs.

---

## Objective
Update the InvoicePDF component to fetch and render the user's logo on generated PDFs.

---

## Implementation Plan

### 1. Update InvoicePDF Component
Modify `src/components/invoice/InvoicePDF.tsx`:

```typescript
import { Document, Page, View, Text, Image, StyleSheet } from "@react-pdf/renderer";
import { useEffect, useState } from "react";
import { InvoiceFormData } from "@/types/invoice";

interface InvoicePDFProps {
  data: InvoiceFormData;
  logoUrl?: string;
}

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontSize: 10,
    fontFamily: "Helvetica",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 30,
  },
  logo: {
    width: 120,
    height: 60,
    objectFit: "contain",
  },
  logoPlaceholder: {
    width: 120,
    height: 60,
    justifyContent: "center",
  },
  companyName: {
    fontSize: 16,
    fontWeight: "bold",
  },
  // ... other styles
});

export function InvoicePDF({ data, logoUrl }: InvoicePDFProps) {
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
  
  // Fetch and convert logo to data URL for PDF
  useEffect(() => {
    if (!logoUrl) {
      setLogoDataUrl(null);
      return;
    }
    
    const fetchLogo = async () => {
      try {
        const response = await fetch(logoUrl);
        const blob = await response.blob();
        const reader = new FileReader();
        reader.onloadend = () => {
          setLogoDataUrl(reader.result as string);
        };
        reader.readAsDataURL(blob);
      } catch (error) {
        console.error("Failed to load logo:", error);
        setLogoDataUrl(null);
      }
    };
    
    fetchLogo();
  }, [logoUrl]);
  
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header with Logo */}
        <View style={styles.header}>
          <View>
            {logoDataUrl ? (
              <Image src={logoDataUrl} style={styles.logo} />
            ) : (
              <View style={styles.logoPlaceholder}>
                <Text style={styles.companyName}>
                  {data.fromName}
                </Text>
              </View>
            )}
          </View>
          
          <View>
            <Text style={{ fontSize: 24, fontWeight: "bold" }}>
              INVOICE
            </Text>
            <Text>#{data.invoiceNumber}</Text>
          </View>
        </View>
        
        {/* Rest of invoice content */}
        {/* ... */}
      </Page>
    </Document>
  );
}
```

### 2. Create Logo Hook
Create `src/hooks/useInvoiceLogo.ts`:

```typescript
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";

export function useInvoiceLogo(userId?: string) {
  const user = useQuery(
    api.users.getUserById,
    userId ? { userId } : "skip"
  );
  
  const logoFile = useQuery(
    api.files.getFile,
    user?.logoFileId ? { fileId: user.logoFileId } : "skip"
  );
  
  return logoFile?.r2Url || null;
}
```

### 3. Handle SVG Logos
For SVG support in PDFs, add a conversion utility:

```typescript
// src/lib/pdf/svgToPng.ts
export async function svgToPngDataUrl(svgUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      ctx?.drawImage(img, 0, 0);
      resolve(canvas.toDataURL("image/png"));
    };
    
    img.onerror = reject;
    img.src = svgUrl;
  });
}
```

### 4. Update Invoice Container
Update the component that renders InvoicePDF:

```typescript
import { PDFViewer } from "@react-pdf/renderer";
import { InvoicePDF } from "./InvoicePDF";
import { useInvoiceLogo } from "@/hooks/useInvoiceLogo";

export function InvoicePreview({ invoice }: { invoice: InvoiceFormData }) {
  const logoUrl = useInvoiceLogo(invoice.userId);
  
  return (
    <PDFViewer width="100%" height="600">
      <InvoicePDF data={invoice} logoUrl={logoUrl || undefined} />
    </PDFViewer>
  );
}
```

### 5. Handle Logo Size Constraints
Ensure logos don't break layout:

```typescript
// Add to InvoicePDF styles
logo: {
  width: 120,
  height: 60,
  objectFit: "contain",
  objectPosition: "left center",
},
```

---

## File Structure

```
src/
├── components/
│   └── invoice/
│       ├── InvoicePDF.tsx (updated)
│       └── InvoicePreview.tsx (updated)
├── hooks/
│   └── useInvoiceLogo.ts
├── lib/
│   └── pdf/
│       └── svgToPng.ts
```

---

## Dependencies

- P2.2.4: Logo upload integrated
- @react-pdf/renderer
- Canvas API for SVG conversion

---

## Acceptance Criteria

- [ ] InvoicePDF renders logo when available
- [ ] Falls back to company name when no logo
- [ ] Logo fetched from user's profile
- [ ] Logo converted to data URL for PDF embedding
- [ ] SVG logos converted to PNG for PDF compatibility
- [ ] Logo sized appropriately (max 120x60px)
- [ ] Logo maintains aspect ratio
- [ ] PDF generation still works without logo
- [ ] Tested with various logo formats (PNG, JPG, SVG)

---

## Related Documentation

- Spec: [PLAN-001](../plans/PLAN-001-cloudflare-r2-file-storage-feb-8-2026_09-46-am.md)
- Main Index: [tasks.md](../tasks.md)
- Depends On: [P2.2.4](./task-p2.2.4-integrate-logo-upload-settings.md)
- React PDF Docs: https://react-pdf.org/

---

## Notes

- @react-pdf/renderer doesn't support SVG directly; conversion required
- Data URLs ensure logo is embedded in PDF (no external dependencies)
- Consider caching converted logos for performance
- Logo position: top-left of invoice header
