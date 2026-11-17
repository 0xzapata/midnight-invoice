import { ClientReviewNotice } from '@/components/review/NeedsReview';
import { useId, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Archive, ArchiveRestore, Bot, FilePlus2, Import, Pencil, Plus, Search, Trash2, Users } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
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
import { PageHeader } from '@/components/PageHeader';
import { ClientFormDialog } from '@/components/clients/ClientFormDialog';
import { newInvoiceDraftForClient } from '@/components/clients/clientFill';
import { invoicesForClient, useClientStore } from '@/stores/useClientStore';
import { useInvoiceStore } from '@/stores/useInvoiceStore';
import { useCloudEnabled, useCloudStore } from '@/stores/useCloudStore';
import { syncKey } from '@/lib/sync/collectionNames';
import { cn } from '@/lib/utils';
import { clientDedupeKey, type Client, type ClientFormData } from '../../shared/types/client';

const card = 'rounded-lg border border-border bg-card p-4 sm:p-5';

function matches(client: Client, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [client.name, client.email, client.address].some((v) => v.toLowerCase().includes(q));
}

function DefaultsLine({ client }: { client: Client }) {
  const parts: string[] = [];
  if (client.defaultCurrency) parts.push(client.defaultCurrency);
  if (client.defaultTaxRate != null) parts.push(`${client.defaultTaxRate}% tax`);
  if (client.paymentTermsDays != null) parts.push(client.paymentTermsDays === 0 ? 'Due on receipt' : `Net ${client.paymentTermsDays}`);
  if (parts.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Defaults for new invoices">
      {parts.map((p) => (
        <li key={p} className="border border-border px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
          {p}
        </li>
      ))}
    </ul>
  );
}

function ClientRow({ client, invoiceCount, onEdit, onNewInvoice }: { client: Client; invoiceCount: number; onEdit: () => void; onNewInvoice: () => void }) {
  const syncError = useCloudStore((s) => s.syncErrors[syncKey('clients', client.id)]);
  const archived = !!client.archivedAt;
  const { setArchived, deleteClient } = useClientStore.getState();
  const agentName = client.createdBy?.type === 'agent' ? client.createdBy.agentName || 'an agent' : null;

  return (
    <li className={cn(card, 'flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between', archived && 'opacity-70')}>
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-secondary" aria-hidden="true">
          <Users className="h-5 w-5 text-muted-foreground" />
        </div>
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="break-words font-sans font-medium text-foreground">{client.name}</h3>
            {archived && <span className="bg-secondary px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Archived</span>}
            {agentName && (
              <span className="inline-flex items-center gap-1 border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium leading-none text-primary" title={`Added by the agent “${agentName}”`}>
                <Bot className="h-3 w-3" aria-hidden="true" />
                by {agentName}
              </span>
            )}
            {syncError && (
              <span
                className="border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-medium leading-none text-amber-600 dark:text-amber-400"
                title={`Not synced: ${syncError}`}
              >
                Not synced
              </span>
            )}
          </div>
          {client.email && <p className="break-all font-code text-xs text-muted-foreground">{client.email}</p>}
          {client.email && <ClientReviewNotice clientId={client.id} />}
          {client.address && <p className="line-clamp-2 whitespace-pre-line break-words text-sm text-muted-foreground">{client.address}</p>}
          <DefaultsLine client={client} />
          <p className="text-xs text-muted-foreground">
            {invoiceCount === 0 ? 'No invoices yet' : `${invoiceCount} invoice${invoiceCount === 1 ? '' : 's'}`}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 sm:shrink-0 sm:justify-end">
        {!archived && (
          <Button size="sm" onClick={onNewInvoice} aria-label={`New invoice for ${client.name}`}>
            <FilePlus2 className="h-4 w-4" aria-hidden="true" />
            New invoice
          </Button>
        )}
        <Button variant="outline" size="icon" className="h-9 w-9" onClick={onEdit} aria-label={`Edit ${client.name}`} title="Edit">
          <Pencil className="h-4 w-4" aria-hidden="true" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="h-9 w-9"
          title={archived ? 'Unarchive' : 'Archive'}
          onClick={() => {
            setArchived(client.id, !archived);
            toast.success(archived ? `“${client.name}” is back in your client list` : `Archived “${client.name}”`, {
              description: archived ? undefined : 'It is hidden from the invoice client picker.',
            });
          }}
          aria-label={`${archived ? 'Unarchive' : 'Archive'} ${client.name}`}
        >
          {archived ? <ArchiveRestore className="h-4 w-4" aria-hidden="true" /> : <Archive className="h-4 w-4" aria-hidden="true" />}
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" size="icon" className="h-9 w-9 text-destructive hover:text-destructive" aria-label={`Delete ${client.name}`} title="Delete">
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete “{client.name}”?</AlertDialogTitle>
              <AlertDialogDescription>
                The client is removed from your list{useCloudStore.getState().token ? ' on all your devices' : ''}.{' '}
                {invoiceCount > 0
                  ? `Its ${invoiceCount} invoice${invoiceCount === 1 ? '' : 's'} stay as they are, with the client’s details.`
                  : 'No invoices are affected.'}{' '}
                To just hide it, archive it instead.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  deleteClient(client.id);
                  toast.success(`Deleted “${client.name}”`);
                }}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Delete client
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </li>
  );
}

