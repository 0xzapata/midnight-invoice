# Task: Implement Layout Variants

**Task ID**: P4.2.3  
**Created**: Feb 8, 2026  
**Updated**: Feb 8, 2026  
**Status**: 🔴 Pending  
**Priority**: Medium  
**Effort**: Medium (2 days)  
**Component**: PDF Generation

---

## Problem Statement
Users need different layout options to match their brand and preferences. We need to implement the three additional layout variants beyond StandardTemplate: Centered, Sidebar, and Minimal.

---

## Objective
Implement three layout variant components:
- **CenteredTemplate** - Logo and title centered, elegant presentation
- **SidebarTemplate** - Sidebar with from/to info, modern asymmetric layout
- **MinimalTemplate** - Ultra-clean, maximum whitespace, typography-focused

---

## Implementation Plan

### 1. Create CenteredTemplate
Create `src/components/invoice/templates/CenteredTemplate.tsx`:

```typescript
import { Page, View, Text, Image } from '@react-pdf/renderer';
import { BaseTemplateProps } from '@/lib/templates/types';
import { generateTemplateStyles } from '@/lib/templates/styles';

export function CenteredTemplate({ data, config, logoUrl }: BaseTemplateProps) {
  const styles = generateTemplateStyles(config);
  
  return (
    <Page size="A4" style={styles.page}>
      {/* Centered Header */}
      <View style={{ alignItems: 'center', marginBottom: 40 }}>
        {config.showLogo && logoUrl && (
          <Image src={logoUrl} style={{ width: 100, height: 'auto', marginBottom: 20 }} />
        )}
        {config.showInvoiceName && (
          <Text style={[styles.title, { fontSize: 32, marginBottom: 8 }]}>INVOICE</Text>
        )}
        <Text style={[styles.accent, { fontSize: 18 }]}>{data.invoiceNumber}</Text>
        <View style={{ flexDirection: 'row', marginTop: 10, gap: 20 }}>
          <Text>Date: {data.issueDate}</Text>
          {config.showDueDate && data.dueDate && (
            <Text>Due: {data.dueDate}</Text>
          )}
        </View>
      </View>
      
      {/* Two Column Addresses */}
      <View style={{ flexDirection: 'row', marginBottom: 40, paddingHorizontal: 40 }}>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={[styles.accent, { fontWeight: 'bold', marginBottom: 8 }]}>From</Text>
          <Text>{data.fromName}</Text>
          <Text>{data.fromEmail}</Text>
        </View>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={[styles.accent, { fontWeight: 'bold', marginBottom: 8 }]}>To</Text>
          <Text>{data.toName}</Text>
          <Text>{data.toEmail}</Text>
        </View>
      </View>
      
      {/* Line Items - Centered Style */}
      {/* ... table with centered aesthetics ... */}
      
      {/* Centered Totals */}
      <View style={{ alignItems: 'center', marginTop: 30 }}>
        {/* ... totals ... */}
      </View>
    </Page>
  );
}
```

### 2. Create SidebarTemplate
Create `src/components/invoice/templates/SidebarTemplate.tsx`:

```typescript
import { Page, View, Text, Image } from '@react-pdf/renderer';
import { BaseTemplateProps } from '@/lib/templates/types';

export function SidebarTemplate({ data, config, logoUrl }: BaseTemplateProps) {
  return (
    <Page size="A4" style={{ flexDirection: 'row' }}>
      {/* Left Sidebar */}
      <View style={{ 
        width: 180, 
        backgroundColor: config.primaryColor,
        padding: 20,
        color: '#ffffff'
      }}>
        {config.showLogo && logoUrl && (
          <Image src={logoUrl} style={{ width: 100, marginBottom: 30 }} />
        )}
        
        <View style={{ marginBottom: 30 }}>
          <Text style={{ fontWeight: 'bold', marginBottom: 8 }}>From</Text>
          <Text>{data.fromName}</Text>
          <Text>{data.fromEmail}</Text>
        </View>
        
        <View>
          <Text style={{ fontWeight: 'bold', marginBottom: 8 }}>To</Text>
          <Text>{data.toName}</Text>
          <Text>{data.toEmail}</Text>
        </View>
        
        {config.showDueDate && data.dueDate && (
          <View style={{ marginTop: 30 }}>
            <Text style={{ fontWeight: 'bold' }}>Due Date</Text>
            <Text>{data.dueDate}</Text>
          </View>
        )}
      </View>
      
      {/* Main Content */}
      <View style={{ flex: 1, padding: 30 }}>
        <View style={{ marginBottom: 30 }}>
          <Text style={{ fontSize: 12, color: '#6b7280' }}>INVOICE</Text>
          <Text style={{ fontSize: 28, color: config.primaryColor }}>
            {data.invoiceNumber}
          </Text>
          <Text style={{ color: '#6b7280' }}>{data.issueDate}</Text>
        </View>
        
        {/* Line Items */}
        {/* ... */}
        
        {/* Totals */}
        {/* ... */}
      </View>
    </Page>
  );
}
```

