# SubSnap service data

The list of subscription services that [SubSnap](https://github.com/enderbrosik/subsnap) recognizes, with their
websites, cancellation pages and plan prices by country. The apps download it, so prices can be corrected without
releasing an app update.

**This git repository is the database.** The single source file is [`services.json`](services.json). There is no
server, no accounts, no user data and no tracking. Vercel only serves static files built from this repository.

| URL | What |
|---|---|
| `https://subsnap.pocketlantern.app/data/services.json` | The data (what the apps download) |
| `https://subsnap.pocketlantern.app/data/v1/services.json` | The same bytes, a permanent versioned alias |
| `https://subsnap.pocketlantern.app/data/` | Human-readable list of every service and price |
| `https://subsnap.pocketlantern.app/` | Placeholder page (kept separate from `/data`) |

These URLs must never change or break. Only additive changes to the format are allowed: new optional fields may be
added, but existing fields are never renamed, removed or given a different meaning.

## Format

```jsonc
{
  "version": 1,                      // whole number, raise it on every content change
  "updated": "2026-11-06",           // YYYY-MM-DD
  "note": "...",
  "services": [{
    "name": "Netflix",
    "aliases": ["netflix"],          // lowercase letters/digits only
    "domain": "netflix.com",
    "manage": "https://www.netflix.com/cancelplan",   // optional, https only
    "manageRegions": ["US"],         // optional, 2-letter country codes
    "regions": ["NL","BE"],          // optional, 2-letter country codes
    "plans": [{                      // optional
      "regions": ["NL"], "currency": "EUR",
      "plans": [{ "name": "Standard", "price": 15.99, "cycle": "monthly" }]
    }]
  }]
}
```

| Field | Meaning |
|---|---|
| `version` | Whole number. Raise it on every change to the file |
| `updated` | Date of the last change, `YYYY-MM-DD` |
| `name`, `aliases` | Display name, and the lowercase letters/digits a typed name is matched against. Aliases are unique across the file |
| `domain` | Website the logo is fetched for. Unique across the file (only `apple.com` may repeat, see below) |
| `manage` | Page where the plan can be cancelled or managed. HTTPS, on the service's own domain or another service's domain in the file |
| `manageRegions` | Countries where `manage` works (absent = everywhere) |
| `regions` | Countries where the service is recognized (absent = everywhere) |
| `plans` | Price tables: `regions` (country codes), `currency` (ISO 4217, e.g. `EUR`), and a list of `{name, price, cycle}` |
| `cycle` | One of `daily`, `weekly`, `monthly`, `yearly`, `decade` |

An app only uses a downloaded file if its `version` (or, for the same version, its `updated` date) is newer than the
one it already has. Links in a downloaded file are only used if they are HTTPS and on a known service's website.

`apple.com` is used by several separate services (iCloud+, Apple Music, Apple). This is the only domain allowed to
repeat. The list is `SHARED_DOMAINS` in `scripts/validate.mjs`.

## Adding a service or updating a price

1. Edit `services.json`.
2. Raise `version` by one.
3. Set `updated` to today's date.
4. Run `npm run validate` (Node 18 or newer, no install needed).
5. Open a pull request. The **Validate** check must pass before merging.

`npm run validate` fails on any of these: invalid JSON; missing required fields; duplicate aliases or domains; an
alias that is not lowercase letters/digits; a country code that is not 2 uppercase letters; a currency that is not
3 uppercase letters; a price that is not a positive number; an unknown cycle; a `manage` link that is not HTTPS or
whose host is not on the service's own domain or another service's domain in the file; and a `version` that is not
higher than on the main branch when the content changed.

`npm run build` writes `public/data/` (both JSON copies and the HTML page) from `services.json`. That folder is
generated and not committed.

## Contributing

- Copy prices from **the service's own website for that country**, not from news articles, comparison sites or
  memory.
- Check the date you copied them, and set `updated` to it.
- Use the plan names and currency the service itself shows for that country.
- One country (or a group of countries with the same price and currency) per `plans` entry.

## How deploys work

Vercel deploys every push to `main`. It runs `npm run build` and serves the `public/` folder. Pull requests get
preview deploys, but the custom domain always serves `main`. Headers for the JSON files are set in `vercel.json`:

- `Content-Type: application/json; charset=utf-8`
- `Cache-Control: public, max-age=300, s-maxage=3600, stale-while-revalidate=86400`
- `Access-Control-Allow-Origin: *`

Nothing in this repository sets cookies or logs anything about users. Do not enable Vercel Web Analytics or Speed
Insights for this project.

## Setting up the deploy

1. **GitHub:** the repository is `enderbrosik/subsnap-data`. Merge this setup into `main`.
2. **Vercel:** in the Vercel dashboard choose *Add New… → Project*, import `enderbrosik/subsnap-data`, leave
   *Framework Preset* on *Other*, and deploy. Build command and output folder come from `vercel.json`.
3. **Domain:** in the project go to *Settings → Domains*, add `subsnap.pocketlantern.app`.
4. **DNS:** at the registrar for `pocketlantern.app`, add one record:

   | Type | Name | Value |
   |---|---|---|
   | `CNAME` | `subsnap` | `cname.vercel-dns.com` |

   If Vercel's Domains page shows a different, project-specific CNAME value, use that one instead.
5. **Check DNS:**

   ```bash
   dig +short CNAME subsnap.pocketlantern.app
   ```

   It should print the CNAME value from step 4. Vercel then marks the domain *Valid Configuration* and issues the
   HTTPS certificate automatically. `.app` domains only work over HTTPS, because browsers force it for the whole
   `.app` zone. Vercel provides the certificate, so nothing else is needed.
6. **Check the live files:**

   ```bash
   curl -sS -o /dev/null -w '%{http_code}\n' https://subsnap.pocketlantern.app/data/services.json
   ```

   ```bash
   curl -sS -o /dev/null -w '%{http_code}\n' https://subsnap.pocketlantern.app/data/v1/services.json
   ```

   ```bash
   curl -sS https://subsnap.pocketlantern.app/data/services.json | python3 -m json.tool > /dev/null && echo valid JSON
   ```

   ```bash
   curl -sS https://subsnap.pocketlantern.app/data/v1/services.json | python3 -m json.tool > /dev/null && echo valid JSON
   ```

   ```bash
   curl -sSI https://subsnap.pocketlantern.app/data/services.json | grep -iE '^(HTTP|content-type|cache-control|access-control-allow-origin)'
   ```

   ```bash
   curl -sSI https://subsnap.pocketlantern.app/data/v1/services.json | grep -iE '^(HTTP|content-type|cache-control|access-control-allow-origin)'
   ```

   Expect `200`, `valid JSON`, and the three headers listed under *How deploys work*.

## Prices

Plan prices are copied from each service's own website on the `updated` date. They change often and differ by
country and account, so the apps present them as typical prices. No warranty.
