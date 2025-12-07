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
  const [searchParams, setSearchParams] = useSearchParams();
  
  // Get or generate invoice ID from URL
  const urlId = searchParams.get('id');
  const [invoiceId] = useState(() => urlId || crypto.randomUUID());
  
  // Redirect to include ID in URL if not present
  useEffect(() => {
    if (!urlId) {
      setSearchParams({ id: invoiceId }, { replace: true });
    }
  }, [urlId, invoiceId, setSearchParams]);
  
  const {
    saveInvoice,
    getNextInvoiceNumber,
    getInvoice,
    saveDraft,
    loadDraft,
    clearDraft,
  } = useInvoices();
  
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
    if (!invoiceRef.current) return;
    try {
      const canvas = await html2canvas(invoiceRef.current, {
        scale: 2,
        backgroundColor: '#ffffff',
        useCORS: true,
        onclone: (clonedDoc, element) => {
          // Remove dark mode from body to force light CSS variables
          clonedDoc.body.classList.remove('dark');
          
          // Force the element itself to use light colors
          element.style.backgroundColor = '#ffffff';
          element.style.color = '#000000';
          element.style.boxShadow = 'none';
          
          // Force all descendant elements to use black text
          const allChildren = element.querySelectorAll('*');
          allChildren.forEach((child) => {
            const htmlChild = child as HTMLElement;
            // Force text color to black
            htmlChild.style.color = '#000000';
            // Force border colors to be visible
            const computedStyle = clonedDoc.defaultView?.getComputedStyle(htmlChild);
            if (computedStyle && computedStyle.borderWidth !== '0px') {
              htmlChild.style.borderColor = '#cccccc';
            }
          });
        }
      });
      
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'px',
        format: [canvas.width / 2, canvas.height / 2]
      });
      pdf.addImage(imgData, 'PNG', 0, 0, canvas.width / 2, canvas.height / 2);
      pdf.save(`${formData.invoiceNumber || 'invoice'}.pdf`);
      
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