import { useId, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Archive, ArchiveRestore, Bot, FilePlus2, FileStack, Pencil, Plus, Repeat, Search, Trash2, Users } from 'lucide-react';
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
import { TemplateFormDialog } from '@/components/templates/TemplateFormDialog';
import { useNewInvoiceFromTemplate } from '@/components/templates/useNewInvoiceFromTemplate';
import { recurringLink } from '@/recurring/useMakeRecurring';
import { useTemplateStore } from '@/stores/useTemplateStore';
import { useClientStore } from '@/stores/useClientStore';
import { useInvoiceStore } from '@/stores/useInvoiceStore';
import { useCloudEnabled, useCloudStore } from '@/stores/useCloudStore';
import { syncKey } from '@/lib/sync/collectionNames';
import { formatCurrency } from '@/lib/invoice-utils';
import { cn } from '@/lib/utils';
import { placeholdersIn } from '../../shared/template-placeholders';
import type { InvoiceTemplate, TemplateFormData } from '../../shared/types/template';

const card = 'rounded-lg border border-border bg-card p-4 sm:p-5';

function matches(t: InvoiceTemplate, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [t.name, t.description, ...t.lineItems.map((l) => l.description)].some((v) => v.toLowerCase().includes(q));
}

function TermsLine({ template, clientName }: { template: InvoiceTemplate; clientName: string | null }) {
  const parts: { key: string; node: ReactNode }[] = [];
  if (clientName)
    parts.push({
      key: 'client',
      node: (
        <span className="inline-flex items-center gap-1">
          <Users className="h-3 w-3" aria-hidden="true" />
          {clientName}
        </span>
      ),
    });
  if (template.currency) parts.push({ key: 'cur', node: template.currency });
  if (template.taxRate != null) parts.push({ key: 'tax', node: `${template.taxRate}% tax` });
  if (template.paymentTermsDays != null) parts.push({ key: 'terms', node: template.paymentTermsDays === 0 ? 'Due on receipt' : `Net ${template.paymentTermsDays}` });
  if (parts.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Template defaults">
      {parts.map((p) => (
        <li key={p.key} className="border border-border px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
          {p.node}
        </li>
      ))}
    </ul>
  );
}

function TemplateRow({ template, usedCount, onEdit, onNewInvoice }: { template: InvoiceTemplate; usedCount: number; onEdit: () => void; onNewInvoice: () => void }) {
  const syncError = useCloudStore((s) => s.syncErrors[syncKey('templates', template.id)]);
  const client = useClientStore((s) => (template.clientId ? s.clients.find((c) => c.id === template.clientId) : undefined));
  const archived = !!template.archivedAt;
  const { setArchived, deleteTemplate } = useTemplateStore.getState();
  const agentName = template.createdBy?.type === 'agent' ? template.createdBy.agentName || 'an agent' : null;
  const subtotal = template.lineItems.reduce((s, l) => s + l.quantity * l.price, 0);
  const usesPlaceholders = [template.invoiceNamePattern, template.notes, ...template.lineItems.map((l) => l.description)].some((t) => placeholdersIn(t).length > 0);

  return (
    <li className={cn(card, 'flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between', archived && 'opacity-70')}>
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-secondary" aria-hidden="true">
          <FileStack className="h-5 w-5 text-muted-foreground" />
        </div>
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="break-words font-sans font-medium text-foreground">{template.name}</h3>
            {archived && <span className="bg-secondary px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Archived</span>}
            {agentName && (
              <span className="inline-flex items-center gap-1 border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium leading-none text-primary" title={`Added by the agent “${agentName}”`}>
                <Bot className="h-3 w-3" aria-hidden="true" />
                by {agentName}
              </span>
            )}
            {syncError && (
              <span className="border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-medium leading-none text-amber-600 dark:text-amber-400" title={`Not synced: ${syncError}`}>
                Not synced
              </span>
            )}
          </div>
          {template.description && <p className="line-clamp-2 break-words text-sm text-muted-foreground">{template.description}</p>}
          {template.lineItems.length > 0 && (
            <ul className="space-y-0.5 text-xs text-muted-foreground" aria-label="Line items">
              {template.lineItems.slice(0, 3).map((l) => (
                <li key={l.id} className="flex gap-2">
                  <span className="min-w-0 truncate font-code">{l.description}</span>
                  <span className="shrink-0 tabular-nums">
                    {l.quantity !== 1 && `${l.quantity} × `}
                    {formatCurrency(l.price, template.currency || 'USD')}
                  </span>
                </li>
              ))}
              {template.lineItems.length > 3 && <li>+ {template.lineItems.length - 3} more</li>}
            </ul>
          )}
          <TermsLine template={template} clientName={client?.name ?? null} />
          <p className="text-xs text-muted-foreground">
            {template.lineItems.length === 0
              ? 'No line items'
              : `${template.lineItems.length} item${template.lineItems.length === 1 ? '' : 's'} · ${formatCurrency(subtotal, template.currency || 'USD')} before tax`}
            {usesPlaceholders && ' · uses placeholders'}
            {usedCount > 0 && ` · used for ${usedCount} invoice${usedCount === 1 ? '' : 's'}`}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 sm:shrink-0 sm:justify-end">
        {!archived && (
          <Button size="sm" onClick={onNewInvoice} aria-label={`New invoice from ${template.name}`}>
            <FilePlus2 className="h-4 w-4" aria-hidden="true" />
            New invoice
          </Button>
        )}
        {!archived && (
          <Button variant="outline" size="icon" className="h-9 w-9" asChild>
            <Link to={recurringLink(template.id)} viewTransition aria-label={`Make ${template.name} recurring`} title="Make recurring">
              <Repeat className="h-4 w-4" aria-hidden="true" />
            </Link>
          </Button>
        )}
        <Button variant="outline" size="icon" className="h-9 w-9" onClick={onEdit} aria-label={`Edit ${template.name}`} title="Edit">
          <Pencil className="h-4 w-4" aria-hidden="true" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="h-9 w-9"
          title={archived ? 'Unarchive' : 'Archive'}
          onClick={() => {
            setArchived(template.id, !archived);
            toast.success(archived ? `“${template.name}” is back in your templates` : `Archived “${template.name}”`, {
              description: archived ? undefined : 'It is hidden from the template pickers.',
            });
          }}
          aria-label={`${archived ? 'Unarchive' : 'Archive'} ${template.name}`}
        >
          {archived ? <ArchiveRestore className="h-4 w-4" aria-hidden="true" /> : <Archive className="h-4 w-4" aria-hidden="true" />}
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" size="icon" className="h-9 w-9 text-destructive hover:text-destructive" aria-label={`Delete ${template.name}`} title="Delete">
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete “{template.name}”?</AlertDialogTitle>
              <AlertDialogDescription>
                The template is removed{useCloudStore.getState().token ? ' on all your devices' : ''}.{' '}
                {usedCount > 0 ? `The ${usedCount} invoice${usedCount === 1 ? '' : 's'} created from it stay as they are.` : 'No invoices are affected.'} To just hide it, archive it
                instead.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  deleteTemplate(template.id);
                  toast.success(`Deleted “${template.name}”`);
                }}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Delete template
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </li>
  );
}

