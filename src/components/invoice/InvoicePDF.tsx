import { Document, Page, Text, View, StyleSheet, Font } from '@react-pdf/renderer';
import { format } from 'date-fns';
import { InvoiceFormData } from '@/types/invoice';

// Register fonts
// Using local Noto Sans Mono font for widely supported currency symbols
Font.register({
  family: 'Noto Sans Mono',
  src: '/fonts/NotoSansMono-Regular.ttf',
});

// Create styles
const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontFamily: 'Noto Sans Mono',
    fontSize: 10,
    color: '#000000',
    backgroundColor: '#ffffff',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 30,
  },
  titleSection: {
    flexDirection: 'column',
  },
  label: {
    fontSize: 8,
    color: '#666666', // Slightly muted for labels, but still legible
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  invoiceNumber: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  invoiceName: {
    fontSize: 12,
    color: '#333333',
  },
  dateSection: {
    alignItems: 'flex-end',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  addressGrid: {
    flexDirection: 'row',
    gap: 40,
    marginBottom: 30,
  },
  addressCol: {
    width: '45%',
  },
  text: {
    marginBottom: 2,
    lineHeight: 1.4,
  },
  bold: {
    fontWeight: 'bold',
  },
  table: {
    width: '100%',
    marginBottom: 20,
  },
  tableHeader: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    paddingBottom: 8,
    marginBottom: 8,
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: '#f3f4f6',
    paddingVertical: 8,
  },
  colDesc: {
    width: '50%',
  },
  colQty: {
    width: '15%',
    textAlign: 'right',
  },
  colPrice: {
    width: '15%',
    textAlign: 'right',
  },
  colTotal: {
    width: '20%',
    textAlign: 'right',
  },
  summary: {
    flexDirection: 'column',
    alignItems: 'flex-end',
    marginBottom: 30,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: 200,
    marginBottom: 6,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: 200,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    paddingTop: 8,
    marginTop: 4,
  },
  totalText: {
    fontSize: 12,
    fontWeight: 'bold',
  },
  footer: {
    marginTop: 'auto',
    flexDirection: 'column',
    gap: 20,
  },
  footerCol: {
    width: '100%',
  },
});

const formatCurrency = (amount: number, currency: string) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency,
  }).format(amount);
};

interface InvoicePDFProps {
  data: InvoiceFormData;
}

export const InvoicePDF = ({ data }: InvoicePDFProps) => {
  const subtotal = data.lineItems.reduce(
    (sum, item) => sum + item.quantity * item.price,
    0
  );
  const tax = subtotal * (data.taxRate / 100);
  const total = subtotal + tax;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.titleSection}>
            <Text style={styles.label}>Invoice</Text>
            <Text style={styles.invoiceNumber}>{data.invoiceNumber || 'INV-0001'}</Text>
            {data.invoiceName && <Text style={styles.invoiceName}>{data.invoiceName}</Text>}
          </View>
          <View style={styles.dateSection}>
            <View style={styles.row}>
              <View style={{ marginRight: 20 }}>
                <Text style={styles.label}>Issue Date</Text>
                <Text>{data.issueDate ? format(new Date(data.issueDate), 'MMM dd, yyyy') : ''}</Text>
              </View>
              {data.dueDate && (
                <View>
                  <Text style={styles.label}>Due Date</Text>
                  <Text>{format(new Date(data.dueDate), 'MMM dd, yyyy')}</Text>
                </View>
              )}
            </View>
          </View>
        </View>

        {/* Addresses */}
        <View style={styles.addressGrid}>
          <View style={styles.addressCol}>
            <Text style={styles.label}>From</Text>
            <Text style={[styles.text, styles.bold]}>{data.fromName}</Text>
            <Text style={styles.text}>{data.fromAddress}</Text>
            <Text style={styles.text}>{data.fromEmail}</Text>
          </View>
          <View style={styles.addressCol}>
            <Text style={styles.label}>Bill To</Text>
            <Text style={[styles.text, styles.bold]}>{data.toName}</Text>
            <Text style={styles.text}>{data.toAddress}</Text>
            <Text style={styles.text}>{data.toEmail}</Text>
          </View>
        </View>

        {/* Table */}
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[styles.label, styles.colDesc]}>Description</Text>
            <Text style={[styles.label, styles.colQty]}>Qty</Text>
            <Text style={[styles.label, styles.colPrice]}>Price</Text>
            <Text style={[styles.label, styles.colTotal]}>Total</Text>
          </View>
          {data.lineItems.map((item) => (
            <View key={item.id} style={styles.tableRow}>
              <Text style={[styles.text, styles.colDesc]}>{item.description}</Text>
              <Text style={[styles.text, styles.colQty]}>{item.quantity}</Text>
              <Text style={[styles.text, styles.colPrice]}>
                {formatCurrency(item.price, data.currency)}
              </Text>
              <Text style={[styles.text, styles.colTotal]}>
                {formatCurrency(item.quantity * item.price, data.currency)}
              </Text>
            </View>
          ))}
        </View>

        {/* Summary */}
        <View style={styles.summary}>
          <View style={styles.summaryRow}>
            <Text style={styles.text}>Subtotal</Text>
            <Text style={styles.text}>{formatCurrency(subtotal, data.currency)}</Text>
          </View>
          {data.taxRate > 0 && (
            <View style={styles.summaryRow}>
              <Text style={styles.text}>Tax ({data.taxRate}%)</Text>
              <Text style={styles.text}>{formatCurrency(tax, data.currency)}</Text>
            </View>
          )}
          <View style={styles.totalRow}>
            <Text style={[styles.totalText]}>Total</Text>
            <Text style={[styles.totalText]}>{formatCurrency(total, data.currency)}</Text>
          </View>
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          {data.paymentDetails ? (
            <View style={styles.footerCol}>
              <Text style={styles.label}>Payment Details</Text>
              <Text 
                style={styles.text} 
                hyphenationCallback={(word) => [word]}
              >
                {data.paymentDetails}
              </Text>
            </View>
          ) : null}
          {data.notes ? (
            <View style={styles.footerCol}>
              <Text style={styles.label}>Notes</Text>
              <Text 
                style={styles.text}
                hyphenationCallback={(word) => [word]}
              >
                {data.notes}
              </Text>
            </View>
          ) : null}
        </View>
      </Page>
    </Document>
  );
};
