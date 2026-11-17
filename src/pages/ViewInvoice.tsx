import { useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import { Download, ArrowLeft, Trash2, Copy, Printer, Pencil, MoreHorizontal, BookmarkPlus, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { InvoicePreview } from '@/components/invoice/InvoicePreview';
import { exportInvoicePdf, unsupportedCharactersWarning } from '@/components/invoice/exportInvoicePdf';
import { useInvoices } from '@/hooks/useInvoices';
import { InvoiceAttribution } from '@/components/AgentBadge';
import { SyncIssueNotice } from '@/components/sync/SyncIssueNotice';
import { ThemeToggle } from '@/components/ThemeToggle';
import { InvoiceStatusBar } from '@/components/invoice/status/InvoiceStatusBar';
import { SendInvoiceEmailDialog } from '@/components/invoice/email/SendInvoiceEmailDialog';
import { EmailHistory } from '@/components/invoice/email/EmailHistory';
import { useSaveAsTemplate } from '@/components/templates/useSaveAsTemplate';
import { InvoiceHistory } from '@/components/activity/InvoiceHistory';
import { toast } from 'sonner';

export default function ViewInvoice() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { getInvoice, deleteInvoice, invoices, saveDraft, getNextInvoiceNumber } = useInvoices();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);

  // We need to wait for invoices to load
  const invoice = invoices.length > 0 ? getInvoice(id || '') : undefined;
  const saveAsTemplate = useSaveAsTemplate(() => invoice ?? {});

  const handlePrint = () => {
    window.print();
  };

  const handleDownload = async () => {
    if (!invoice) return;

    try {
      const { blob, unsupported } = await exportInvoicePdf(invoice);
      const warning = unsupportedCharactersWarning(unsupported);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${invoice.invoiceNumber || 'invoice'}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      
      if (warning) toast.warning(`PDF downloaded. ${warning}`, { duration: 10000 });
      else toast.success('PDF downloaded successfully');
    } catch (error) {
      console.error('Failed to generate PDF:', error);
      toast.error('Failed to generate PDF');
    }
  };

  const handleDelete = () => {
    if (!invoice) return;
    deleteInvoice(invoice.id);
    toast.success('Invoice deleted');
    setDeleteDialogOpen(false);
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
    
    // Extract invoice data (excluding id, createdAt, invoiceNumber)
    const { id, createdAt, invoiceNumber, ...invoiceData } = invoice;
    
    // Create duplicate data with reset dates and new invoice number
    const duplicateData = {
      ...invoiceData,
      invoiceNumber: getNextInvoiceNumber, // Generate new invoice number
      issueDate: new Date().toISOString().split('T')[0], // Set to today
      dueDate: '', // Clear due date
    };
    
    // Save as draft with new ID before navigating
    saveDraft(newId, duplicateData);
    
    toast.success('Invoice duplicated');
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
      <header className="print:hidden sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur-sm supports-backdrop-filter:bg-background/60">
        <div className="container flex h-14 items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-3 sm:gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate('/')}
              className="h-8 w-8 shrink-0"
              aria-label="Back"
            >
              <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            </Button>
            <h1 className="truncate text-sm font-medium text-foreground font-mono">
              {invoice.invoiceNumber}
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-1 sm:gap-2">
            <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
              <AlertDialogTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="hidden lg:inline-flex text-destructive hover:text-destructive"
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete Invoice?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Are you sure you want to delete invoice <span className="font-mono font-medium">{invoice.invoiceNumber}</span>?
                    This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleDelete}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <Button
              variant="outline"
              size="sm"
              onClick={handleEdit}
              className="hidden lg:inline-flex"
            >
              <Pencil className="w-4 h-4 mr-2" />
              Edit
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleDuplicate}
              className="hidden lg:inline-flex"
            >
              <Copy className="w-4 h-4 mr-2" />
              Duplicate
            </Button>
            <Button variant="outline" size="sm" onClick={saveAsTemplate.start} className="hidden lg:inline-flex">
              <BookmarkPlus className="w-4 h-4 mr-2" aria-hidden="true" />
              Save as template
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handlePrint}
              className="hidden lg:inline-flex"
            >
              <Printer className="w-4 h-4 mr-2" />
              Print
            </Button>
            {/* Send by email stays visible at every width (icon-only below lg), like Download PDF. */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEmailOpen(true)}
              className="h-8 w-8 p-0 lg:h-9 lg:w-auto lg:px-3"
              aria-label="Send by email"
              title="Send by email"
            >
              <Mail className="w-4 h-4 lg:mr-2" aria-hidden="true" />
              <span className="hidden lg:inline">Send by email</span>
            </Button>
            {/* Below lg (where the labelled buttons no longer fit) the secondary actions move into a menu; Download PDF stays, icon-only. */}
            <Button size="sm" onClick={handleDownload} className="h-8 w-8 p-0 lg:h-9 lg:w-auto lg:px-3" aria-label="Download PDF">
              <Download className="w-4 h-4 lg:mr-2" aria-hidden="true" />
              <span className="hidden lg:inline">Download PDF</span>
            </Button>
            <Popover open={moreOpen} onOpenChange={setMoreOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 w-8 p-0 lg:hidden" aria-label="More actions">
                  <MoreHorizontal className="w-4 h-4" aria-hidden="true" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-auto min-w-44 p-1 whitespace-nowrap" aria-label="More actions">
                {[
                  { label: 'Edit', icon: Pencil, onClick: handleEdit },
                  { label: 'Duplicate', icon: Copy, onClick: handleDuplicate },
                  { label: 'Save as template', icon: BookmarkPlus, onClick: saveAsTemplate.start },
                  { label: 'Print', icon: Printer, onClick: handlePrint },
                  { label: 'Delete', icon: Trash2, onClick: () => setDeleteDialogOpen(true), destructive: true },
                ].map(({ label, icon: Icon, onClick, destructive }) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => {
                      setMoreOpen(false);
                      onClick();
                    }}
                    className={`flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm hover:bg-accent ${destructive ? 'text-destructive' : 'text-foreground'}`}
                  >
                    <Icon className="h-4 w-4" aria-hidden="true" />
                    {label}
                  </button>
                ))}
              </PopoverContent>
            </Popover>
            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container py-8">
        <SyncIssueNotice invoice={invoice} />
        <InvoiceStatusBar invoice={invoice} />
        <EmailHistory invoice={invoice} onRetry={() => setEmailOpen(true)} />
        <InvoiceAttribution invoice={invoice} />
        <div className="flex justify-center">
          <InvoicePreview data={invoice} />
        </div>
        <InvoiceHistory invoiceId={invoice.id} />
      </main>
      {saveAsTemplate.dialog}
      {emailOpen && <SendInvoiceEmailDialog invoice={invoice} open={emailOpen} onOpenChange={setEmailOpen} />}
    </div>
  );
}
