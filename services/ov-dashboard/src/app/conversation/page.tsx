import { redirect } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { Shell } from '@/components/Shell';
import { ConversationPanel } from './ConversationPanel';
import type { Message, PendingConfirmation } from '@overwatch/agent';

// /api/agent/history isn't cacheable — it changes every turn and the
// dashboard always wants a fresh read on navigation.
export const dynamic = 'force-dynamic';

interface HistoryResponse {
  messages: Message[];
  pending_confirmation: PendingConfirmation | null;
}

async function loadInitial(): Promise<HistoryResponse> {
  try {
    return await apiFetch<HistoryResponse>('/api/agent/history?limit=50');
  } catch {
    // apiFetch throws a generic Error on any non-2xx. Match the rest of
    // the dashboard: anything that smells like an auth failure bounces
    // to /login; other failures aren't fatal here (we render an empty
    // conversation and let the operator try again).
    redirect('/login');
  }
}

export default async function ConversationPage() {
  const initial = await loadInitial();
  return (
    <Shell>
      <ConversationPanel initial={initial} />
    </Shell>
  );
}