/** `/templates`: reusable invoice templates. */
export default function Templates() {
  const templates = useTemplateStore((s) => s.templates);
  const hydrated = useTemplateStore((s) => s._hasHydrated);
  const invoices = useInvoiceStore((s) => s.invoices);
  const cloudEnabled = useCloudEnabled();
  const newInvoiceFrom = useNewInvoiceFromTemplate();
  const [query, setQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<{ template?: InvoiceTemplate } | null>(null);
  const searchId = useId();

  const archivedCount = templates.filter((t) => t.archivedAt).length;
  const visible = templates
    .filter((t) => (showArchived ? true : !t.archivedAt))
    .filter((t) => matches(t, query))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

  const save = (data: TemplateFormData) => {
    const saved = useTemplateStore.getState().saveTemplate(data, editing?.template?.id);
    toast.success(editing?.template ? `Saved changes to “${saved.name}”` : `Added “${saved.name}”`);
    setEditing(null);
  };

  return (
    <div className="min-h-screen bg-background">
      <PageHeader
        title="Templates"
        actions={
          <Button size="sm" onClick={() => setEditing({})}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only sm:not-sr-only">Add template</span>
          </Button>
        }
      />
      <main className="container py-8">
        <div className="mx-auto max-w-3xl space-y-8">
          <div>
            <h2 className="mb-2 text-2xl font-semibold text-foreground">Templates</h2>
            <p className="text-sm text-muted-foreground">
              Reusable invoice blueprints: line items, terms, notes and a default client. Placeholders such as <span className="font-code text-foreground">{'{{month_name}}'}</span> are
              filled in for each invoice’s issue date. {cloudEnabled ? 'Synced to your cloud workspace' : 'Stored in this browser'}; invoices are independent copies, so editing a
              template never changes past invoices.
            </p>
          </div>

          {!hydrated ? (
            <div className="flex justify-center py-16">
              <Spinner size="lg" />
            </div>
          ) : templates.length === 0 ? (
            <div className={cn(card, 'flex flex-col items-center gap-4 py-12 text-center')}>
              <div className="flex h-12 w-12 items-center justify-center rounded-md bg-secondary" aria-hidden="true">
                <FileStack className="h-6 w-6 text-muted-foreground" />
              </div>
              <div className="space-y-1">
                <p className="font-medium text-foreground">No templates yet</p>
                <p className="text-sm text-muted-foreground">Add one here, or use “Save as template” on an invoice.</p>
              </div>
              <Button onClick={() => setEditing({})}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                Add your first template
              </Button>
            </div>
          ) : (
            <section aria-labelledby={`${searchId}-heading`} className="space-y-4">
              <h3 id={`${searchId}-heading`} className="sr-only">
                Saved templates
              </h3>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                  <label htmlFor={searchId} className="sr-only">
                    Search templates
                  </label>
                  <Input
                    id={searchId}
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search templates"
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
                {visible.length} template{visible.length === 1 ? '' : 's'} shown
              </p>
              {visible.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">{query ? `No templates match “${query}”.` : 'All templates are archived.'}</p>
              ) : (
                <ul className="space-y-3">
                  {visible.map((template) => (
                    <TemplateRow
                      key={template.id}
                      template={template}
                      usedCount={invoices.filter((inv) => inv.templateId === template.id).length}
                      onEdit={() => setEditing({ template })}
                      onNewInvoice={() => newInvoiceFrom(template)}
                    />
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>
      </main>
      <TemplateFormDialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)} template={editing?.template} onSave={save} />
    </div>
  );
}
