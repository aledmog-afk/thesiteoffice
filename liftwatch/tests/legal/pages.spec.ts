import { describe, expect, it } from 'vitest';
import { PRIVACY_PAGE_PATH, TERMS_PAGE_PATH } from '../../src/config';

const raw = (glob: Record<string, unknown>) => Object.values(glob)[0] as string;
const privacy = raw(import.meta.glob('../../public/privacy.html', { query: '?raw', import: 'default', eager: true }));
const terms = raw(import.meta.glob('../../public/terms.html', { query: '?raw', import: 'default', eager: true }));
const app = raw(import.meta.glob('../../src/ui/app.ts', { query: '?raw', import: 'default', eager: true }));
const sources = import.meta.glob('../../src/**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const sw = raw(import.meta.glob('../../public/sw.js', { query: '?raw', import: 'default', eager: true }));

/** Visible text, without tags. */
const text = (html: string) => html.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/&rsquo;/g, '’').replace(/\s+/g, ' ');

describe('privacy notice (draft)', () => {
  const t = text(privacy);

  it('is marked DRAFT and has the controller and contact placeholders', () => {
    expect(t).toMatch(/DRAFT/);
    expect(t).toMatch(/CONFIG-CONTROLLER/);
    expect(t).toMatch(/CONFIG-CONTACT/);
  });

  it('lists every localStorage key, the IndexedDB stores and the cache the app uses', () => {
    const keys = new Set<string>();
    for (const src of Object.values(sources)) for (const m of src.matchAll(/'(liftwatch\.[a-zA-Z0-9.]+)'/g)) keys.add(m[1]);
    expect(keys.size).toBeGreaterThanOrEqual(9);
    for (const k of keys) {
      const shown = k.endsWith('.') ? `${k}&lt;lat,lon&gt;` : k; // the forecast cache is a prefix
      expect(privacy, k).toContain(`<code>${shown}</code>`);
    }
    const db = sources['../../src/storage/indexeddb.ts'];
    for (const m of db.matchAll(/(?:DB_NAME|STORE|LOG_STORE) = '([a-z]+)'/g)) expect(privacy, m[1]).toContain(`<code>${m[1]}</code>`);
    const cache = /const CACHE = '([^']+)'/.exec(sw)![1];
    expect(privacy).toContain(`<code>${cache}</code>`);
  });

  it('says where the postcode and the rounded coordinates plus IP go', () => {
    expect(t).toMatch(/postcode is sent to postcodes\.io/);
    expect(t).toMatch(/coordinates, rounded to 2 decimal places .* sent to\s*Open-Meteo\s*\.\s*Your IP address goes with each request/);
  });

  it('says there are no analytics and Cloudflare hosts the site', () => {
    expect(t).toMatch(/no analytics/i);
    expect(t).toMatch(/Cloudflare hosts the site/);
  });

  it('gives the right to complain to the ICO', () => {
    expect(t).toMatch(/right to complain to the Information Commissioner’s Office \(ICO\)/);
    expect(privacy).toContain('https://ico.org.uk/make-a-complaint/');
  });

  it('marks what needs a solicitor', () => {
    expect((t.match(/SOLICITOR/g) ?? []).length).toBeGreaterThanOrEqual(5);
  });
});

describe('terms of use (draft)', () => {
  const t = text(terms);

  it('is marked DRAFT with the placeholders and solicitor markers, and claims nothing on liability', () => {
    expect(t).toMatch(/DRAFT/);
    expect(t).toMatch(/CONFIG-CONTROLLER/);
    expect(t).toMatch(/CONFIG-CONTACT/);
    expect(t).toMatch(/SOLICITOR: limitation of liability/);
    expect(t).toMatch(/never an authorisation to lift/);
  });

  it('never uses the banned words', () => {
    for (const page of [t, text(privacy)]) expect(page).not.toMatch(/\bsafe\b|clear to lift|\bgo ahead\b/i);
  });
});

describe('footer', () => {
  it('links the privacy notice and terms from every screen', () => {
    expect(PRIVACY_PAGE_PATH).toBe('/privacy.html');
    expect(TERMS_PAGE_PATH).toBe('/terms.html');
    expect(app).toMatch(/h\('main', null, screens\[state\.screen\]\(ctx\), siteFooter\(\)\)/);
    expect(app).toMatch(/PRIVACY_PAGE_PATH, label: 'Privacy \(draft\)'/);
    expect(app).toMatch(/TERMS_PAGE_PATH, label: 'Terms \(draft\)'/);
  });
});
