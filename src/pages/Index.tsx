import { useNavigate } from 'react-router-dom';
import { Plus, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { InvoiceList } from '@/components/invoice/InvoiceList';
import { useInvoices } from '@/hooks/useInvoices';
import { Invoice } from '@/types/invoice';

const Index = () => {
  const navigate = useNavigate();
  const { invoices, deleteInvoice, isLoading } = useInvoices();

  const handleViewInvoice = (invoice: Invoice) => {
    navigate(`/invoice/${invoice.id}`);
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-14 items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center">
              <FileText className="w-4 h-4 text-primary" />
            </div>
            <h1 className="text-sm font-semibold text-foreground">Invoice Generator</h1>
          </div>
          <Button size="sm" onClick={() => navigate('/create')}>
            <Plus className="w-4 h-4 mr-2" />
            New Invoice
          </Button>
        </div>
      </header>

      {/* Main Content */}
      <main className="container py-8">
        <div className="max-w-3xl mx-auto">
          <div className="mb-8">
            <h2 className="text-2xl font-semibold text-foreground mb-2">Your Invoices</h2>
            <p className="text-sm text-muted-foreground">
              {invoices.length === 0
                ? 'Create professional invoices in seconds'
                : `${invoices.length} invoice${invoices.length === 1 ? '' : 's'} saved locally`}
            </p>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <InvoiceList
              invoices={invoices}
              onView={handleViewInvoice}
              onDelete={deleteInvoice}
            />
          )}

          {invoices.length === 0 && !isLoading && (
            <div className="mt-8 flex justify-center">
              <Button size="lg" onClick={() => navigate('/create')} className="h-12 px-8">
                <Plus className="w-5 h-5 mr-2" />
                Create Your First Invoice
              </Button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default Index;
