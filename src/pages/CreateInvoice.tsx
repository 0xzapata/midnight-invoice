import { useState, useRef, useCallback, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Download, Save, ArrowLeft, Copy, Settings } from 'lucide-react';
import { pdf } from '@react-pdf/renderer';
import { Button } from '@/components/ui/button';
import { InvoiceForm } from '@/components/invoice/InvoiceForm';
import { InvoicePreview } from '@/components/invoice/InvoicePreview';
import { InvoicePDF } from '@/components/invoice/InvoicePDF';
import { SettingsDrawer } from '@/components/SettingsDrawer';
import { useInvoices } from '@/hooks/useInvoices';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { InvoiceFormData } from '@/types/invoice';
import { toast } from 'sonner';

export default function CreateInvoice() {
  const navigate = useNavigate();
  const { id: urlId } = useParams();
  
  // Get or generate invoice ID from URL
  const [invoiceId] = useState(() => urlId || crypto.randomUUID());
  
  // Redirect to include ID in URL if not present
  useEffect(() => {
    if (!urlId) {
      navigate(`/create/${invoiceId}`, { replace: true });
    }
  }, [urlId, invoiceId, navigate]);
  
  const {
    saveInvoice,
    getNextInvoiceNumber,
    getInvoice,
    saveDraft,
    loadDraft,
    clearDraft,
  } = useInvoices();

  const settings = useSettingsStore((state) => state.settings);
  const hasDefaults = settings.fromName || settings.fromEmail || settings.fromAddress || settings.paymentDetails || settings.notes || settings.taxRate || settings.currency;
  
  const invoiceRef = useRef<HTMLDivElement>(null);
  
  // Load initial data from existing invoice or draft
  const getInitialData = useCallback((): Partial<InvoiceFormData> => {
    // First check if this ID exists as a saved invoice
    const existingInvoice = getInvoice(invoiceId);
    if (existingInvoice) {
      const { id, createdAt, ...formData } = existingInvoice;
      return formData;
    }
    
    // Then check for a draft with this ID
    const draft = loadDraft(invoiceId);
    if (draft) {
      return draft;
    }
    
    return {};
  }, [invoiceId, getInvoice, loadDraft]);

  const [initialData] = useState<Partial<InvoiceFormData>>(() => getInitialData());
  
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

  // Auto-save draft on form change (using invoice ID)
  const handleFormChange = useCallback((data: InvoiceFormData) => {
    setFormData(data);
    saveDraft(invoiceId, data);
  }, [saveDraft, invoiceId]);

  const isEditing = !!getInvoice(invoiceId);

  const handleSave = () => {
    saveInvoice(formData, invoiceId);
    clearDraft(invoiceId);
    toast.success('Invoice saved successfully');
    navigate('/', { viewTransition: true });
  };

  const handleDownload = async () => {
    try {
      const blob = await pdf(<InvoicePDF data={formData} />).toBlob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${formData.invoiceNumber || 'invoice'}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      
      // Save invoice to session history after successful PDF generation
      saveInvoice(formData, invoiceId);
      clearDraft(invoiceId);
      toast.success('PDF downloaded and invoice saved');
      navigate('/', { viewTransition: true });
    } catch (error) {
      console.error('Failed to generate PDF:', error);
      toast.error('Failed to generate PDF');
    }
  };

  const handleDuplicate = () => {
    // Generate new ID for the duplicated invoice
    const newId = crypto.randomUUID();
    
    // Prepare duplicate data (reset dates)
    const duplicateData: InvoiceFormData = {
      ...formData,
      invoiceNumber: getNextInvoiceNumber, // Will get fresh number
      issueDate: new Date().toISOString().split('T')[0], // Set to today
      dueDate: '', // Clear due date
    };
    
    // Save as draft with new ID
    saveDraft(newId, duplicateData);
    
    // Navigate to create page with the new ID
    toast.success('Invoice duplicated');
    navigate(`/create/${newId}`, { viewTransition: true, replace: true });
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-14 items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate('/', { viewTransition: true })} className="h-8 w-8">
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <h1 className="text-sm font-medium text-foreground">
              {isEditing ? 'Edit Invoice' : 'Create Invoice'}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleDownload}>
              <Download className="w-4 h-4 mr-2" />
              Download PDF
            </Button>
            <Button variant="outline" size="sm" onClick={handleDuplicate}>
              <Copy className="w-4 h-4 mr-2" />
              Duplicate
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
              {/* Settings Banner */}
              {!hasDefaults && !isEditing && (
                <div className="mb-4 p-4 rounded-lg border border-border bg-card">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                      <Settings className="w-4 h-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground">Auto-fill your details</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Save your name, address, and payment details to quickly fill new invoices.
                      </p>
                    </div>
                    <SettingsDrawer />
                  </div>
                </div>
              )}
              <div className="bg-card border border-border p-6">
                <InvoiceForm 
                  key={invoiceId}
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