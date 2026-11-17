import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { AlertTriangle, Bot, CalendarClock, FileStack, Pause, Pencil, Play, Plus, Repeat, Trash2, Users, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
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
import { EnableCloudSyncCard } from '@/components/sync/CloudSyncSettings';
import { useCloudEnabled } from '@/stores/useCloudStore';
import { useTemplateStore } from '@/stores/useTemplateStore';
import { useClientStore } from '@/stores/useClientStore';
import { useInvoiceStore } from '@/stores/useInvoiceStore';
import { ApiError, describeError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { AUTO_ACTION_LABELS, formatRunDate, type RecurringSchedule } from '../../shared/recurring';
import type { RecurringInput } from '../../shared/api';
import { flushLocalChanges, recurringApi, useRecurringList, useRecurringMutation } from '@/recurring/api';
import { RecurringFormDialog, type RecurringPrefill } from '@/recurring/RecurringFormDialog';

const card = 'rounded-lg border border-border bg-card p-4 sm:p-5';

const STATUS_STYLE: Record<RecurringSchedule['status'], string> = {
  active: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  paused: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400',
  ended: 'border-border bg-secondary text-muted-foreground',
};

/** Turns a failed save into a sentence (an unknown template usually means it is still uploading). */
function saveErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.code === 'validation_failed') {
    const details = Array.isArray(error.details) ? (error.details as { path?: string; message?: string }[]) : [];
    if (details.some((d) => d.path === 'templateId') && error.message === 'Unknown template') {
      return 'This template has not reached your cloud workspace yet. Wait for sync to finish, then try again.';
    }
    if (details.some((d) => d.path === 'clientId') && error.message === 'Unknown client') {
      return 'This client has not reached your cloud workspace yet. Wait for sync to finish, then try again.';
    }
    if (details[0]?.message) return details[0].message;
  }
  return describeError(error);
}

