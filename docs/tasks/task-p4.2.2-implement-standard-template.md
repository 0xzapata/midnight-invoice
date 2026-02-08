# Task: Implement StandardTemplate Layout

**Task ID**: P4.2.2  
**Created**: Feb 8, 2026  
**Updated**: Feb 8, 2026  
**Status**: 🔴 Pending  
**Priority**: High  
**Effort**: Medium (2 days)  
**Component**: PDF Generation

---

## Problem Statement
We need the foundational template layout that other variants will build upon. The StandardTemplate is the most common invoice layout with logo top-left, invoice details top-right, and a clean tabular structure.

---

## Objective
Implement the `StandardTemplate` component for @react-pdf/renderer with:
- Logo positioned top-left (if enabled)
- Invoice details (number, date, due date) top-right
- From/To addresses section
- Line items table with styled header
- Totals section with tax calculation
- Notes and payment details footer
- Responsive to template configuration (colors, fonts, visibility toggles)

---

## Implementation Plan

### 1. Create StandardTemplate Component
Create `src/components/invoice/templates/StandardTemplate.tsx`:

```typescript
import { Page, View, Text, Image, StyleSheet } from '@react-pdf/renderer';
import { BaseTemplateProps } from '@/lib/templates/types';
import { generateTemplateStyles } from '@/lib/templates/styles';

export function StandardTemplate({ data, config, logoUrl }: BaseTemplateProps) {
  const styles = generateTemplateStyles(config);
  
  return (
    <Page size="A4" style={styles.page}>
      {/* Header Section */}
      <View style={styles.header}>
        {config.showLogo && logoUrl && (
          <Image src={logoUrl} style={{ width: 120, height: 'auto' }} />
        )}
        <View style={{ alignItems: 'flex-end' }}>
          {config.showInvoiceName && (
            <Text style={styles.title}>INVOICE</Text>
          )}
          <Text style={styles.accent}>{data.invoiceNumber}</Text>
          <Text>Date: {data.issueDate}</Text>
          {config.showDueDate && data.dueDate && (
            <Text>Due: {data.dueDate}</Text>
          )}
        </View>
      </View>
      
      {/* From/To Section */}
      <View style={{ flexDirection: 'row', marginBottom: 30 }}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.accent, { fontWeight: 'bold' }]}>From:</Text>
          <Text>{data.fromName}</Text>
          <Text>{data.fromEmail}</Text>
          {data.fromAddress && <Text>{data.fromAddress}</Text>}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.accent, { fontWeight: 'bold' }]}>To:</Text>
          <Text>{data.toName}</Text>
          <Text>{data.toEmail}</Text>
          {data.toAddress && <Text>{data.toAddress}</Text>}
        </View>
      </View>
      
      {/* Line Items Table */}
      <View style={{ marginBottom: 20 }}>
        <View style={[styles.tableHeader, { flexDirection: 'row', padding: 8 }]}>
          <Text style={{ flex: 3 }}>Description</Text>
          <Text style={{ flex: 1, textAlign: 'center' }}>Qty</Text>
          <Text style={{ flex: 1, textAlign: 'right' }}>Price</Text>
          <Text style={{ flex: 1, textAlign: 'right' }}>Amount</Text>
        </View>
        {data.lineItems.map((item, index) => (
          <View key={index} style={{ flexDirection: 'row', padding: 8, borderBottom: '1px solid #e5e7eb' }}>
            <Text style={{ flex: 3 }}>{item.description}</Text>
            <Text style={{ flex: 1, textAlign: 'center' }}>{item.quantity}</Text>
            <Text style={{ flex: 1, textAlign: 'right' }}>${item.price.toFixed(2)}</Text>
            <Text style={{ flex: 1, textAlign: 'right' }}>
              ${(item.quantity * item.price).toFixed(2)}
            </Text>
          </View>
        ))}
      </View>
      
      {/* Totals Section */}
      <View style={[styles.totalSection, { alignItems: 'flex-end', paddingTop: 10 }]}>
        <View style={{ width: 200 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text>Subtotal:</Text>
            <Text>${data.subtotal.toFixed(2)}</Text>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text>Tax ({data.taxRate}%):</Text>
            <Text>${data.taxAmount.toFixed(2)}</Text>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 5 }}>
            <Text style={[styles.accent, { fontWeight: 'bold' }]}>Total:</Text>
            <Text style={[styles.accent, { fontWeight: 'bold' }]}>
              ${data.total.toFixed(2)} {data.currency}
            </Text>
          </View>
        </View>
      </View>
      
      {/* Notes Section */}
      {config.showNotes && data.notes && (
        <View style={{ marginTop: 30 }}>
          <Text style={[styles.accent, { fontWeight: 'bold' }]}>Notes:</Text>
          <Text>{data.notes}</Text>
        </View>
      )}
      
      {/* Payment Details */}
      {config.showPaymentDetails && data.paymentDetails && (
        <View style={{ marginTop: 20 }}>
          <Text style={[styles.accent, { fontWeight: 'bold' }]}>Payment Details:</Text>
          <Text>{data.paymentDetails}</Text>
        </View>
      )}
    </Page>
  );
}
```

### 2. Handle Edge Cases
- Empty line items
- Missing optional fields
- Long text wrapping
- Logo loading failures

### 3. Add Unit Tests
Create tests for the StandardTemplate component to ensure proper rendering.

---

## File Structure

```
src/
├── components/
│   └── invoice/
│       └── templates/
│           ├── TemplateRenderer.tsx    # Existing
│           ├── StandardTemplate.tsx    # NEW
│           └── __tests__/
│               └── StandardTemplate.test.tsx
├── lib/
│   └── templates/
│       └── styles.ts                   # Style utilities
```

---

## Dependencies

- P4.2.1 (TemplateRenderer must be created first)

---

## Acceptance Criteria

- [ ] `StandardTemplate` component renders complete invoice layout
- [ ] Logo displays conditionally based on `config.showLogo`
- [ ] Invoice details (number, date) styled with primary color
- [ ] From/To sections display correctly
- [ ] Line items table with styled header using primary color
- [ ] Totals calculated correctly with tax
- [ ] Notes and payment details conditionally rendered
- [ ] Component handles missing data gracefully
- [ ] PDF output matches design specifications

---

## Related Documentation

- Spec: [PLAN-003](../plans/PLAN-003-invoice-templates-feb-8-2026_09-48-am.md)
- Main Index: [tasks.md](../tasks.md)
