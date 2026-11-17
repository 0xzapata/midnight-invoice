/**
 * "Needs your review": sender details (your name, email, payment details) and
 * client addresses an agent wrote that you have not confirmed. Agents (and
 * automatic emails from recurring schedules) cannot email an invoice with
 * such data until you approve it here. Saving the invoice for another reason
 * does not approve it: only "Looks right — approve" or typing a new value
 * does. Cloud sync only (the review state lives on the server).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import type { ListReviewsResponse, ReviewField } from '../../../shared/api';
import { Button } from '@/components/ui/button';
import { api, ApiError } from '@/lib/api';
import { useCloudStore } from '@/stores/useCloudStore';

const reviewsKey = ['reviews'] as const;

const FIELD_LABELS: Record<ReviewField, string> = {
  fromName: 'Your name',
  fromEmail: 'Your email (replies go here)',
  paymentDetails: 'Payment details',
  toEmail: 'Client email (where it is sent)',
};

/** Pending reviews of this workspace (null while sync is off or loading). */
function useReviews(): ListReviewsResponse | null {
  const token = useCloudStore((s) => s.token);
  const query = useQuery({ queryKey: reviewsKey, queryFn: () => api.listReviews(), enabled: !!token, retry: false, staleTime: 15_000 });
  return token ? (query.data ?? null) : null;
}

function describeReviewError(error: unknown): string {
  if (error instanceof ApiError && error.status === 412) return 'It changed since you opened it. Check the values again and approve the new version.';
  return error instanceof Error ? error.message : 'Could not approve it. Try again.';
}

function useApprove(kind: 'invoice' | 'client') {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, revision }: { id: string; revision: number }): Promise<unknown> => (kind === 'invoice' ? api.reviewInvoice(id, revision) : api.reviewClient(id, revision)),
    onSuccess: () => {
      toast.success(kind === 'invoice' ? 'Approved. Agents can now email this invoice.' : 'Address confirmed.');
    },
    onError: (error) => toast.error(describeReviewError(error)),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: reviewsKey });
      void queryClient.invalidateQueries({ queryKey: ['activity'] });
    },
  });
}

/** Banner on the invoice page listing exactly which fields an agent wrote (old → new where known). */
export function InvoiceReviewBanner(props: { invoiceId: string; onEdit: () => void }) {
  const token = useCloudStore((s) => s.token);
  return token ? <InvoiceReviewBannerSynced {...props} /> : null;
}

function InvoiceReviewBannerSynced({ invoiceId, onEdit }: { invoiceId: string; onEdit: () => void }) {
  const reviews = useReviews();
  const approve = useApprove('invoice');
  const entry = reviews?.invoices.find((r) => r.id === invoiceId);
  if (!entry) return null;
  return (
    <section role="region" aria-label="Needs your review" className="mx-auto mb-6 w-full max-w-[595px] border border-amber-500/60 bg-amber-500/10 p-3 text-xs print:hidden">
      <h2 className="mb-1 flex items-center gap-2 font-medium text-foreground">
        <ShieldAlert className="h-4 w-4 text-amber-500" aria-hidden="true" />
        Needs your review
      </h2>
      <p className="mb-2 text-muted-foreground">
        {entry.agentName ? `An agent (${entry.agentName}) wrote` : 'You did not enter'} these details. Agents and automatic emails cannot send this invoice until you check them.
      </p>
      <dl className="space-y-1.5">
        {entry.fields.map((f) => (
          <div key={f.field}>
            <dt className="font-medium text-foreground">{FIELD_LABELS[f.field]}</dt>
            <dd className="flex flex-wrap items-center gap-1 break-all font-code text-muted-foreground">
              {f.previous !== null && f.previous !== f.value && (
                <>
                  <span className="line-through">{f.previous || '(empty)'}</span>
                  <ArrowRight className="h-3 w-3 shrink-0" aria-label="changed to" />
                </>
              )}
              <span className="whitespace-pre-wrap text-foreground">{f.value || '(empty)'}</span>
            </dd>
          </div>
        ))}
      </dl>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" disabled={approve.isPending} onClick={() => approve.mutate({ id: entry.id, revision: entry.revision })}>
          Looks right — approve
        </Button>
        <Button size="sm" variant="outline" onClick={onEdit}>
          Edit
        </Button>
      </div>
    </section>
  );
}

/** Inline notice on a client card whose email address an agent wrote. */
export function ClientReviewNotice(props: { clientId: string }) {
  const token = useCloudStore((s) => s.token);
  return token ? <ClientReviewNoticeSynced {...props} /> : null;
}

function ClientReviewNoticeSynced({ clientId }: { clientId: string }) {
  const reviews = useReviews();
  const approve = useApprove('client');
  const entry = reviews?.clients.find((r) => r.id === clientId);
  if (!entry) return null;
  return (
    <div role="note" aria-label="Email needs your review" className="mt-2 flex flex-wrap items-center gap-2 border border-amber-500/60 bg-amber-500/10 px-2 py-1.5 text-xs">
      <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden="true" />
      <span className="text-muted-foreground">
        <span className="break-all font-code text-foreground">{entry.email}</span> was {entry.agentName ? `added by an agent (${entry.agentName})` : 'not entered by you'}. Agents can’t email it until you confirm it.
      </span>
      <Button size="sm" variant="outline" disabled={approve.isPending} onClick={() => approve.mutate({ id: entry.id, revision: entry.revision })}>
        Confirm address
      </Button>
    </div>
  );
}