function ScheduleRow({ schedule, onEdit }: { schedule: RecurringSchedule; onEdit: () => void }) {
  const template = useTemplateStore((s) => s.templates.find((t) => t.id === schedule.templateId));
  const clientId = schedule.clientId ?? template?.clientId ?? null;
  const client = useClientStore((s) => (clientId ? s.clients.find((c) => c.id === clientId) : undefined));
  const lastInvoice = useInvoiceStore((s) => (schedule.lastInvoiceId ? s.invoices.find((i) => i.id === schedule.lastInvoiceId) : undefined));
  const pause = useRecurringMutation((id: string) => recurringApi.pause(id));
  const resume = useRecurringMutation((id: string) => recurringApi.resume(id));
  const remove = useRecurringMutation((id: string) => recurringApi.remove(id));
  const runNow = useRecurringMutation((args: { id: string; period: string }) => recurringApi.runNow(args.id, args.period), { pullInvoices: true });
  const busy = pause.isPending || resume.isPending || remove.isPending || runNow.isPending;
  const agentName = schedule.createdBy?.type === 'agent' ? schedule.createdBy.agentName || 'an agent' : null;
  const err = schedule.lastError;
  const nextLabel = schedule.nextRunDate ? formatRunDate(schedule.nextRunDate) : null;

  const act = async (done: string, failed: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
      toast.success(done);
    } catch (error) {
      toast.error(failed, { description: saveErrorMessage(error) });
    }
  };

  return (
    <li className={cn(card, 'flex flex-col gap-4', schedule.status === 'ended' && 'opacity-80')} data-testid="recurring-row">
      <div className="flex min-w-0 items-start gap-3">
        <div className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-md bg-secondary sm:flex" aria-hidden="true">
          <Repeat className="h-5 w-5 text-muted-foreground" />
        </div>
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="break-words font-sans font-medium text-foreground">{schedule.name}</h3>
            <span className={cn('border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider', STATUS_STYLE[schedule.status])}>{schedule.status}</span>
            {agentName && (
              <span className="inline-flex items-center gap-1 border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium leading-none text-primary" title={`Set up by the agent “${agentName}”`}>
                <Bot className="h-3 w-3" aria-hidden="true" />
                by {agentName}
              </span>
            )}
          </div>
          <p className="text-sm text-foreground">{schedule.summary.split(' — ')[0]}</p>
          <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground" aria-label="Details">
            <li className="inline-flex min-w-0 items-center gap-1">
              <FileStack className="h-3 w-3 shrink-0" aria-hidden="true" />
              {template ? (
                <Link to="/templates" className="truncate underline decoration-border underline-offset-2 hover:text-foreground">
                  {template.name}
                </Link>
              ) : (
                <span>Template not in this browser</span>
              )}
            </li>
            <li className="inline-flex min-w-0 items-center gap-1">
              <Users className="h-3 w-3 shrink-0" aria-hidden="true" />
              <span className="truncate">{client?.name ?? (clientId ? 'Saved client' : 'No client')}</span>
            </li>
            <li>{AUTO_ACTION_LABELS[schedule.autoAction]}</li>
            <li>{schedule.timezone.replace(/_/g, ' ')}</li>
          </ul>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-xs min-[420px]:grid-cols-2">
            <div className="flex gap-1.5">
              <dt className="text-muted-foreground">Next:</dt>
              <dd className="font-medium text-foreground">
                {schedule.status === 'ended' ? 'Ended' : schedule.status === 'paused' ? `Paused${nextLabel ? ` (was ${nextLabel})` : ''}` : (nextLabel ?? '—')}
              </dd>
            </div>
            <div className="flex min-w-0 gap-1.5">
              <dt className="text-muted-foreground">Last:</dt>
              <dd className="min-w-0 break-words text-foreground">
                {schedule.lastRunDate ? (
                  <>
                    {lastInvoice ? (
                      <Link to={`/invoice/${lastInvoice.id}`} className="font-mono underline decoration-border underline-offset-2 hover:decoration-foreground">
                        {lastInvoice.invoiceNumber}
                      </Link>
                    ) : (
                      'Invoice'
                    )}{' '}
                    for {formatRunDate(schedule.lastRunDate)} · {schedule.runCount} so far
                  </>
                ) : (
                  'None yet'
                )}
              </dd>
            </div>
          </dl>
          {schedule.lastSkipped && (
            <p className="text-xs text-muted-foreground">
              Skipped {schedule.lastSkipped.count === 1 ? '1 missed date' : `${schedule.lastSkipped.count} missed dates`} ({formatRunDate(schedule.lastSkipped.from)}
              {schedule.lastSkipped.count > 1 ? ` – ${formatRunDate(schedule.lastSkipped.to)}` : ''}): only the most recent missed invoice is created.
            </p>
          )}
        </div>
      </div>

      {err && (
        <div role="alert" className="flex gap-2.5 border border-destructive/30 bg-destructive/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
          <div className="min-w-0 space-y-0.5">
            <p className="font-medium text-foreground">
              {err.code === 'email_failed' ? 'Created, but not emailed' : `Could not create the invoice${err.period ? ` for ${formatRunDate(err.period)}` : ''}`}
            </p>
            <p className="break-words text-muted-foreground">{err.message}</p>
            {schedule.retryAt && schedule.status === 'active' && (
              <p className="text-xs text-muted-foreground">
                Tried {err.attempts === 1 ? 'once' : `${err.attempts} times`}; next try after{' '}
                {new Date(schedule.retryAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}. Editing the schedule retries at the next run.
              </p>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        {schedule.status === 'active' && schedule.nextRunDate && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" disabled={busy} aria-label={`Run ${schedule.name} now`}>
                <Zap className="h-4 w-4" aria-hidden="true" />
                Run now
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Create the {formatRunDate(schedule.nextRunDate)} invoice now?</AlertDialogTitle>
                <AlertDialogDescription>
                  The invoice for the next date is created right away (dated {formatRunDate(schedule.nextRunDate)}) and the schedule moves on to the following date. Doing this twice never
                  creates two invoices for the same date.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() =>
                    void (async () => {
                      try {
                        const res = await runNow.mutateAsync({ id: schedule.id, period: schedule.nextRunDate! });
                        toast.success(res.generated ? `Created ${res.invoice?.invoiceNumber ?? 'the invoice'}` : 'That invoice already exists', {
                          description: res.generated ? `For ${formatRunDate(res.period)}. It appears on your dashboard in a moment.` : undefined,
                        });
                      } catch (error) {
                        toast.error('Could not create the invoice', { description: saveErrorMessage(error) });
                      }
                    })()
                  }
                >
                  Create invoice
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
        {schedule.status === 'active' && (
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void act(`Paused “${schedule.name}”`, 'Could not pause the schedule', () => pause.mutateAsync(schedule.id))}>
            <Pause className="h-4 w-4" aria-hidden="true" />
            Pause
          </Button>
        )}
        {schedule.status === 'paused' && (
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void act(`Resumed “${schedule.name}”`, 'Could not resume the schedule', () => resume.mutateAsync(schedule.id))}>
            <Play className="h-4 w-4" aria-hidden="true" />
            Resume
          </Button>
        )}
        <Button variant="outline" size="icon" className="h-9 w-9" onClick={onEdit} aria-label={`Edit ${schedule.name}`} title="Edit">
          <Pencil className="h-4 w-4" aria-hidden="true" />
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" size="icon" className="h-9 w-9 text-destructive hover:text-destructive" aria-label={`Delete ${schedule.name}`} title="Delete" disabled={busy}>
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete “{schedule.name}”?</AlertDialogTitle>
              <AlertDialogDescription>
                No more invoices will be created. The {schedule.runCount === 1 ? 'invoice' : `${schedule.runCount} invoices`} it already created stay as they are. To stop it for a while,
                pause it instead.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => void act(`Deleted “${schedule.name}”`, 'Could not delete the schedule', () => remove.mutateAsync(schedule.id))}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Delete schedule
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </li>
  );
}

function ScheduleList({ onEdit, onNew }: { onEdit: (s: RecurringSchedule) => void; onNew: () => void }) {
  const list = useRecurringList();
  const hasTemplates = useTemplateStore((s) => s.templates.some((t) => !t.archivedAt));
  if (list.isPending) {
    return (
      <div className="flex justify-center py-16" role="status" aria-label="Loading recurring invoices">
        <Spinner size="lg" />
      </div>
    );
  }
  if (list.isError) {
    return (
      <div className={cn(card, 'flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between')} role="alert">
        <p className="text-sm text-destructive">{describeError(list.error)}</p>
        <Button variant="outline" size="sm" onClick={() => void list.refetch()}>
          Try again
        </Button>
      </div>
    );
  }
  if (list.data.length === 0) {
    return (
      <div className={cn(card, 'flex flex-col items-center gap-4 py-12 text-center')}>
        <div className="flex h-12 w-12 items-center justify-center rounded-md bg-secondary" aria-hidden="true">
          <CalendarClock className="h-6 w-6 text-muted-foreground" />
        </div>
        <div className="space-y-1">
          <p className="font-medium text-foreground">No recurring invoices yet</p>
          <p className="text-sm text-muted-foreground">
            {hasTemplates ? 'Pick a template and how often to bill, e.g. a monthly retainer on the 1st.' : 'Recurring invoices are made from a template. '}
            {!hasTemplates && (
              <Link to="/templates" className="text-primary underline-offset-4 hover:underline">
                Add a template first
              </Link>
            )}
          </p>
        </div>
        {hasTemplates && (
          <Button onClick={onNew}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Set up a recurring invoice
          </Button>
        )}
      </div>
    );
  }
  const order = { active: 0, paused: 1, ended: 2 } as const;
  const sorted = [...list.data].sort((a, b) => order[a.status] - order[b.status] || (a.nextRunDate ?? '9').localeCompare(b.nextRunDate ?? '9') || a.name.localeCompare(b.name));
  return (
    <ul className="space-y-3" aria-label="Recurring invoices">
      {sorted.map((s) => (
        <ScheduleRow key={s.id} schedule={s} onEdit={() => onEdit(s)} />
      ))}
    </ul>
  );
}

/** `/recurring`: schedules that create invoices from a template automatically (`?template=…&client=…` opens a prefilled dialog). */
export default function Recurring() {
  const enabled = useCloudEnabled();
  const [search, setSearch] = useSearchParams();
  const prefillTemplate = search.get('template');
  const [editing, setEditing] = useState<{ schedule?: RecurringSchedule; prefill?: RecurringPrefill } | null>(() =>
    prefillTemplate ? { prefill: { templateId: prefillTemplate, clientId: search.get('client') } } : null,
  );
  const create = useRecurringMutation((input: RecurringInput) => recurringApi.create(input));
  const update = useRecurringMutation((args: { id: string; input: RecurringInput; revision: number }) => recurringApi.update(args.id, args.input, args.revision));

  const close = () => {
    setEditing(null);
    if (search.has('template')) setSearch(new URLSearchParams(), { replace: true });
  };

  const save = async (input: RecurringInput): Promise<string | null> => {
    // Templates and clients are created in this browser first; make sure they reached the server.
    const template = useTemplateStore.getState().templates.find((t) => t.id === input.templateId);
    const client = input.clientId ? useClientStore.getState().clients.find((c) => c.id === input.clientId) : undefined;
    if ((template && template.revision === undefined) || (client && client.revision === undefined)) await flushLocalChanges();
    try {
      if (editing?.schedule) {
        const saved = await update.mutateAsync({ id: editing.schedule.id, input, revision: editing.schedule.revision });
        toast.success(`Saved “${saved.recurring.name}”`, { description: saved.recurring.summary });
      } else {
        const saved = await create.mutateAsync(input);
        toast.success(`Set up “${saved.recurring.name}”`, { description: saved.recurring.summary });
      }
      close();
      return null;
    } catch (error) {
      return saveErrorMessage(error);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <PageHeader
        title="Recurring"
        actions={
          enabled && (
            <Button size="sm" onClick={() => setEditing({})}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              <span className="sr-only sm:not-sr-only">New schedule</span>
            </Button>
          )
        }
      />
      <main className="container py-8">
        <div className="mx-auto max-w-3xl space-y-8">
          <div>
            <h2 className="mb-2 text-2xl font-semibold text-foreground">Recurring invoices</h2>
            <p className="text-sm text-muted-foreground">
              Bill the same thing every week, month, quarter or year: the server creates the invoice from a template on each date, in your time zone, even when this browser is closed.
              New invoices are drafts by default and show up on your dashboard.
            </p>
          </div>
          {!enabled ? (
            <EnableCloudSyncCard reason="Recurring invoices are created by the cloud workspace, so they need cloud sync. While it is off, nothing is scheduled and nothing is sent to the server." />
          ) : (
            <ScheduleList onEdit={(schedule) => setEditing({ schedule })} onNew={() => setEditing({})} />
          )}
        </div>
      </main>
      {enabled && (
        <RecurringFormDialog open={editing !== null} onOpenChange={(open) => !open && close()} schedule={editing?.schedule} prefill={editing?.prefill} onSave={save} />
      )}
    </div>
  );
}
