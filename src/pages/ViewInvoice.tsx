import { useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Download, ArrowLeft, Trash2, Copy, Printer, Pencil } from 'lucide-react';
import { pdf } from '@react-pdf/renderer';
import { Button } from '@/components/ui/button';
import { InvoicePreview } from '@/components/invoice/InvoicePreview';
import { InvoicePDF } from '@/components/invoice/InvoicePDF';
import { useInvoices } from '@/hooks/useInvoices';
import { toast } from 'sonner';

export default function ViewInvoice() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { getInvoice, deleteInvoice, invoices } = useInvoices();
  const invoiceRef = useRef<HTMLDivElement>(null);

  // We need to wait for invoices to load
  const invoice = invoices.length > 0 ? getInvoice(id || '') : undefined;

  const handlePrint = () => {
    window.print();
  };

  const handleDownload = async () => {
    if (!invoice) return;

    try {
      const blob = await pdf(<InvoicePDF data={invoice} />).toBlob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${invoice.invoiceNumber || 'invoice'}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      
      toast.success('PDF downloaded successfully');
    } catch (error) {
      console.error('Failed to generate PDF:', error);
      toast.error('Failed to generate PDF');
    }
  };

  const handleDelete = () => {
    if (!invoice) return;
    deleteInvoice(invoice.id);
    toast.success('Invoice deleted');
    navigate('/');
  };

  const handleEdit = () => {
    if (!invoice) return;
    navigate(`/create/${invoice.id}`, { viewTransition: true });
  };

  const handleDuplicate = () => {
    if (!invoice) return;
    
    // Generate new ID for the duplicated invoice
    const newId = crypto.randomUUID();
    
    // Navigate to create page with the new ID
    // CreateInvoice will handle loading the data via getInvoice
    navigate(`/create/${newId}`, { viewTransition: true });
  };

  if (!invoice) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <p className="text-muted-foreground mb-4">Invoice not found</p>
          <Button variant="outline" onClick={() => navigate('/')}>
            Go Back
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="print:hidden sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-14 items-center justify-between">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate('/')}
              className="h-8 w-8"
            >
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <h1 className="text-sm font-medium text-foreground font-mono">
              {invoice.invoiceNumber}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleDelete}
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Delete
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleEdit}
            >
              <Pencil className="w-4 h-4 mr-2" />
              Edit
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleDuplicate}
            >
              <Copy className="w-4 h-4 mr-2" />
              Duplicate
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handlePrint}
            >
              <Printer className="w-4 h-4 mr-2" />
              Print
            </Button>
            <Button size="sm" onClick={handleDownload}>
              <Download className="w-4 h-4 mr-2" />
              Download PDF
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container py-8">
        <div className="flex justify-center">
          <InvoicePreview ref={invoiceRef} data={invoice} />
        </div>
      </main>
    </div>
  );
}
