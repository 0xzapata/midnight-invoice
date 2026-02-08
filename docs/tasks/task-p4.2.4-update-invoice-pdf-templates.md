# Task: Update InvoicePDF for Templates

**Task ID**: P4.2.4  
**Created**: Feb 8, 2026  
**Updated**: Feb 8, 2026  
**Status**: 🔴 Pending  
**Priority**: High  
**Effort**: Medium (2 days)  
**Component**: PDF Generation

---

## Problem Statement
The existing `InvoicePDF` component needs to be updated to use the new template system instead of the hardcoded layout. It should support template selection and render using the TemplateRenderer with appropriate configuration.

---

## Objective
Update the InvoicePDF component to:
- Accept an optional template configuration prop
- Use TemplateRenderer for rendering invoice content
- Support logo rendering from file storage
- Maintain backward compatibility for invoices without templates
- Register required fonts for @react-pdf/renderer

---

## Implementation Plan

### 1. Update InvoicePDF Component
Update `src/components/invoice/InvoicePDF.tsx`:

```typescript
import { Document, PDFViewer, Font } from '@react-pdf/renderer';
import { TemplateRenderer } from './templates/TemplateRenderer';
import { TemplateConfig } from '@/lib/templates/types';
import { FONT_MAP } from '@/lib/templates/styles';
import { InvoiceFormData } from '@/types/invoice';

// Register fonts
Object.entries(FONT_MAP).forEach(([key, font]) => {
  Font.register({
    family: font.family,
    src: font.src,
  });
});

interface InvoicePDFProps {
  data: InvoiceFormData;
  templateConfig?: TemplateConfig;
  logoUrl?: string;
}

const DEFAULT_CONFIG: TemplateConfig = {
  primaryColor: '#1e3a5f',
  secondaryColor: '#6b7280',
  fontFamily: 'inter',
  layout: 'standard',
  showLogo: true,
  showInvoiceName: true,
  showDueDate: true,
  showPaymentDetails: true,
  showNotes: true,
};

export function InvoicePDF({ data, templateConfig, logoUrl }: InvoicePDFProps) {
  const config = templateConfig || DEFAULT_CONFIG;
  
  return (
    <Document>
      <TemplateRenderer 
        data={data} 
        config={config} 
        logoUrl={logoUrl}
      />
    </Document>
  );
}

// For PDF generation (download)
export async function generateInvoicePDF(
  data: InvoiceFormData, 
  templateConfig?: TemplateConfig,
  logoUrl?: string
): Promise<Blob> {
  const config = templateConfig || DEFAULT_CONFIG;
  
  const pdfDoc = (
    <Document>
      <TemplateRenderer 
        data={data} 
        config={config}
        logoUrl={logoUrl}
      />
    </Document>
  );
  
  const blob = await pdf(pdfDoc).toBlob();
  return blob;
}
```

### 2. Update PDF Download Handler
Modify the download functionality to use the new template-aware generation:

```typescript
// In invoice view/download component
const handleDownloadPDF = async () => {
  const templateConfig = invoice.templateConfig || await getDefaultTemplateConfig();
  const logoUrl = invoice.logoFileId ? await getFileUrl(invoice.logoFileId) : undefined;
  
  const blob = await generateInvoicePDF(invoice, templateConfig, logoUrl);
  
  // Download blob...
};
```

### 3. Add Font Files
Ensure font files are available in `public/fonts/`:
- Inter-Regular.ttf
- PlayfairDisplay-Regular.ttf
- Roboto-Regular.ttf
- OpenSans-Regular.ttf

### 4. Update PDF Preview Component
Update the preview component to use template configuration:

```typescript
interface InvoicePDFPreviewProps {
  invoice: Invoice;
  templateId?: string;
}

export function InvoicePDFPreview({ invoice, templateId }: InvoicePDFPreviewProps) {
  const template = useQuery(api.templates.getTemplate, 
    templateId ? { templateId } : 'skip'
  );
  
  const logoUrl = useQuery(api.files.getFileUrl, 
    template?.logoFileId ? { fileId: template.logoFileId } : 'skip'
  );
  
  const config = template?.config || invoice.templateConfig || DEFAULT_CONFIG;
  
  return (
    <PDFViewer style={{ width: '100%', height: '600px' }}>
      <InvoicePDF 
        data={invoice} 
        templateConfig={config}
        logoUrl={logoUrl}
      />
    </PDFViewer>
  );
}
```

---

## File Structure

```
src/
├── components/
│   └── invoice/
│       ├── InvoicePDF.tsx              # Update to use TemplateRenderer
│       ├── InvoicePDFPreview.tsx       # Update with template support
│       └── templates/
│           └── TemplateRenderer.tsx    # Existing
├── lib/
│   └── templates/
│       └── styles.ts                   # Font registration
public/
└── fonts/
    ├── Inter-Regular.ttf
    ├── PlayfairDisplay-Regular.ttf
    ├── Roboto-Regular.ttf
    └── OpenSans-Regular.ttf
```

---

## Dependencies

- P4.2.3 (All layout variants must be complete)
- P2.3.1 (Logo integration must be complete)

---

## Acceptance Criteria

- [ ] `InvoicePDF` component uses `TemplateRenderer` for rendering
- [ ] Fonts are registered on component initialization
- [ ] Default config used when no template specified
- [ ] `generateInvoicePDF` function creates PDF blob with template
- [ ] Logo URL passed through to template renderer
- [ ] PDF preview component supports template selection
- [ ] Backward compatibility maintained for existing invoices
- [ ] All font files available in public directory

---

## Related Documentation

- Spec: [PLAN-003](../plans/PLAN-003-invoice-templates-feb-8-2026_09-48-am.md)
- Main Index: [tasks.md](../tasks.md)
