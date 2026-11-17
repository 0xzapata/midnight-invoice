import { Link } from 'react-router';
import { AlertTriangle, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCloudStore } from '@/stores/useCloudStore';
import { invoiceIssues } from '@/lib/validation';
import type { Invoice } from '@/types/invoice';

/**
 * Why an invoice is "Not synced": the fields the API rejects (checked locally
 * with the form's own schema), or the server's message when the problem is
 * something else. `null` when the invoice has no sync error.
 */
function useSyncIssue(invoice: Invoice): { messages: string[] } | null {
  const serverMessage = useCloudStore((state) => state.syncErrors[invoice.id]);
  if (!serverMessage) return null;
  const issues = invoiceIssues(invoice).map((issue) => issue.message);
  return { messages: issues.length > 0 ? issues : [serverMessage] };
}

/** Explains why the invoice could not be uploaded and links to the editor to fix it. */
export function SyncIssueNotice({ invoice }: { invoice: Invoice }) {
  const issue = useSyncIssue(invoice);
  if (!issue) return null;
  return (
    <div
      role="status"
      className="mx-auto mb-6 flex max-w-[595px] flex-col gap-3 border border-amber-500/30 bg-amber-500/10 p-4 text-sm sm:flex-row sm:items-start print:hidden"
    >
      <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400 sm:mt-0.5" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-foreground">Not synced: this invoice was not uploaded to your workspace</p>
        <p className="mt-0.5 text-muted-foreground">Fix the following and save it again:</p>
        <ul className="mt-1 list-disc pl-5 text-muted-foreground">
          {issue.messages.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      </div>
      <Button asChild size="sm" variant="outline" className="shrink-0 self-start font-mono">
        <Link to={`/create/${invoice.id}`} viewTransition>
          <Pencil className="mr-2 h-4 w-4" aria-hidden="true" />
          Edit to fix
        </Link>
      </Button>
    </div>
  );
}
