import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, FileText, Settings, Sparkles, Cloud, Users, FileStack, RefreshCw, Mail, Paperclip, Lock, Save } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { InvoiceList } from '@/components/invoice/InvoiceList';
import { useInvoices } from '@/hooks/useInvoices';

import { useSettingsStore, DefaultSettings } from '@/stores/useSettingsStore';
import { CurrencySelector } from '@/components/ui/CurrencySelector';
import { Invoice } from '@/types/invoice';
import { Spinner } from '@/components/ui/spinner';
import { ThemeToggle } from '@/components/ThemeToggle';
import { env } from '@/env';

const Index = () => {
  const navigate = useNavigate();
  const { invoices, deleteInvoice, isLoading } = useInvoices();
  const [activeTab, setActiveTab] = useState<'invoices' | 'settings' | 'coming'>('invoices');
  const { settings, updateSettings } = useSettingsStore();

  // Local state for settings form to avoid auto-saving on every keystroke
  const [localSettings, setLocalSettings] = useState<DefaultSettings>(settings);

  // Sync local state when tab changes to settings
  useEffect(() => {
    if (activeTab === 'settings') {
      setLocalSettings(settings);
    }
  }, [activeTab, settings]);

  const handleSaveSettings = () => {
    updateSettings(localSettings);
    toast.success('Settings saved successfully');
  };  // Zustand handles state synchronization automatically - no useEffect needed

  const handleViewInvoice = (invoice: Invoice) => {
    navigate(`/invoice/${invoice.id}`, { viewTransition: true });
  };

  const handleLoadSession = (invoice: Invoice) => {
    navigate(`/create/${invoice.id}`, { viewTransition: true });
  };

  const handleDuplicateInvoice = (invoice: Invoice) => {
    // Generate new ID for the duplicated invoice
    const newId = crypto.randomUUID();
    
    // Create a new invoice with copied data
    const { id, createdAt, invoiceNumber, ...invoiceData } = invoice;
    const duplicateData = {
      ...invoiceData,
      issueDate: new Date().toISOString().split('T')[0], // Set to today
      dueDate: '', // Clear due date
    };
    
    // Navigate to create page with the new ID
    navigate(`/create/${newId}`, { viewTransition: true });
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Development Mode Banner */}
      {env.VITE_APP_ENV === "DEVELOPMENT" && (
        <div className="w-full bg-primary/10 border-b border-primary/20 py-1.5 text-center">
          <span className="text-[11px] font-medium tracking-widest uppercase text-primary">
            Development Mode
          </span>
        </div>
      )}

      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-14 items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-primary/10 flex items-center justify-center">
                <img src="/favicon.svg" alt={`${env.VITE_APP_NAME} Logo`} className="w-4 h-4 text-primary" />
              </div>
              <h1 className="text-sm font-semibold text-foreground">{env.VITE_APP_NAME}</h1>
            </div>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => navigate('/create', { viewTransition: true })}>
              <Plus className="w-4 h-4 mr-2" />
              New Invoice
            </Button>
          </div>
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
              onClick={() => setActiveTab('settings')}
              className={`flex items-center gap-2 pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'settings'
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <Settings className="w-4 h-4" />
              Settings
            </button>
            <button
              onClick={() => setActiveTab('coming')}
              className={`flex items-center gap-2 pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'coming'
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <Sparkles className="w-4 h-4" />
              Coming Soon
            </button>
            <div className="ml-auto pb-1">
              <ThemeToggle />
            </div>
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
                  onDuplicate={handleDuplicateInvoice}
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

          {activeTab === 'settings' && (
            <>
              <div className="mb-8">
                <h2 className="text-2xl font-semibold text-foreground mb-2">Settings</h2>
                <p className="text-sm text-muted-foreground">
                  Configure default values for new invoices. These can be applied using the "Use Defaults" button.
                </p>
              </div>

              <div className="space-y-6 max-w-lg">
                <div className="space-y-2">
                  <Label htmlFor="defaultFromName" className="text-xs text-muted-foreground">
                    Default Name / Company
                  </Label>
                  <Input
                    id="defaultFromName"
                    placeholder="Your name or company"
                    value={localSettings.fromName}
                    onChange={(e) => setLocalSettings(prev => ({ ...prev, fromName: e.target.value }))}
                    className="bg-secondary border-border"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="defaultFromEmail" className="text-xs text-muted-foreground">
                    Default Email
                  </Label>
                  <Input
                    id="defaultFromEmail"
                    type="email"
                    placeholder="your@email.com"
                    value={localSettings.fromEmail}
                    onChange={(e) => setLocalSettings(prev => ({ ...prev, fromEmail: e.target.value }))}
                    className="bg-secondary border-border"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="defaultFromAddress" className="text-xs text-muted-foreground">
                    Default Address
                  </Label>
                  <Textarea
                    id="defaultFromAddress"
                    placeholder="Street, City, Country"
                    rows={2}
                    value={localSettings.fromAddress}
                    onChange={(e) => setLocalSettings(prev => ({ ...prev, fromAddress: e.target.value }))}
                    className="bg-secondary border-border resize-none"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="defaultPaymentDetails" className="text-xs text-muted-foreground">
                    Default Payment Details
                  </Label>
                  <Textarea
                    id="defaultPaymentDetails"
                    placeholder="Bank name, account number, etc."
                    rows={3}
                    value={localSettings.paymentDetails}
                    onChange={(e) => setLocalSettings(prev => ({ ...prev, paymentDetails: e.target.value }))}
                    className="bg-secondary border-border resize-none text-sm"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="defaultTaxRate" className="text-xs text-muted-foreground">
                      Default Tax Rate (%)
                    </Label>
                    <Input
                      id="defaultTaxRate"
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="0"
                      value={localSettings.taxRate || ''}
                      onChange={(e) => setLocalSettings(prev => ({ ...prev, taxRate: parseFloat(e.target.value) || 0 }))}
                      className="bg-secondary border-border"
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">
                      Default Currency
                    </Label>
                    <CurrencySelector
                      value={localSettings.currency}
                      onChange={(value) => setLocalSettings(prev => ({ ...prev, currency: value }))}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="defaultNotes" className="text-xs text-muted-foreground">
                    Default Notes
                  </Label>
                  <Textarea
                    id="defaultNotes"
                    placeholder="Thank you for your business!"
                    rows={3}
                    value={localSettings.notes}
                    onChange={(e) => setLocalSettings(prev => ({ ...prev, notes: e.target.value }))}
                    className="bg-secondary border-border resize-none text-sm"
                  />
                </div>

                <div className="pt-4">
                  <Button onClick={handleSaveSettings}>
                    <Save className="w-4 h-4 mr-2" />
                    Save Settings
                  </Button>
                </div>
              </div>
            </>
          )}

          {activeTab === 'coming' && (
            <>
              <div className="mb-8">
                <h2 className="text-2xl font-semibold text-foreground mb-2">Coming Soon</h2>
                <p className="text-sm text-muted-foreground">
                  Exciting features we're working on for future updates.
                </p>
              </div>

              <div className="space-y-4">
                <div className="flex items-center gap-4 p-4 rounded-lg border border-border bg-card">
                  <div className="w-10 h-10 rounded-md bg-blue-500/10 flex items-center justify-center">
                    <Cloud className="w-5 h-5 text-blue-500" />
                  </div>
                  <div>
                    <p className="font-medium text-foreground">Cloud Sync</p>
                    <p className="text-sm text-muted-foreground">Access your invoices from any device</p>
                  </div>
                </div>

                <div className="flex items-center gap-4 p-4 rounded-lg border border-border bg-card">
                  <div className="w-10 h-10 rounded-md bg-green-500/10 flex items-center justify-center">
                    <Users className="w-5 h-5 text-green-500" />
                  </div>
                  <div>
                    <p className="font-medium text-foreground">Client Management</p>
                    <p className="text-sm text-muted-foreground">Save and reuse client information</p>
                  </div>
                </div>

                <div className="flex items-center gap-4 p-4 rounded-lg border border-border bg-card">
                  <div className="w-10 h-10 rounded-md bg-purple-500/10 flex items-center justify-center">
                    <FileStack className="w-5 h-5 text-purple-500" />
                  </div>
                  <div>
                    <p className="font-medium text-foreground">Invoice Templates</p>
                    <p className="text-sm text-muted-foreground">Create reusable invoice templates</p>
                  </div>
                </div>

                <div className="flex items-center gap-4 p-4 rounded-lg border border-border bg-card">
                  <div className="w-10 h-10 rounded-md bg-orange-500/10 flex items-center justify-center">
                    <RefreshCw className="w-5 h-5 text-orange-500" />
                  </div>
                  <div>
                    <p className="font-medium text-foreground">Recurring Invoices</p>
                    <p className="text-sm text-muted-foreground">Auto-generate invoices on a schedule</p>
                  </div>
                </div>

                <div className="flex items-center gap-4 p-4 rounded-lg border border-border bg-card">
                  <div className="w-10 h-10 rounded-md bg-pink-500/10 flex items-center justify-center">
                    <Mail className="w-5 h-5 text-pink-500" />
                  </div>
                  <div>
                    <p className="font-medium text-foreground">Email Sending</p>
                    <p className="text-sm text-muted-foreground">Send invoices directly via email</p>
                  </div>
                </div>

                <div className="flex items-center gap-4 p-4 rounded-lg border border-border bg-card">
                  <div className="w-10 h-10 rounded-md bg-yellow-500/10 flex items-center justify-center">
                    <Paperclip className="w-5 h-5 text-yellow-500" />
                  </div>
                  <div>
                    <p className="font-medium text-foreground">File Attachments</p>
                    <p className="text-sm text-muted-foreground">Add logos and documents to invoices</p>
                  </div>
                </div>

                <div className="flex items-center gap-4 p-4 rounded-lg border border-border bg-card">
                  <div className="w-10 h-10 rounded-md bg-red-500/10 flex items-center justify-center">
                    <Lock className="w-5 h-5 text-red-500" />
                  </div>
                  <div>
                    <p className="font-medium text-foreground">User Authentication</p>
                    <p className="text-sm text-muted-foreground">Secure login with WorkOS</p>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
};

export default Index;