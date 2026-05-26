/**
 * Status pill labels per spec §0.
 * Spec set: OPEN | INSPECTING | RESOLVED | ACK'D | SUPPRESSED.
 *
 * The API returns raw lowercase values; this maps to the brand strings.
 */
export function incidentLabel(status: string): string {
  switch (status) {
    case 'open':
      return 'OPEN';
    case 'inspecting':
      return 'INSPECTING';
    case 'acknowledged':
      return "ACK'D";
    case 'closed':
      return 'RESOLVED';
    case 'suppressed':
      return 'SUPPRESSED';
    default:
      return status.toUpperCase();
  }
}

export function incidentPillClass(status: string): string {
  switch (status) {
    case 'open':
      return 'pill pill-open';
    case 'inspecting':
      return 'pill pill-inspecting';
    case 'acknowledged':
      return 'pill pill-ackd';
    case 'closed':
      return 'pill pill-resolved';
    case 'suppressed':
      return 'pill pill-suppressed';
    default:
      return 'pill pill-muted';
  }
}

/** Format an ISO timestamp's HH:MM:SS portion in mono. */
export function timeOf(iso: string): string {
  return iso.slice(11, 19);
}
