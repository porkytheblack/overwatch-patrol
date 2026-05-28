/**
 * Local mirror of `@overwatch/agent`'s `describeAction` helper.
 *
 * We can't import it from `@overwatch/agent` in the browser bundle —
 * that package's index transitively pulls in glove-core / glove-mcp /
 * drizzle-orm / better-sqlite3, none of which work client-side.
 * `describeAction` itself is pure and tiny, so duplicating the body
 * here keeps the dashboard a clean source-only consumer without giving
 * up the Telegram-parity labels.
 *
 * Keep this in sync with `packages/agent/src/agent.ts#describeAction`.
 */
export function describeAction(
  tool: string,
  args: Record<string, unknown>,
): string {
  const base = tool.split('__').pop() ?? tool;
  if (base === 'execute_sport_command') {
    return `execute ${args.command_name ?? 'sport command'}`;
  }
  if (base === 'stop_surveillance') return 'stop surveillance';
  if (base === 'delete_waypoint') return `delete waypoint ${args.name ?? ''}`;
  return base;
}
