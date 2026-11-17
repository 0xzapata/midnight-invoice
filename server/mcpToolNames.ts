/**
 * Every MCP tool name this server defines, filled by server/mcp.ts as it
 * builds servers (whatever the credential's scopes), plus the JSON-RPC
 * methods the MCP endpoint knows. Operator telemetry (server/operator/hooks.ts)
 * records only these, so request data never becomes a metric name.
 */
export const MCP_TOOL_NAMES = new Set<string>();

export const MCP_METHODS = new Set([
  'initialize',
  'ping',
  'tools/list',
  'tools/call',
  'resources/list',
  'resources/templates/list',
  'resources/read',
  'resources/subscribe',
  'resources/unsubscribe',
  'prompts/list',
  'prompts/get',
  'completion/complete',
  'logging/setLevel',
  'server/discover',
  'subscriptions/listen',
  'notifications/initialized',
  'notifications/cancelled',
  'notifications/progress',
  'notifications/roots/list_changed',
]);
