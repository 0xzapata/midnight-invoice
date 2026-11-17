import { Link } from 'react-router';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { History } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { predicateOf, sentenceOf } from './describe';
import { useAgentActivityPreview } from './useActivity';

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Last few things an agent did (or that happened to it), plus a link to its full activity. */
export function AgentActivityPreview({ agentId, agentName }: { agentId: string; agentName: string }) {
  const query = useAgentActivityPreview(agentId, 3);
  return (
    <div className="space-y-1.5">
      {query.data && query.data.length > 0 && (
        <ul className="space-y-0.5 border-l border-border pl-3" aria-label={`Latest activity of ${agentName}`}>
          {query.data.map((entry) => (
            <li key={entry.id} className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
              {/* The row already names the agent: drop it from its own actions. */}
              <span className="text-foreground/80">
                {entry.actor.type === 'agent' && entry.actor.agentId === agentId ? capitalize(predicateOf(entry)) : sentenceOf(entry)}
              </span>
              <span> · {formatDistanceToNow(parseISO(entry.time), { addSuffix: true })}</span>
            </li>
          ))}
        </ul>
      )}
      {query.data && query.data.length === 0 && <p className="text-xs text-muted-foreground">No recorded activity yet.</p>}
      <Button variant="link" size="sm" asChild className="h-auto p-0 text-xs">
        <Link to={`/activity?agent=${encodeURIComponent(agentId)}`} aria-label={`View activity of ${agentName}`}>
          <History className="h-3.5 w-3.5" aria-hidden="true" />
          View activity
        </Link>
      </Button>
    </div>
  );
}
