# SubSnap service data

The list of subscription services that [SubSnap](https://github.com/enderbrosik/subsnap) recognizes, with their
websites, cancellation pages and plan prices by country. The apps download `services.json` from here, so prices can
be corrected without releasing an app update.

## Format

`services.json` has a `version` (whole number), an `updated` date, and a list of `services`. Each service has:

| Field | Meaning |
|---|---|
| `name`, `aliases` | Display name, and lowercase letters/digits the typed name is matched against |
| `domain` | Website the logo is fetched for |
| `manage` | Page where the plan can be cancelled or managed (HTTPS, on the service's own site) |
| `manageRegions` | Countries where `manage` works (empty = everywhere) |
| `regions` | Countries where the service is recognized (empty = everywhere) |
| `plans` | Price tables: `regions` (country codes), `currency`, and a list of `{name, price, cycle}` |

An app only uses a downloaded file if its `version` (or, for the same version, its `updated` date) is newer than the
one it already has. Links in a downloaded file are only used if they are HTTPS and on a known service's website.

## Prices

Plan prices are copied from each service's own website on the `updated` date. They change often and differ by
country and account, so the apps present them as typical prices. No warranty.
