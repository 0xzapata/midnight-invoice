import { useId } from 'react';
import { History } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useCloudEnabled } from '@/stores/useCloudStore';
import { describeError } from '@/lib/api/errors';
import { ActivityTimeline } from './ActivityTimeline';
import { useActivityFeed } from './useActivity';

/**
 * Compact "History" of one invoice on its page (who created, changed,
 * downloaded it). Server-side only: hidden while cloud sync is off.
 */
export function InvoiceHistory({ invoiceId }: { invoiceId: string }) {
  const enabled = useCloudEnabled();
  if (!enabled) return null;
  return <InvoiceHistoryList invoiceId={invoiceId} />;
}

function InvoiceHistoryList({ invoiceId }: { invoiceId: string }) {
  const headingId = useId();
  const feed = useActivityFeed({ entityType: 'invoice', entityId: invoiceId }, { pageSize: 5 });
  const entries = feed.data?.pages.flatMap((p) => p.activity) ?? [];

  return (
    <section aria-labelledby={headingId} className="mx-auto mt-8 w-full max-w-[595px] border border-border bg-card p-4 print:hidden">
      <h2 id={headingId} className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
        <History className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        History
      </h2>
      {feed.isPending ? (
        <div className="flex justify-center py-4" role="status" aria-label="Loading history">
          <Spinner size="sm" />
        </div>
      ) : feed.isError ? (
        <p className="text-xs text-destructive" role="alert">
          {describeError(feed.error)}
        </p>
      ) : entries.length === 0 ? (
        <p className="text-xs text-muted-foreground">No recorded changes yet. Changes made while cloud sync is on show up here.</p>
      ) : (
        <>
          <ActivityTimeline entries={entries} compact label="Invoice history" selfEntityId={invoiceId} />
          {feed.hasNextPage && (
            <Button variant="ghost" size="sm" className="mt-1 h-8 px-2 text-xs" onClick={() => void feed.fetchNextPage()} disabled={feed.isFetchingNextPage}>
              {feed.isFetchingNextPage ? 'Loading…' : 'Show earlier changes'}
            </Button>
          )}
        </>
      )}
    </section>
  );
}
