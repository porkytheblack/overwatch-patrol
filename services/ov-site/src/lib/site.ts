// Public contact details. Every field is optional: anything left unset is
// simply not rendered, so the page never shows a placeholder address.
export const contact = {
  email: process.env.NEXT_PUBLIC_CONTACT_EMAIL || '',
  // Full https://wa.me/<number> link, or empty.
  whatsapp: process.env.NEXT_PUBLIC_CONTACT_WHATSAPP_URL || '',
  // Full https://t.me/<handle> link, or empty.
  telegram: process.env.NEXT_PUBLIC_CONTACT_TELEGRAM_URL || '',
};

export const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3002';

export const nav = [
  { href: '#deliver', label: 'Services' },
  { href: '#in-action', label: 'In action' },
  { href: '#monitoring', label: 'Monitoring' },
  { href: '#deployment', label: 'Deployment' },
  { href: '#security', label: 'Security' },
  { href: '#engagements', label: 'Engagements' },
] as const;
