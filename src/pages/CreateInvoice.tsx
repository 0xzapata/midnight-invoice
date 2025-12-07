import { useState, useRef, useCallback, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Download, Save, ArrowLeft } from 'lucide-react';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { Button } from '@/components/ui/button';
import { InvoiceForm } from '@/components/invoice/InvoiceForm';
import { InvoicePreview } from '@/components/invoice/InvoicePreview';
import { useInvoices } from '@/hooks/useInvoices';
import { InvoiceFormData } from '@/types/invoice';
import { toast } from 'sonner';

export default function CreateInvoice() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get('session');
  
  const {
    saveInvoice,
    getNextInvoiceNumber,
    getInvoice,
    saveDraft,
    loadDraft,
    clearDraft,
  } = useInvoices();
  
  const invoiceRef = useRef<HTMLDivElement>(null);
  
  // Load initial data from session or draft
  const getInitialData = useCallback((): Partial<InvoiceFormData> => {
    if (sessionId) {
      const session = getInvoice(sessionId);
      if (session) {
        const { id, createdAt, ...formData } = session;
        return formData;
      }
    }
    
    const draft = loadDraft();
    if (draft) {
      return draft;
    }
    
    return {};
  }, [sessionId, getInvoice, loadDraft]);

  const [initialData, setInitialData] = useState<Partial<InvoiceFormData>>(() => getInitialData());
  
  const [formData, setFormData] = useState<InvoiceFormData>(() => ({
    invoiceNumber: getNextInvoiceNumber,
    invoiceName: '',
    issueDate: new Date().toISOString().split('T')[0],
    dueDate: '',
    fromName: '',
    fromAddress: '',
    fromEmail: '',
    toName: '',
    toAddress: '',
    toEmail: '',
    lineItems: [{
      id: crypto.randomUUID(),
      description: '',
      quantity: 1,
      price: 0
    }],
    taxRate: 0,
    notes: '',
    paymentDetails: '',
    currency: 'USD',
    ...getInitialData(),
  }));

  // Auto-save draft on form change
  const handleFormChange = useCallback((data: InvoiceFormData) => {
    setFormData(data);
    saveDraft(data);
  }, [saveDraft]);

  // Load session data when sessionId changes
  useEffect(() => {
    if (sessionId) {
      const session = getInvoice(sessionId);
      if (session) {
        const { id, createdAt, ...formData } = session;
        setInitialData(formData);
      }
    }
  }, [sessionId, getInvoice]);

  const handleSave = () => {
    saveInvoice(formData);
    clearDraft();
    toast.success('Invoice saved successfully');
    navigate('/');
  };

  const handleDownload = async () => {
    if (!invoiceRef.current) return;
    try {
      const canvas = await html2canvas(invoiceRef.current, {
        scale: 2,
        backgroundColor: '#0f0f0f',
        useCORS: true
      });
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'px',
        format: [canvas.width / 2, canvas.height / 2]
      });
      pdf.addImage(imgData, 'PNG', 0, 0, canvas.width / 2, canvas.height / 2);
      pdf.save(`${formData.invoiceNumber || 'invoice'}.pdf`);
      
      // Save invoice to session history after download
      saveInvoice(formData);
      clearDraft();
      toast.success('PDF downloaded and invoice saved');
      navigate('/');
    } catch (error) {
      console.error('Failed to generate PDF:', error);
      toast.error('Failed to generate PDF');
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-14 items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate('/')} className="h-8 w-8">
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <h1 className="text-sm font-medium text-foreground">
              {sessionId ? 'Edit Invoice' : 'Create Invoice'}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleDownload}>
              <Download className="w-4 h-4 mr-2" />
              Download PDF
            </Button>
            <Button size="sm" onClick={handleSave}>
              <Save className="w-4 h-4 mr-2" />
              Save Invoice
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container py-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Form */}
          <div className="order-2 lg:order-1">
            <div className="sticky top-24">
              <div className="bg-card border border-border p-6">
                <InvoiceForm 
                  key={sessionId || 'new'}
                  invoiceNumber={formData.invoiceNumber} 
                  onFormChange={handleFormChange}
                  initialData={initialData}
                />
              </div>
            </div>
          </div>

          {/* Preview */}
          <div className="order-1 lg:order-2">
            <div className="sticky top-24">
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-4">
                Preview
              </p>
              <InvoicePreview ref={invoiceRef} data={formData} />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}