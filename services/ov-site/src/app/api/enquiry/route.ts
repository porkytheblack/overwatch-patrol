import { NextResponse } from 'next/server';
import { z } from 'zod';

// Survey requests from the contact form. Delivered to whichever sinks are
// configured — a Telegram chat (the same channel the product alerts on) and/or
// a generic JSON webhook. With neither configured the endpoint returns 503 and
// the form falls back to showing direct contact details.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SITE_TYPES = ['warehouse', 'construction', 'residential', 'campus', 'farm', 'retail', 'other'] as const;
const INTERESTS = ['control-software', 'whatsapp', 'telegram', 'managed'] as const;

const Enquiry = z.object({
  name: z.string().trim().min(1).max(120),
  organisation: z.string().trim().max(160).optional().default(''),
  contact: z.string().trim().min(3).max(200),
  siteType: z.enum(SITE_TYPES).optional(),
  interests: z.array(z.enum(INTERESTS)).max(INTERESTS.length).optional().default([]),
  message: z.string().trim().max(4000).optional().default(''),
  // Honeypot: real users never see or fill this field.
  website: z.string().max(0).optional(),
});

type EnquiryT = z.infer<typeof Enquiry>;

function reference() {
  const n = Math.floor(Date.now() / 1000) % 1_000_000;
  return `SRV-${n.toString(36).toUpperCase().padStart(4, '0')}`;
}

function asText(e: EnquiryT, ref: string) {
  const lines = [
    `[OVERWATCH] · survey request ${ref}`,
    `${e.name}${e.organisation ? ` · ${e.organisation}` : ''}`,
    `contact · ${e.contact}`,
    e.siteType ? `site · ${e.siteType}` : null,
    e.interests.length ? `interests · ${e.interests.join(', ')}` : null,
    e.message ? `\n${e.message}` : null,
  ];
  return lines.filter(Boolean).join('\n');
}

async function toTelegram(text: string) {
  const token = process.env.ENQUIRY_TELEGRAM_BOT_TOKEN;
  const chatId = process.env.ENQUIRY_TELEGRAM_CHAT_ID;
  if (!token || !chatId) return null;
  // Plain text, no parse_mode: user input is never interpreted as markup.
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4000), disable_web_page_preview: true }),
    signal: AbortSignal.timeout(8000),
  });
  return res.ok;
}

async function toWebhook(e: EnquiryT, ref: string) {
  const url = process.env.ENQUIRY_WEBHOOK_URL;
  if (!url) return null;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'survey_request', reference: ref, received_at: new Date().toISOString(), ...e, website: undefined }),
    signal: AbortSignal.timeout(8000),
  });
  return res.ok;
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  // Bots that fill the honeypot get a normal-looking success and nothing is sent.
  if (body && typeof body === 'object' && 'website' in body && (body as { website?: unknown }).website) {
    return NextResponse.json({ ok: true, reference: reference() });
  }

  const parsed = Enquiry.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid', fields: Object.keys(parsed.error.flatten().fieldErrors) },
      { status: 422 },
    );
  }

  const ref = reference();
  const text = asText(parsed.data, ref);
  const results = await Promise.allSettled([toTelegram(text), toWebhook(parsed.data, ref)]);
  const attempted = results.filter((r) => !(r.status === 'fulfilled' && r.value === null));
  const delivered = results.some((r) => r.status === 'fulfilled' && r.value === true);

  if (attempted.length === 0) {
    console.warn('[enquiry] no sink configured; set ENQUIRY_TELEGRAM_* or ENQUIRY_WEBHOOK_URL');
    return NextResponse.json({ error: 'not_configured' }, { status: 503 });
  }
  if (!delivered) {
    console.error('[enquiry] delivery failed', results);
    return NextResponse.json({ error: 'delivery_failed' }, { status: 502 });
  }
  return NextResponse.json({ ok: true, reference: ref });
}
