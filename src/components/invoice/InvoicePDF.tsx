import { useMemo } from 'react';
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import { InvoiceFormData } from '@/types/invoice';
import { formatCurrency, formatDate } from '@/lib/invoice-utils';
import { sanitizeInvoiceData } from '@/lib/sanitize';
import { PDF_FONT_FAMILY, registerPdfFonts } from './pdfFonts';
import { wrapMonospace } from './wrapMonospace';
import { INVOICE_PALETTES, type InvoiceTheme, resolveDocumentInvoiceTheme } from './invoiceTheme';

/*
 * A one-to-one rendering of InvoicePreview.tsx. The preview is a 595 px wide
 * card and an A4 page is 595.28 pt wide, so every Tailwind length below is
 * used as the same number of points (1 CSS px = 1 pt), with the class it
 * mirrors noted alongside. Colours come from ./invoiceTheme.ts (the same
 * tokens as the preview's CSS) and fonts from ./pdfFonts.ts.
 */

const PAGE_PADDING = 32; // p-8
const CARD_BORDER = 1; // the preview card's 1px border sits inside its 595 px width
const INSET = PAGE_PADDING + CARD_BORDER;
const CONTENT_WIDTH = 595.28 - INSET * 2;
// Line-item grid: grid-cols-12 gap-4 with col-span-6 / 2 / 2 / 2.
const GRID_GAP = 16;
const GRID_UNIT = (CONTENT_WIDTH - 11 * GRID_GAP) / 12;
const SPAN_6 = GRID_UNIT * 6 + GRID_GAP * 5;
const SPAN_2 = GRID_UNIT * 2 + GRID_GAP;
// grid-cols-2 gap-8
const HALF_GAP = 32;
const HALF_WIDTH = (CONTENT_WIDTH - HALF_GAP) / 2;

/** react-pdf's style object type (not exported by @react-pdf/renderer itself). */
type Style = Parameters<typeof StyleSheet.create>[0][string];

const styles = StyleSheet.create({
  page: {
    paddingTop: INSET,
    paddingBottom: INSET,
    paddingHorizontal: INSET,
    fontFamily: PDF_FONT_FAMILY,
    fontWeight: 400,
  },
  // text-[11px] uppercase tracking-wider
  label: {
    fontSize: 11,
    lineHeight: 1.5,
    textTransform: 'uppercase',
    letterSpacing: 0.55,
  },
  // text-sm
  textSm: { fontSize: 14, lineHeight: 20 / 14 },
  // text-base
  textBase: { fontSize: 16, lineHeight: 24 / 16 },
  medium: { fontWeight: 500 },
  semibold: { fontWeight: 600 },
  right: { textAlign: 'right' },

  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 32 },
  invoiceNumber: { fontSize: 18, lineHeight: 28 / 18, fontWeight: 600 },
  dates: { flexDirection: 'row', gap: 32 },
  dateCol: { alignItems: 'flex-end' },

  halves: { flexDirection: 'row', gap: HALF_GAP },
  half: { width: HALF_WIDTH },
  parties: { marginBottom: 32 },

  table: { marginBottom: 32 },
  gridRow: { flexDirection: 'row', gap: GRID_GAP, borderBottomWidth: 1, borderBottomStyle: 'solid' },
  tableHeader: { paddingBottom: 12 },
  tableRow: { paddingVertical: 12 },
  colDesc: { width: SPAN_6 },
  colNum: { width: SPAN_2, alignItems: 'flex-end' },

  summaryWrap: { flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 32 },
  summary: { width: 256 }, // w-64
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between' },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 8, borderTopWidth: 1, borderTopStyle: 'solid' },
});

interface InvoicePDFProps {
  data: InvoiceFormData;
  /**
   * Colour theme. Defaults to whatever the on-screen preview currently shows
   * (its closest `.dark` ancestor), and to the preview's default (dark) when
   * rendered outside a browser.
   */
  theme?: InvoiceTheme;
}

