import { endOfDay, startOfDay } from 'date-fns';
import type { ActivityParams } from '@/lib/api/client';
import { ACTIVITY_ACTION_GROUPS, type ActivityActionGroup } from '../../../shared/activity';

/** Filters live in the URL (`?agent=<id>|you&group=…&from=YYYY-MM-DD&to=…`) so other pages can link to a filtered view. */
export function activityParamsOf(search: URLSearchParams): Omit<ActivityParams, 'before'> {
  const params: Omit<ActivityParams, 'before'> = {};
  const agent = search.get('agent');
  if (agent === 'you') params.actor = 'user';
  else if (agent) params.agentId = agent;
  const group = search.get('group') as ActivityActionGroup | null;
  if (group && group in ACTIVITY_ACTION_GROUPS) params.action = ACTIVITY_ACTION_GROUPS[group].prefixes;
  const from = search.get('from');
  const to = search.get('to');
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) params.since = startOfDay(new Date(`${from}T00:00:00`)).toISOString();
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) params.until = endOfDay(new Date(`${to}T00:00:00`)).toISOString();
  return params;
}
