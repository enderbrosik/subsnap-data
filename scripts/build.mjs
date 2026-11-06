#!/usr/bin/env node
// Builds public/data/ from services.json. Run with `npm run build` (Vercel runs it on every deploy).
//
//   public/data/services.json      byte-for-byte copy of services.json
//   public/data/v1/services.json   byte-for-byte copy of services.json (permanent versioned alias)
//   public/data/index.html         human-readable list of every service and price
//   public/<locale>/data/services.json     the same format, only what applies to that country
//   public/<locale>/data/v1/services.json  same bytes as above (permanent versioned alias)
//
// Locales come from locales.json; "en-us" uses country US. Each pair of JSON files is written
// from the same bytes, so the alias can never differ from its main file.

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { LOCALES, ROOT, SOURCE, filterForCountry, readJson, validateData, validateLocales } from './validate.mjs';

const PUBLIC = path.join(ROOT, 'public');
const OUT = path.join(PUBLIC, 'data');

const { raw, data, error } = readJson(SOURCE);
if (error) {
  console.error(`✗ ${error}`);
  process.exit(1);
}
const localesFile = readJson(LOCALES);
const errors = validateData(data);
if (localesFile.error) errors.push(localesFile.error);
else errors.push(...validateLocales(localesFile.data));
if (errors.length > 0) {
  console.error('✗ services.json is not valid; run `npm run validate` for details:');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const CYCLE_LABEL = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year', decade: '10 years' };

const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
const countryName = (code) => {
  try {
    return regionNames.of(code) || code;
  } catch {
    return code;
  }
};
const countryList = (codes) => codes.map((c) => `<abbr title="${esc(countryName(c))}">${esc(c)}</abbr>`).join(', ');

function formatPrice(price, currency) {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency }).format(price);
  } catch {
    return `${price} ${currency}`;
  }
}

function serviceHtml(s) {
  const facts = [];
  facts.push(`<a href="https://${esc(s.domain)}" rel="noopener noreferrer">${esc(s.domain)}</a>`);
  if (s.regions && s.regions.length) facts.push(`Recognized in ${countryList(s.regions)}`);
  if (s.manage) {
    const where = s.manageRegions && s.manageRegions.length ? ` (${countryList(s.manageRegions)})` : '';
    facts.push(`<a href="${esc(s.manage)}" rel="noopener noreferrer">Manage or cancel</a>${where}`);
  }

  let plans;
  if (s.plans && s.plans.length) {
    plans = s.plans
      .map(
        (g) => `
        <div class="group">
          <h3>${countryList(g.regions)} <span class="currency">${esc(g.currency)}</span></h3>
          <table>
            <tbody>
${g.plans
  .map(
    (p) =>
      `              <tr><td>${esc(p.name)}</td><td class="price">${esc(formatPrice(p.price, g.currency))}<span class="cycle"> / ${esc(CYCLE_LABEL[p.cycle] || p.cycle)}</span></td></tr>`,
  )
  .join('\n')}
            </tbody>
          </table>
        </div>`,
      )
      .join('');
  } else {
    plans = '\n        <p class="none">No prices listed.</p>';
  }

  return `
      <section class="service" id="${esc(s.aliases[0])}">
        <h2>${esc(s.name)}</h2>
        <p class="facts">${facts.join(' · ')}</p>
        <div class="groups">${plans}
        </div>
      </section>`;
}

const priced = data.services.filter((s) => s.plans && s.plans.length).length;

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>SubSnap service data</title>
  <meta name="description" content="Subscription services and typical plan prices used by the SubSnap apps.">
  <style>
    :root {
      color-scheme: light dark;
      --bg: #fbfbfa; --fg: #1d1d1f; --muted: #6b6b70; --line: #e4e4e2; --card: #ffffff; --accent: #2a5bd7;
    }
    @media (prefers-color-scheme: dark) {
      :root { --bg: #141416; --fg: #ececee; --muted: #9a9aa2; --line: #2c2c31; --card: #1c1c20; --accent: #8aa9ff; }
    }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--fg);
      font: 16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
    main { max-width: 860px; margin: 0 auto; padding: 32px 16px 64px; }
    a { color: var(--accent); }
    header h1 { margin: 0 0 4px; font-size: 1.9rem; letter-spacing: -0.01em; }
    .meta { color: var(--muted); margin: 0 0 16px; }
    .notice { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 12px 16px; margin: 0 0 12px; }
    .links { font-size: 0.95rem; margin: 0 0 32px; }
    code { font-size: 0.9em; overflow-wrap: anywhere; }
    .service { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 16px 18px; margin: 0 0 14px; }
    .service h2 { margin: 0; font-size: 1.2rem; }
    .facts { margin: 2px 0 0; color: var(--muted); font-size: 0.92rem; overflow-wrap: anywhere; }
    .groups { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px 20px; margin-top: 10px; }
    .groups:empty { display: none; }
    .group h3 { margin: 0 0 4px; font-size: 0.85rem; font-weight: 600; color: var(--muted); }
    .currency { font-weight: 400; }
    abbr { text-decoration: none; }
    table { width: 100%; border-collapse: collapse; font-size: 0.95rem; }
    td { padding: 3px 0; border-top: 1px solid var(--line); vertical-align: top; }
    td.price { text-align: right; white-space: nowrap; padding-left: 12px; font-variant-numeric: tabular-nums; }
    .cycle { color: var(--muted); font-size: 0.85em; }
    .none { margin: 0; color: var(--muted); font-size: 0.92rem; }
    footer { color: var(--muted); font-size: 0.9rem; margin-top: 32px; }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>SubSnap service data</h1>
      <p class="meta">Version ${esc(data.version)} · updated <time datetime="${esc(data.updated)}">${esc(data.updated)}</time> · ${data.services.length} services, ${priced} with prices</p>
      <p class="notice">Prices are typical prices, copied from each service's own website for that country on the date it was checked. They change often and can differ by account, so always check the service itself.</p>
      <p class="links">Machine-readable: <a href="services.json"><code>/data/services.json</code></a> · <a href="v1/services.json"><code>/data/v1/services.json</code></a></p>
      <p class="links">One country only: ${localesFile.data.map((l) => `<a href="/${esc(l)}/data/services.json"><code>${esc(l)}</code></a>`).join(' · ')}</p>
    </header>
${data.services.map(serviceHtml).join('\n')}
    <footer>
      <p>This page and the JSON files are static. No accounts, no cookies, no tracking. <a href="/">SubSnap</a></p>
    </footer>
  </main>
</body>
</html>
`;

rmSync(OUT, { recursive: true, force: true });
mkdirSync(path.join(OUT, 'v1'), { recursive: true });
writeFileSync(path.join(OUT, 'services.json'), raw);
writeFileSync(path.join(OUT, 'v1', 'services.json'), raw);
writeFileSync(path.join(OUT, 'index.html'), html);

for (const locale of localesFile.data) {
  const country = locale.slice(3).toUpperCase();
  const dir = path.join(PUBLIC, locale, 'data');
  const json = `${JSON.stringify(filterForCountry(data, country), null, 2)}\n`;
  rmSync(path.join(PUBLIC, locale), { recursive: true, force: true });
  mkdirSync(path.join(dir, 'v1'), { recursive: true });
  writeFileSync(path.join(dir, 'services.json'), json);
  writeFileSync(path.join(dir, 'v1', 'services.json'), json);
}

console.log(`✓ built public/data/ (version ${data.version}, ${data.services.length} services) and ${localesFile.data.length} locales`);
