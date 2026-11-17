/**
 * GitHub Actions client for "Redeploy": dispatches the deploy workflow
 * (workflow_dispatch) and lists its recent runs. REST API version 2022-11-28.
 */
import { OperatorError } from './errors';

export interface GithubOptions {
  apiUrl: string;
  token: string;
  repository: string; // owner/name
  workflow: string; // file name, e.g. deploy.yml
  fetch?: typeof fetch;
}

export interface WorkflowRun {
  id: number;
  status: string | null;
  conclusion: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  url: string | null;
  headSha: string | null;
  headBranch: string | null;
  event: string | null;
  title: string | null;
  actor: string | null;
}

export function createGithubClient(opts: GithubOptions) {
  const doFetch = opts.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const [owner, repo] = opts.repository.split('/');
  const base = `${opts.apiUrl.replace(/\/+$/, '')}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows/${encodeURIComponent(opts.workflow)}`;
  const headers = {
    authorization: `Bearer ${opts.token}`,
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'midnight-invoice-operator',
  };

  async function call(url: string, init: RequestInit = {}): Promise<Response> {
    let res: Response;
    try {
      res = await doFetch(url, { ...init, headers: { ...headers, ...init.headers }, signal: AbortSignal.timeout(10_000) });
    } catch {
      throw OperatorError.upstream('GitHub could not be reached.');
    }
    if (res.status === 401) throw OperatorError.upstream('GitHub rejected the token (401).');
    if (res.status === 403) throw OperatorError.upstream('GitHub refused the request (403): the token needs Actions read & write on this repository.');
    if (res.status === 404) throw OperatorError.upstream('GitHub: repository or workflow not found (404). Check the repository and workflow file settings.');
    if (res.status === 422) throw OperatorError.upstream('GitHub: the workflow has no workflow_dispatch trigger, or the ref does not exist (422).');
    if (!res.ok) throw OperatorError.upstream(`GitHub returned ${res.status}.`);
    return res;
  }

  return {
    async dispatch(ref: string, inputs?: Record<string, string>): Promise<void> {
      await call(`${base}/dispatches`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(inputs ? { ref, inputs } : { ref }),
      });
    },
    async listRuns(limit = 10): Promise<WorkflowRun[]> {
      const res = await call(`${base}/runs?per_page=${limit}`);
      const body = (await res.json()) as { workflow_runs?: Record<string, unknown>[] };
      const str = (v: unknown) => (typeof v === 'string' ? v : null);
      return (body.workflow_runs ?? []).map((r) => ({
        id: Number(r.id),
        status: str(r.status),
        conclusion: str(r.conclusion),
        createdAt: str(r.created_at),
        updatedAt: str(r.updated_at),
        url: str(r.html_url),
        headSha: str(r.head_sha),
        headBranch: str(r.head_branch),
        event: str(r.event),
        title: str(r.display_title),
        actor: str((r.actor as { login?: unknown } | undefined)?.login),
      }));
    },
  };
}