/** `/clients`: saved clients (address book) to reuse on invoices. */
export default function Clients() {
  const navigate = useNavigate();
  const clients = useClientStore((s) => s.clients);
  const hydrated = useClientStore((s) => s._hasHydrated);
  const invoices = useInvoiceStore((s) => s.invoices);
  const cloudEnabled = useCloudEnabled();
  const [query, setQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<{ client?: Client } | null>(null);
  const searchId = useId();

  const importable = useMemo(() => {
    const known = new Set(clients.map((c) => clientDedupeKey(c)));
    const fresh = new Set<string>();
    for (const inv of invoices) {
      if (!inv.toName?.trim()) continue;
      const key = clientDedupeKey(inv);
      if (!known.has(key)) fresh.add(key);
    }
    return fresh.size;
  }, [clients, invoices]);

  const archivedCount = clients.filter((c) => c.archivedAt).length;
  const visible = clients
    .filter((c) => (showArchived ? true : !c.archivedAt))
    .filter((c) => matches(c, query))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

  const save = (data: ClientFormData) => {
    const saved = useClientStore.getState().saveClient(data, editing?.client?.id);
    toast.success(editing?.client ? `Saved changes to “${saved.name}”` : `Added “${saved.name}”`);
    setEditing(null);
  };

  const importClients = () => {
    const created = useClientStore.getState().importFromInvoices(useInvoiceStore.getState().invoices);
    if (created.length === 0) toast.info('Every client on your invoices is already saved');
    else toast.success(`Imported ${created.length} client${created.length === 1 ? '' : 's'} from your invoices`);
  };

  const newInvoiceFor = (client: Client) => {
    const id = crypto.randomUUID();
    const store = useInvoiceStore.getState();
    store.saveDraft(id, newInvoiceDraftForClient(client, store.getNextInvoiceNumber()));
    navigate(`/create/${id}`, { viewTransition: true });
  };

  return (
    <div className="min-h-screen bg-background">
      <PageHeader
        title="Clients"
        actions={
          <Button size="sm" onClick={() => setEditing({})}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only sm:not-sr-only">Add client</span>
          </Button>
        }
      />
      <main className="container py-8">
        <div className="mx-auto max-w-3xl space-y-8">
          <div>
            <h2 className="mb-2 text-2xl font-semibold text-foreground">Clients</h2>
            <p className="text-sm text-muted-foreground">
              Save the people and companies you bill, then pick them on new invoices.{' '}
              {cloudEnabled ? 'Synced to your cloud workspace' : 'Stored in this browser'}; invoices keep their own copy of the
              details, so editing a client never changes past invoices.
            </p>
          </div>

          {importable > 0 && (
            <div className={cn(card, 'flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between')}>
              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10" aria-hidden="true">
                  <Import className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">Import clients from your invoices</p>
                  <p className="text-xs text-muted-foreground">
                    {importable} client{importable === 1 ? '' : 's'} on your invoices {importable === 1 ? 'is' : 'are'} not saved yet. Duplicates (same name and email) are
                    skipped.
                  </p>
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={importClients} className="self-start sm:self-center">
                <Import className="h-4 w-4" aria-hidden="true" />
                Import {importable}
              </Button>
            </div>
          )}

          {!hydrated ? (
            <div className="flex justify-center py-16">
              <Spinner size="lg" />
            </div>
          ) : clients.length === 0 ? (
            <div className={cn(card, 'flex flex-col items-center gap-4 py-12 text-center')}>
              <div className="flex h-12 w-12 items-center justify-center rounded-md bg-secondary" aria-hidden="true">
                <Users className="h-6 w-6 text-muted-foreground" />
              </div>
              <div className="space-y-1">
                <p className="font-medium text-foreground">No saved clients yet</p>
                <p className="text-sm text-muted-foreground">Add one here, or use “Save as client” in the Bill To section of an invoice.</p>
              </div>
              <Button onClick={() => setEditing({})}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                Add your first client
              </Button>
            </div>
          ) : (
            <section aria-labelledby={`${searchId}-heading`} className="space-y-4">
              <h3 id={`${searchId}-heading`} className="sr-only">
                Saved clients
              </h3>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                  <label htmlFor={searchId} className="sr-only">
                    Search clients
                  </label>
                  <Input
                    id={searchId}
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search by name, email or address"
                    className="bg-secondary border-border pl-9"
                  />
                </div>
                {archivedCount > 0 && (
                  <Button variant="ghost" size="sm" aria-pressed={showArchived} onClick={() => setShowArchived((v) => !v)} className="self-start sm:self-auto">
                    <Archive className="h-4 w-4" aria-hidden="true" />
                    {showArchived ? 'Hide archived' : `Show archived (${archivedCount})`}
                  </Button>
                )}
              </div>
              <p className="sr-only" role="status" aria-live="polite">
                {visible.length} client{visible.length === 1 ? '' : 's'} shown
              </p>
              {visible.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">No clients match “{query}”.</p>
              ) : (
                <ul className="space-y-3">
                  {visible.map((client) => (
                    <ClientRow
                      key={client.id}
                      client={client}
                      invoiceCount={invoicesForClient(client, invoices).length}
                      onEdit={() => setEditing({ client })}
                      onNewInvoice={() => newInvoiceFor(client)}
                    />
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>
      </main>
      <ClientFormDialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)} client={editing?.client} onSave={save} />
    </div>
  );
}