export const InvoicePDF = ({ data, theme }: InvoicePDFProps) => {
  // Idempotent. In the browser this registers the fonts by URL on first render
  // (before react-pdf loads fonts); the Worker registers data URLs earlier.
  registerPdfFonts();

  // Same normalisation as the preview (tags stripped, numbers made finite).
  const safeData = useMemo(() => sanitizeInvoiceData(data), [data]);
  const palette = INVOICE_PALETTES[theme ?? resolveDocumentInvoiceTheme()];

  const subtotal = safeData.lineItems.reduce((sum, item) => sum + item.quantity * item.price, 0);
  const tax = subtotal * (safeData.taxRate / 100);
  const total = subtotal + tax;
  const money = (amount: number) => formatCurrency(amount, safeData.currency);

  const fg = { color: palette.text };
  const muted = { color: palette.muted };
  const label = [styles.label, muted];
  // space-y-0.5 / space-y-2: margin on each following sibling.
  const gapAbove = (px: number, index: number) => (index > 0 ? { marginTop: px } : {});

  /**
   * A text-sm paragraph pre-wrapped like the preview (see wrapMonospace). One
   * <Text> per line also keeps react-pdf from emitting a Helvetica run for
   * each newline character. Empty text renders nothing, like an empty <p>.
   */
  const paragraph = (text: string, width: number, style: Style[], preLine = false) =>
    text ? (
      <View style={{ width }}>
        {wrapMonospace(text, width, 14, preLine).map((line, i) => (
          <Text key={i} style={[styles.textSm, ...style]}>{line || ' '}</Text>
        ))}
      </View>
    ) : null;

  const party = (heading: string, name: string, address: string, email: string) => (
    <View style={styles.half}>
      <Text style={[...label, { marginBottom: 8 }]}>{heading}</Text>
      {[
        paragraph(name, HALF_WIDTH, [styles.medium, fg]),
        paragraph(address, HALF_WIDTH, [muted], true),
        paragraph(email, HALF_WIDTH, [muted]),
      ]
        .filter(Boolean)
        .map((node, i) => (
          <View key={i} style={gapAbove(2, i)}>{node}</View>
        ))}
    </View>
  );

  const amount = (text: string) => (
    <View style={styles.colNum}>
      <Text style={[styles.textSm, fg]}>{text}</Text>
    </View>
  );

  const summaryRows: [string, string][] = [['Subtotal', money(subtotal)]];
  if (safeData.taxRate > 0) summaryRows.push([`Tax (${safeData.taxRate}%)`, money(tax)]);

  const footer = [
    safeData.paymentDetails ? ['Payment Details', safeData.paymentDetails] : null,
    safeData.notes ? ['Notes', safeData.notes] : null,
  ].filter((entry): entry is string[] => entry !== null);

  return (
    <Document title={safeData.invoiceNumber || 'Invoice'}>
      <Page size="A4" style={[styles.page, { backgroundColor: palette.background, color: palette.text }]}>
        {/* Header */}
        <View style={styles.header} wrap={false}>
          <View>
            <Text style={[...label, { marginBottom: 4 }]}>Invoice</Text>
            <Text style={[styles.invoiceNumber, fg]}>{safeData.invoiceNumber || 'INV-0001'}</Text>
          </View>
          <View style={styles.dates}>
            <View style={styles.dateCol}>
              <Text style={[...label, styles.right, { marginBottom: 4 }]}>Issue Date</Text>
              <Text style={[styles.textSm, styles.right, fg]}>{formatDate(safeData.issueDate)}</Text>
            </View>
            {safeData.dueDate ? (
              <View style={styles.dateCol}>
                <Text style={[...label, styles.right, { marginBottom: 4 }]}>Due Date</Text>
                <Text style={[styles.textSm, styles.right, fg]}>{formatDate(safeData.dueDate)}</Text>
              </View>
            ) : null}
          </View>
        </View>

        {/* From / To */}
        <View style={[styles.halves, styles.parties]} wrap={false}>
          {party('From', safeData.fromName, safeData.fromAddress, safeData.fromEmail)}
          {party('Bill To', safeData.toName, safeData.toAddress, safeData.toEmail)}
        </View>

        {/* Line items */}
        <View style={styles.table}>
          <View style={[styles.gridRow, styles.tableHeader, { borderBottomColor: palette.border }]} wrap={false}>
            <Text style={[...label, styles.colDesc]}>Description</Text>
            {['Qty', 'Price', 'Total'].map((heading) => (
              <View key={heading} style={styles.colNum}>
                <Text style={label}>{heading}</Text>
              </View>
            ))}
          </View>
          {safeData.lineItems.map((item) => (
            <View key={item.id} style={[styles.gridRow, styles.tableRow, { borderBottomColor: palette.borderSubtle }]} wrap={false}>
              <View style={styles.colDesc}>{paragraph(item.description, SPAN_6, [fg])}</View>
              {amount(String(item.quantity))}
              {amount(money(item.price))}
              {amount(money(item.quantity * item.price))}
            </View>
          ))}
        </View>

        {/* Summary */}
        <View style={styles.summaryWrap} wrap={false}>
          <View style={styles.summary}>
            {summaryRows.map(([name, value], i) => (
              <View key={name} style={[styles.summaryRow, gapAbove(8, i)]}>
                <Text style={[styles.textSm, muted]}>{name}</Text>
                <Text style={[styles.textSm, fg]}>{value}</Text>
              </View>
            ))}
            <View style={[styles.totalRow, { marginTop: 8, borderTopColor: palette.border }]}>
              <Text style={[styles.textBase, styles.medium, fg]}>Total</Text>
              <Text style={[styles.textBase, styles.semibold, { color: palette.accent }]}>{money(total)}</Text>
            </View>
          </View>
        </View>

        {/* Footer */}
        {footer.length > 0 ? (
          <View style={styles.halves}>
            {footer.map(([heading, body]) => (
              <View key={heading} style={styles.half}>
                <Text style={[...label, { marginBottom: 8 }]}>{heading}</Text>
                {paragraph(body, HALF_WIDTH, [muted], true)}
              </View>
            ))}
          </View>
        ) : null}
      </Page>
    </Document>
  );
};
