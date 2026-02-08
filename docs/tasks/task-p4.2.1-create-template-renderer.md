# Task: Create TemplateRenderer Component

**Task ID**: P4.2.1  
**Created**: Feb 8, 2026  
**Updated**: Feb 8, 2026  
**Status**: 🔴 Pending  
**Priority**: High  
**Effort**: Medium (2 days)  
**Component**: PDF Generation

---

## Problem Statement
The application needs a unified component that can render any invoice using any template configuration. This renderer will be the bridge between template configurations and the actual PDF output.

---

## Objective
Create a `TemplateRenderer` component that:
- Accepts invoice data and template configuration as props
- Dynamically renders the appropriate layout variant
- Applies template colors, fonts, and styling
- Works with both @react-pdf/renderer for PDFs and browser preview

---

## Implementation Plan

### 1. Create TemplateRenderer Component
Create `src/components/invoice/templates/TemplateRenderer.tsx`:

```typescript
import { InvoiceFormData } from '@/types/invoice';
import { TemplateConfig } from '@/lib/templates/types';
import { StandardTemplate } from './StandardTemplate';
import { CenteredTemplate } from './CenteredTemplate';
import { SidebarTemplate } from './SidebarTemplate';
import { MinimalTemplate } from './MinimalTemplate';

interface TemplateRendererProps {
  data: InvoiceFormData;
  config: TemplateConfig;
  logoUrl?: string;
}

export function TemplateRenderer({ data, config, logoUrl }: TemplateRendererProps) {
  const templateProps = { data, config, logoUrl };
  
  switch (config.layout) {
    case 'centered':
      return <CenteredTemplate {...templateProps} />;
    case 'sidebar':
      return <SidebarTemplate {...templateProps} />;
    case 'minimal':
      return <MinimalTemplate {...templateProps} />;
    case 'standard':
    default:
      return <StandardTemplate {...templateProps} />;
  }
}
```

### 2. Create Style Generation Utility
Create `src/lib/templates/styles.ts`:

```typescript
import { StyleSheet } from '@react-pdf/renderer';
import { TemplateConfig } from './types';

export function generateTemplateStyles(config: TemplateConfig) {
  return StyleSheet.create({
    page: {
      padding: 40,
      fontFamily: config.fontFamily,
      fontSize: 10,
      color: config.textColor || '#000000',
      backgroundColor: config.backgroundColor || '#ffffff',
    },
    header: {
      flexDirection: config.layout === 'centered' ? 'column' : 'row',
      alignItems: config.layout === 'centered' ? 'center' : 'flex-start',
      marginBottom: 30,
    },
    title: {
      fontSize: 24,
      fontWeight: config.headingWeight === 'bold' ? 'bold' : 'normal',
      color: config.primaryColor,
    },
    accent: {
      color: config.primaryColor,
    },
    secondaryAccent: {
      color: config.secondaryColor,
    },
    tableHeader: {
      backgroundColor: config.primaryColor,
      color: '#ffffff',
    },
    totalSection: {
      borderTop: `2px solid ${config.primaryColor}`,
    },
  });
}

// Font registration map for @react-pdf/renderer
export const FONT_MAP = {
  inter: { family: 'Inter', src: '/fonts/Inter-Regular.ttf' },
  playfair: { family: 'Playfair Display', src: '/fonts/PlayfairDisplay-Regular.ttf' },
  roboto: { family: 'Roboto', src: '/fonts/Roboto-Regular.ttf' },
  opensans: { family: 'Open Sans', src: '/fonts/OpenSans-Regular.ttf' },
} as const;

export function registerTemplateFonts() {
  // Register fonts with @react-pdf/renderer
  // This should be called once at app initialization
}
```

### 3. Create Base Template Props Interface
Update `src/lib/templates/types.ts`:

```typescript
import { InvoiceFormData } from '@/types/invoice';

export interface BaseTemplateProps {
  data: InvoiceFormData;
  config: TemplateConfig;
  logoUrl?: string;
}
```

### 4. Create Template Preview Component
Create `src/components/invoice/templates/TemplatePreview.tsx` for browser-based preview:

```typescript
import { BaseTemplateProps } from '@/lib/templates/types';

interface TemplatePreviewProps extends BaseTemplateProps {
  scale?: number;
}

export function TemplatePreview({ data, config, logoUrl, scale = 1 }: TemplatePreviewProps) {
  // Render HTML/CSS version for browser preview
  // Should match the PDF output as closely as possible
}
```

---

## File Structure

```
src/
├── components/
│   └── invoice/
│       └── templates/
│           ├── TemplateRenderer.tsx    # Main renderer component
│           └── TemplatePreview.tsx     # Browser preview component
├── lib/
│   └── templates/
│       ├── types.ts                    # Add BaseTemplateProps
│       └── styles.ts                   # Style generation utilities
```

---

## Dependencies

- P4.1.4 (Template API must be ready)

---

## Acceptance Criteria

- [ ] `TemplateRenderer` component created with layout switching logic
- [ ] `generateTemplateStyles` utility creates dynamic styles from config
- [ ] `FONT_MAP` defines available font families
- [ ] `TemplatePreview` component for browser rendering
- [ ] Component properly types all props
- [ ] Renderer supports all 4 layout variants (standard, centered, sidebar, minimal)
- [ ] Styles correctly apply colors, fonts, and layout preferences
- [ ] Component handles missing logo gracefully

---

## Related Documentation

- Spec: [PLAN-003](../plans/PLAN-003-invoice-templates-feb-8-2026_09-48-am.md)
- Main Index: [tasks.md](../tasks.md)
