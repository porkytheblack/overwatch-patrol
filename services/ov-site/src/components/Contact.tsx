'use client';

import { useState, type FormEvent } from 'react';
import { contact } from '@/lib/site';
import { Arrow, Corners } from './primitives';

const SITE_TYPES = [
  ['warehouse', 'Warehouse or logistics yard'],
  ['construction', 'Construction site'],
  ['residential', 'Residential estate'],
  ['campus', 'Campus or data centre'],
  ['farm', 'Farm or remote asset'],
  ['retail', 'Retail or car park'],
  ['other', 'Something else'],
] as const;

const INTERESTS = [
  ['control-software', 'Custom control software'],
  ['whatsapp', 'WhatsApp integration'],
  ['telegram', 'Telegram + smart monitoring'],
  ['managed', 'Managed support'],
] as const;

type Status =
  | { s: 'idle' }
  | { s: 'sending' }
  | { s: 'sent'; ref: string; contact: string }
  | { s: 'error'; reason: 'invalid' | 'unavailable' | 'network' };

export function Contact() {
  const [status, setStatus] = useState<Status>({ s: 'idle' });
  const direct = [
    contact.email ? { label: 'Email', value: contact.email, href: `mailto:${contact.email}` } : null,
    contact.whatsapp ? { label: 'WhatsApp', value: 'Message us', href: contact.whatsapp } : null,
    contact.telegram ? { label: 'Telegram', value: 'Message us', href: contact.telegram } : null,
  ].filter(Boolean) as { label: string; value: string; href: string }[];

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const payload = {
      name: String(fd.get('name') ?? ''),
      organisation: String(fd.get('organisation') ?? ''),
      contact: String(fd.get('contact') ?? ''),
      siteType: (fd.get('siteType') as string) || undefined,
      interests: fd.getAll('interests').map(String),
      message: String(fd.get('message') ?? ''),
      website: String(fd.get('website') ?? ''),
    };
    setStatus({ s: 'sending' });
    try {
      const res = await fetch('/api/enquiry', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as { reference?: string };
      if (res.ok) setStatus({ s: 'sent', ref: data.reference ?? '', contact: payload.contact });
      else setStatus({ s: 'error', reason: res.status === 422 ? 'invalid' : 'unavailable' });
    } catch {
      setStatus({ s: 'error', reason: 'network' });
    }
  }

  return (
    <section id="contact" className="relative border-t border-border">
      <span aria-hidden className="reg -left-[5px] -top-[5px]" />
      <span aria-hidden className="reg -right-[5px] -top-[5px]" />
      <div className="line-grid pointer-events-none absolute inset-0 opacity-50 [mask-image:linear-gradient(to_top,black,transparent_80%)]" aria-hidden />
      <div className="relative grid grid-cols-1 gap-14 px-5 py-20 sm:px-8 md:py-28 lg:grid-cols-12 lg:gap-12 lg:px-12">
        <div className="lg:col-span-5" data-reveal>
          <p className="eyebrow mb-6">
            <span className="pulse-dot" />
            Site survey
          </p>
          <h2 className="h-section text-balance">Put your site under watch.</h2>
          <p className="lede mt-6 max-w-[44ch] text-pretty">
            Tell us about the site. We arrange a survey, walk the perimeter with you, and come back with a coverage plan and a
            quote.
          </p>

          <ol className="mt-12 border-t border-border">
            {['We reply to arrange a survey.', 'We walk the site with you.', 'You get a coverage plan and a quote.'].map((t, i) => (
              <li key={t} className="flex items-center gap-4 border-b border-border py-4 text-[15px] text-text">
                <span className="mono text-[11px] text-accent">0{i + 1}</span>
                {t}
              </li>
            ))}
          </ol>

          {direct.length ? (
            <dl className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2">
              {direct.map((d) => (
                <div key={d.label}>
                  <dt className="label">{d.label}</dt>
                  <dd className="mt-1.5">
                    <a href={d.href} className="text-[15px] text-text underline decoration-border-strong underline-offset-4 hover:decoration-accent">
                      {d.value}
                    </a>
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>

        <div className="lg:col-span-7" data-reveal style={{ ['--reveal-delay' as string]: '120ms' }}>
          <div className="relative border border-border-strong bg-bg p-5 sm:p-8">
            <Corners />
            {status.s === 'sent' ? (
              <div className="flex min-h-[420px] flex-col justify-center" role="status">
                <span className="pill pill-ackd w-fit">Received</span>
                <h3 className="mt-6 text-3xl font-medium tracking-[-0.02em] text-text">Request logged.</h3>
                <p className="mt-4 max-w-[44ch] text-[15px] leading-relaxed text-text-muted">
                  We will reach you at <span className="text-text">{status.contact}</span> to arrange the survey.
                </p>
                {status.ref ? (
                  <p className="mono mt-8 text-[11px] uppercase tracking-[0.08em] text-text-dim">
                    Reference <span className="text-accent">{status.ref}</span>
                  </p>
                ) : null}
              </div>
            ) : (
              <form onSubmit={onSubmit} className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <Field label="Name" htmlFor="f-name">
                  <input id="f-name" name="name" required maxLength={120} autoComplete="name" className="input" />
                </Field>
                <Field label="Organisation" htmlFor="f-org" optional>
                  <input id="f-org" name="organisation" maxLength={160} autoComplete="organization" className="input" />
                </Field>
                <Field label="Email or phone" htmlFor="f-contact" className="sm:col-span-2">
                  <input id="f-contact" name="contact" required minLength={3} maxLength={200} autoComplete="email" className="input" />
                </Field>
                <Field label="Site type" htmlFor="f-site" className="sm:col-span-2">
                  <select id="f-site" name="siteType" defaultValue="" className="select appearance-none bg-[length:10px] bg-[right_14px_center] bg-no-repeat" style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%23a3a3a3'/%3E%3C/svg%3E")` }}>
                    <option value="" disabled>
                      Select one
                    </option>
                    {SITE_TYPES.map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </Field>
                <fieldset className="sm:col-span-2">
                  <legend className="label mb-3">Interested in</legend>
                  <div className="grid grid-cols-1 gap-px border border-border bg-border sm:grid-cols-2">
                    {INTERESTS.map(([v, l]) => (
                      <label key={v} className="flex cursor-pointer items-center gap-3 bg-surface px-3 py-3 text-sm text-text transition-colors hover:bg-surface-elev">
                        <input type="checkbox" name="interests" value={v} />
                        {l}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <Field label="About the site" htmlFor="f-msg" optional className="sm:col-span-2">
                  <textarea
                    id="f-msg"
                    name="message"
                    maxLength={4000}
                    className="textarea"
                    placeholder="Size, entrances, current guarding, what worries you, timeline"
                  />
                </Field>
                {/* Honeypot, hidden from people and assistive tech. */}
                <div aria-hidden className="absolute -left-[9999px] h-px w-px overflow-hidden">
                  <label>
                    Website
                    <input name="website" tabIndex={-1} autoComplete="off" />
                  </label>
                </div>

                <div className="flex flex-col gap-4 sm:col-span-2 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs leading-relaxed text-text-dim">We only use these details to arrange your survey.</p>
                  <button type="submit" disabled={status.s === 'sending'} className="btn btn-primary btn-lg disabled:opacity-60">
                    {status.s === 'sending' ? 'Sending…' : 'Request a survey'} <Arrow />
                  </button>
                </div>

                {status.s === 'error' ? (
                  <p role="alert" className="border border-danger px-3 py-2.5 text-sm text-text sm:col-span-2">
                    {status.reason === 'invalid'
                      ? 'Check your name and contact details, then try again.'
                      : 'We could not send that just now.'}
                    {status.reason !== 'invalid' && contact.email ? (
                      <>
                        {' '}
                        Email us at{' '}
                        <a className="underline underline-offset-4" href={`mailto:${contact.email}`}>
                          {contact.email}
                        </a>{' '}
                        instead.
                      </>
                    ) : status.reason !== 'invalid' ? (
                      ' Please try again shortly.'
                    ) : null}
                  </p>
                ) : null}
              </form>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function Field({
  label,
  htmlFor,
  optional,
  className = '',
  children,
}: {
  label: string;
  htmlFor: string;
  optional?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <label htmlFor={htmlFor} className="label flex justify-between">
        {label}
        {optional ? <span className="normal-case tracking-normal text-text-dim">Optional</span> : null}
      </label>
      {children}
    </div>
  );
}
