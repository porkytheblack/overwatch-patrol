import { contact, nav } from '@/lib/site';

export function Footer() {
  const year = 2026;
  return (
    <footer className="relative border-t border-border">
      <span aria-hidden className="reg -left-[5px] -top-[5px]" />
      <span aria-hidden className="reg -right-[5px] -top-[5px]" />
      <div className="grid grid-cols-1 gap-12 px-5 py-16 sm:px-8 lg:grid-cols-12 lg:px-12">
        <div className="lg:col-span-5">
          <div className="flex items-center gap-2.5">
            <span className="pulse-dot" />
            <span className="wordmark text-[13px]">Overwatch</span>
          </div>
          <p className="mt-5 max-w-[40ch] text-sm leading-relaxed text-text-muted">
            Autonomous patrol, custom control software, and WhatsApp and Telegram command channels. Surveyed, installed and
            provisioned on your site.
          </p>
        </div>
        <nav aria-label="Footer" className="grid grid-cols-2 gap-8 sm:grid-cols-3 lg:col-span-7">
          <div>
            <div className="label mb-4">Explore</div>
            <ul className="space-y-2.5">
              {nav.slice(0, 3).map((n) => (
                <li key={n.href}>
                  <a href={n.href} className="text-sm text-text-muted transition-colors hover:text-text">
                    {n.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="label mb-4">Engage</div>
            <ul className="space-y-2.5">
              {[...nav.slice(3), { href: '#faq', label: 'FAQ' }].map((n) => (
                <li key={n.href}>
                  <a href={n.href} className="text-sm text-text-muted transition-colors hover:text-text">
                    {n.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="label mb-4">Contact</div>
            <ul className="space-y-2.5">
              <li>
                <a href="#contact" className="text-sm text-text-muted transition-colors hover:text-text">
                  Book a site survey
                </a>
              </li>
              {contact.email ? (
                <li>
                  <a href={`mailto:${contact.email}`} className="text-sm text-text-muted transition-colors hover:text-text">
                    {contact.email}
                  </a>
                </li>
              ) : null}
              {contact.whatsapp ? (
                <li>
                  <a href={contact.whatsapp} className="text-sm text-text-muted transition-colors hover:text-text">
                    WhatsApp
                  </a>
                </li>
              ) : null}
              {contact.telegram ? (
                <li>
                  <a href={contact.telegram} className="text-sm text-text-muted transition-colors hover:text-text">
                    Telegram
                  </a>
                </li>
              ) : null}
            </ul>
          </div>
        </nav>
      </div>

      {/* Oversized wordmark, cropped by the frame */}
      <div aria-hidden className="overflow-hidden border-t border-border">
        <div className="mono select-none whitespace-nowrap pt-6 text-center font-medium uppercase leading-[0.72] tracking-[-0.02em] text-surface-elev" style={{ fontSize: 'clamp(3rem, 18vw, 14rem)' }}>
          Overwatch
        </div>
      </div>

      <div className="mono flex flex-col gap-3 border-t border-border px-5 py-5 text-[10px] uppercase tracking-[0.08em] text-text-dim sm:flex-row sm:items-center sm:justify-between sm:px-8 lg:px-12">
        <span>© {year} Overwatch</span>
        <span>Surveyed · Installed · Provisioned</span>
      </div>
    </footer>
  );
}