### 3. Create MinimalTemplate
Create `src/components/invoice/templates/MinimalTemplate.tsx`:

```typescript
import { Page, View, Text, Image } from '@react-pdf/renderer';
import { BaseTemplateProps } from '@/lib/templates/types';

export function MinimalTemplate({ data, config, logoUrl }: BaseTemplateProps) {
  return (
    <Page size="A4" style={{ padding: 60, fontFamily: config.fontFamily }}>
      {/* Ultra-minimal header */}
      <View style={{ marginBottom: 60 }}>
        {config.showLogo && logoUrl && (
          <Image src={logoUrl} style={{ width: 80, marginBottom: 20 }} />
        )}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={{ fontSize: 11, color: '#6b7280' }}>
            {data.invoiceNumber}
          </Text>
          <Text style={{ fontSize: 11, color: '#6b7280' }}>
            {data.issueDate}
          </Text>
        </View>
      </View>
      
      {/* Minimal addresses - inline */}
      <View style={{ marginBottom: 60 }}>
        <Text style={{ fontSize: 10, color: '#9ca3af', marginBottom: 4 }}>From</Text>
        <Text style={{ marginBottom: 16 }}>{data.fromName} · {data.fromEmail}</Text>
        
        <Text style={{ fontSize: 10, color: '#9ca3af', marginBottom: 4 }}>To</Text>
        <Text>{data.toName} · {data.toEmail}</Text>
      </View>
      
      {/* Line items - minimal table */}
      <View>
        {data.lineItems.map((item, index) => (
          <View key={index} style={{ 
            flexDirection: 'row', 
            justifyContent: 'space-between',
            paddingVertical: 12,
            borderBottom: '0.5px solid #e5e7eb'
          }}>
            <View>
              <Text>{item.description}</Text>
              <Text style={{ fontSize: 9, color: '#9ca3af' }}>
                {item.quantity} × ${item.price.toFixed(2)}
              </Text>
            </View>
            <Text>${(item.quantity * item.price).toFixed(2)}</Text>
          </View>
        ))}
      </View>
      
      {/* Minimal totals */}
      <View style={{ alignItems: 'flex-end', marginTop: 40 }}>
        <Text style={{ fontSize: 24 }}>${data.total.toFixed(2)}</Text>
        <Text style={{ fontSize: 10, color: '#9ca3af' }}>{data.currency}</Text>
      </View>
    </Page>
  );
}
```

### 4. Update TemplateRenderer
Ensure all variants are imported and mapped correctly.

---

## File Structure

```
src/
├── components/
│   └── invoice/
│       └── templates/
│           ├── TemplateRenderer.tsx    # Update imports
│           ├── StandardTemplate.tsx    # Existing
│           ├── CenteredTemplate.tsx    # NEW
│           ├── SidebarTemplate.tsx     # NEW
│           └── MinimalTemplate.tsx     # NEW
```

---

## Dependencies

- P4.2.2 (StandardTemplate must be completed first)

---

## Acceptance Criteria

- [ ] `CenteredTemplate` with centered logo, title, and addresses
- [ ] `SidebarTemplate` with colored sidebar containing from/to info
- [ ] `MinimalTemplate` with ultra-clean whitespace-focused design
- [ ] All layouts render correctly in PDF output
- [ ] All layouts respect config toggles (showLogo, showDueDate, etc.)
- [ ] Typography and colors consistent with configuration
- [ ] TemplateRenderer correctly switches between all layouts
- [ ] Each layout has distinct visual character

---

## Related Documentation

- Spec: [PLAN-003](../plans/PLAN-003-invoice-templates-feb-8-2026_09-48-am.md)
- Main Index: [tasks.md](../tasks.md)
