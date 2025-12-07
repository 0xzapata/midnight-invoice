import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, FileText, History, Clock, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { InvoiceList } from '@/components/invoice/InvoiceList';
import { useInvoices } from '@/hooks/useInvoices';
import { Invoice } from '@/types/invoice';
import { formatDate } from '@/lib/invoice-utils';
import { Spinner } from '@/components/ui/spinner';
import { env } from '@/env';

const Index = () => {
  const navigate = useNavigate();
  const { invoices, deleteInvoice, isLoading } = useInvoices();
  const [activeTab, setActiveTab] = useState<'invoices' | 'sessions'>('invoices');

  // Zustand handles state synchronization automatically - no useEffect needed

  const handleViewInvoice = (invoice: Invoice) => {
    navigate(`/invoice/${invoice.id}`, { viewTransition: true });
  };

  const handleLoadSession = (invoice: Invoice) => {
    navigate(`/create/${invoice.id}`, { viewTransition: true });
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-14 items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-primary/10 flex items-center justify-center">
              <img src="/favicon.svg" alt={`${env.VITE_APP_NAME} Logo`} className="w-4 h-4 text-primary" />
            </div>
            <h1 className="text-sm font-semibold text-foreground">{env.VITE_APP_NAME}</h1>
          </div>
          <Button size="sm" onClick={() => navigate('/create', { viewTransition: true })}>
            <Plus className="w-4 h-4 mr-2" />
            New Invoice
          </Button>
        </div>
      </header>

      {/* Main Content */}
      <main className="container py-8">
        <div className="max-w-3xl mx-auto">
          {/* Tabs */}
          <div className="flex gap-4 mb-8 border-b border-border">
            <button
              onClick={() => setActiveTab('invoices')}
              className={`flex items-center gap-2 pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'invoices'
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <FileText className="w-4 h-4" />
              Your Invoices
            </button>
            <button
              onClick={() => setActiveTab('sessions')}
              className={`flex items-center gap-2 pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'sessions'
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <History className="w-4 h-4" />
              Session History
            </button>
          </div>

          {activeTab === 'invoices' && (
            <>
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
                  <Spinner size="lg" />
                </div>
              ) : (
                <InvoiceList
                  invoices={invoices}
                  onView={handleViewInvoice}
                  onLoadSession={handleLoadSession}
                  onDelete={deleteInvoice}
                />
              )}

              {invoices.length === 0 && !isLoading && (
                <div className="mt-8 flex justify-center">
                  <Button size="lg" onClick={() => navigate('/create', { viewTransition: true })} className="h-12 px-8">
                    <Plus className="w-5 h-5 mr-2" />
                    Create Your First Invoice
                  </Button>
                </div>
              )}
            </>
          )}

          {activeTab === 'sessions' && (
            <>
              <div className="mb-8">
                <h2 className="text-2xl font-semibold text-foreground mb-2">Session History</h2>
                <p className="text-sm text-muted-foreground">
                  Load a previous session to continue editing or create a new invoice based on it.
                </p>
              </div>

              {isLoading ? (
                <div className="flex items-center justify-center py-16">
                  <Spinner size="lg" />
                </div>
              ) : invoices.length === 0 ? (
                <div className="text-center py-16">
                  <Clock className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                  <p className="text-muted-foreground">No sessions yet</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Sessions are saved when you save or download an invoice
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {invoices.map((invoice) => (
                    <div
                      key={invoice.id}
                      className="flex items-center justify-between p-4 border border-border bg-card hover:bg-accent/50 transition-colors"
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-primary/10 flex items-center justify-center">
                            <History className="w-4 h-4 text-primary" />
                          </div>
                          <div>
                            <p className="font-medium text-foreground">
                              {invoice.invoiceName || invoice.invoiceNumber}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {invoice.invoiceNumber} • Created {formatDate(invoice.createdAt)}
                            </p>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleLoadSession(invoice)}
                        >
                          Load Session
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => deleteInvoice(invoice.id)}
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
};

export default Index;