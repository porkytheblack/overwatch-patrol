import { Shell } from '@/components/Shell';
import { SettingsTabs } from '@/components/SettingsTabs';
import { apiFetch } from '@/lib/api';
import { redirect } from 'next/navigation';
import { TelegramForm } from './TelegramForm';
import { SubscribersForm } from './SubscribersForm';

interface BotCfg {
  channel: string;
  enabled: boolean;
  config: { bot_token_set: boolean; bot_username: string | null } | null;
}
interface Sub {
  id: string;
  channel: string;
  handle: string;
  enabled: boolean;
}
interface Status {
  robot: { state: string; last_seen_at: string } | null;
  bridge_ws_url: string;
}

async function load() {
  try {
    const [bot, subs, status] = await Promise.all([
      apiFetch<BotCfg>('/api/bot-configs/telegram'),
      apiFetch<{ subscribers: Sub[] }>('/api/subscribers'),
      apiFetch<Status>('/api/system/status'),
    ]);
    return { bot, subs: subs.subscribers, status };
  } catch {
    redirect('/login');
  }
}

export default async function Page() {
  const { bot, subs, status } = await load();
  return (
    <Shell>
      <div className="p-4 max-w-3xl space-y-6">
        <SettingsTabs />
        <section>
          <h2 className="mono uppercase text-sm tracking-[0.04em] mb-3">TELEGRAM</h2>
          <TelegramForm enabled={bot.enabled} tokenSet={bot.config?.bot_token_set ?? false} />
        </section>
        <section>
          <h2 className="mono uppercase text-sm tracking-[0.04em] mb-3">SUBSCRIBERS</h2>
          <SubscribersForm initial={subs} botUsername={bot.config?.bot_username ?? null} />
        </section>
        <section>
          <h2 className="mono uppercase text-sm tracking-[0.04em] mb-3">SYSTEM</h2>
          <div className="card mono text-xs space-y-1">
            <div>
              <span className="text-text-dim uppercase">robot state</span>{' '}
              {status.robot?.state ?? 'OFFLINE'}
            </div>
            <div>
              <span className="text-text-dim uppercase">last seen</span>{' '}
              {status.robot?.last_seen_at ?? '—'}
            </div>
            <div>
              <span className="text-text-dim uppercase">bridge ws</span> {status.bridge_ws_url}
            </div>
          </div>
        </section>
      </div>
    </Shell>
  );
}
