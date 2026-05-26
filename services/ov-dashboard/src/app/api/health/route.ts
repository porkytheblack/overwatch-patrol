// spec §15 DoD: every service has /health
export const dynamic = 'force-static';

export function GET() {
  return Response.json({ status: 'ok', service: 'ov-dashboard' });
}
