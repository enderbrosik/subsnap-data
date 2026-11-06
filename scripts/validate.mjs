#!/usr/bin/env node
// Validates services.json. Run with `npm run validate`.
//
// Checks the structure of the file, and (when a git base is available) that
// "version" was raised whenever the content differs from the main branch.
//
// Base for the version check, in order of preference:
//   1. the VALIDATE_BASE environment variable (any git revision, e.g. a commit SHA)
//   2. origin/main
//   3. main
// If none of these exist, or the base has no services.json yet, the check is skipped.

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SOURCE = path.join(ROOT, 'services.json');
export const LOCALES = path.join(ROOT, 'locales.json');

export const CYCLES = ['daily', 'weekly', 'monthly', 'yearly', 'decade'];

// Domains that more than one service may share. Apple sells iCloud+, Apple Music
// and other subscriptions on the same website, and each needs its own entry.
// Add to this list only when two genuinely separate subscriptions live on one site.
export const SHARED_DOMAINS = ['apple.com'];

const ALIAS_RE = /^[a-z0-9]+$/;
const COUNTRY_RE = /^[A-Z]{2}$/;
const CURRENCY_RE = /^[A-Z]{3}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNonEmptyString = (v) => typeof v === 'string' && v.trim() !== '';

function isValidDate(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function hostIsOn(host, domain) {
  return host === domain || host.endsWith(`.${domain}`);
}

/**
 * Validates parsed services data. Returns a list of error messages (empty = valid).
 */
export function validateData(data) {
  const errors = [];
  const err = (where, msg) => errors.push(`${where}: ${msg}`);

  if (!isObject(data)) {
    err('file', 'top level must be a JSON object');
    return errors;
  }

  if (!('version' in data)) err('version', 'missing required field');
  else if (!Number.isInteger(data.version) || data.version < 1) {
    err('version', `must be a whole number of at least 1, got ${JSON.stringify(data.version)}`);
  }

  if (!('updated' in data)) err('updated', 'missing required field');
  else if (!isValidDate(data.updated)) {
    err('updated', `must be a real date written as YYYY-MM-DD, got ${JSON.stringify(data.updated)}`);
  }

  if ('note' in data && typeof data.note !== 'string') err('note', 'must be a string');

  if (!('services' in data)) {
    err('services', 'missing required field');
    return errors;
  }
  if (!Array.isArray(data.services)) {
    err('services', 'must be an array');
    return errors;
  }
  if (data.services.length === 0) err('services', 'must not be empty');

  // Collect all well-formed domains first so "manage" links can be checked against them.
  const allDomains = data.services
    .filter((s) => isObject(s) && typeof s.domain === 'string' && DOMAIN_RE.test(s.domain))
    .map((s) => s.domain);

  const aliasOwner = new Map();
  const domainOwner = new Map();

  const checkCountries = (where, value, { required }) => {
    if (value === undefined) {
      if (required) err(where, 'missing required field');
      return;
    }
    if (!Array.isArray(value)) {
      err(where, 'must be an array of 2-letter country codes');
      return;
    }
    if (required && value.length === 0) err(where, 'must list at least one country');
    const seen = new Set();
    value.forEach((code, i) => {
      if (typeof code !== 'string' || !COUNTRY_RE.test(code)) {
        err(`${where}[${i}]`, `country code must be 2 uppercase letters, got ${JSON.stringify(code)}`);
      } else if (seen.has(code)) {
        err(`${where}[${i}]`, `country code ${code} is listed twice`);
      }
      seen.add(code);
    });
  };

  data.services.forEach((s, si) => {
    const label = isObject(s) && isNonEmptyString(s.name) ? `services[${si}] (${s.name})` : `services[${si}]`;

    if (!isObject(s)) {
      err(label, 'must be an object');
      return;
    }

    // name
    if (!('name' in s)) err(`${label}.name`, 'missing required field');
    else if (!isNonEmptyString(s.name)) err(`${label}.name`, 'must be a non-empty string');

    // aliases
    if (!('aliases' in s)) err(`${label}.aliases`, 'missing required field');
    else if (!Array.isArray(s.aliases) || s.aliases.length === 0) {
      err(`${label}.aliases`, 'must be a non-empty array');
    } else {
      s.aliases.forEach((alias, ai) => {
        const where = `${label}.aliases[${ai}]`;
        if (typeof alias !== 'string' || !ALIAS_RE.test(alias)) {
          err(where, `must be lowercase letters and digits only, got ${JSON.stringify(alias)}`);
          return;
        }
        if (aliasOwner.has(alias)) {
          err(where, `duplicate alias "${alias}" (also used by ${aliasOwner.get(alias)})`);
        } else {
          aliasOwner.set(alias, label);
        }
      });
    }

    // domain
    if (!('domain' in s)) err(`${label}.domain`, 'missing required field');
    else if (typeof s.domain !== 'string' || !DOMAIN_RE.test(s.domain)) {
      err(`${label}.domain`, `must be a lowercase host name like "example.com", got ${JSON.stringify(s.domain)}`);
    } else if (domainOwner.has(s.domain) && !SHARED_DOMAINS.includes(s.domain)) {
      err(`${label}.domain`, `duplicate domain "${s.domain}" (also used by ${domainOwner.get(s.domain)})`);
    } else if (!domainOwner.has(s.domain)) {
      domainOwner.set(s.domain, label);
    }

    // manage (optional)
    if ('manage' in s) {
      const where = `${label}.manage`;
      let url = null;
      if (typeof s.manage === 'string') {
        try {
          url = new URL(s.manage);
        } catch {
          url = null;
        }
      }
      if (!url) {
        err(where, `must be a valid URL, got ${JSON.stringify(s.manage)}`);
      } else if (url.protocol !== 'https:') {
        err(where, `must use https, got ${JSON.stringify(s.manage)}`);
      } else if (url.username || url.password) {
        err(where, 'must not contain a user name or password');
      } else {
        const host = url.hostname.toLowerCase();
        const own = typeof s.domain === 'string' && hostIsOn(host, s.domain);
        if (!own && !allDomains.some((d) => hostIsOn(host, d))) {
          err(where, `host "${host}" is not on ${JSON.stringify(s.domain)} or any other service's domain in this file`);
        }
      }
    }

    // regions, manageRegions (optional)
    checkCountries(`${label}.regions`, s.regions, { required: false });
    checkCountries(`${label}.manageRegions`, s.manageRegions, { required: false });

    // plans (optional)
    if ('plans' in s) {
      if (!Array.isArray(s.plans)) {
        err(`${label}.plans`, 'must be an array');
      } else {
        s.plans.forEach((group, gi) => {
          const gw = `${label}.plans[${gi}]`;
          if (!isObject(group)) {
            err(gw, 'must be an object');
            return;
          }
          checkCountries(`${gw}.regions`, group.regions, { required: true });

          if (!('currency' in group)) err(`${gw}.currency`, 'missing required field');
          else if (typeof group.currency !== 'string' || !CURRENCY_RE.test(group.currency)) {
            err(`${gw}.currency`, `must be 3 uppercase letters, got ${JSON.stringify(group.currency)}`);
          }

          if (!('plans' in group)) {
            err(`${gw}.plans`, 'missing required field');
            return;
          }
          if (!Array.isArray(group.plans) || group.plans.length === 0) {
            err(`${gw}.plans`, 'must be a non-empty array');
            return;
          }
          group.plans.forEach((plan, pi) => {
            const pw = `${gw}.plans[${pi}]`;
            if (!isObject(plan)) {
              err(pw, 'must be an object');
              return;
            }
            if (!('name' in plan)) err(`${pw}.name`, 'missing required field');
            else if (!isNonEmptyString(plan.name)) err(`${pw}.name`, 'must be a non-empty string');

            if (!('price' in plan)) err(`${pw}.price`, 'missing required field');
            else if (typeof plan.price !== 'number' || !Number.isFinite(plan.price) || plan.price <= 0) {
              err(`${pw}.price`, `must be a positive number, got ${JSON.stringify(plan.price)}`);
            }

            if (!('cycle' in plan)) err(`${pw}.cycle`, 'missing required field');
            else if (!CYCLES.includes(plan.cycle)) {
              err(`${pw}.cycle`, `must be one of ${CYCLES.join(', ')}, got ${JSON.stringify(plan.cycle)}`);
            }
          });
        });
      }
    }
  });

  return errors;
}

const LOCALE_RE = /^[a-z]{2}-[a-z]{2}$/;

/**
 * Validates the parsed locales.json: a list of unique "language-country" codes in lowercase,
 * like "en-us". Each one gets its own /<locale>/data/services.json. Returns a list of errors.
 */
export function validateLocales(locales) {
  const errors = [];
  if (!Array.isArray(locales) || locales.length === 0) {
    return ['locales.json: must be a non-empty array of locale codes like "en-us"'];
  }
  const seen = new Set();
  locales.forEach((loc, i) => {
    if (typeof loc !== 'string' || !LOCALE_RE.test(loc)) {
      errors.push(`locales.json[${i}]: must be a lowercase language-country code like "en-us", got ${JSON.stringify(loc)}`);
    } else if (seen.has(loc)) {
      errors.push(`locales.json[${i}]: "${loc}" is listed twice`);
    } else if (loc === 'data') {
      errors.push(`locales.json[${i}]: "data" is reserved`);
    }
    seen.add(loc);
  });
  return errors;
}

/**
 * Builds the file for one country: the same format, with only the services recognized in that
 * country and only the price tables that include it. Everything else is copied unchanged.
 */
export function filterForCountry(data, country) {
  const services = [];
  for (const s of data.services) {
    if (Array.isArray(s.regions) && s.regions.length > 0 && !s.regions.includes(country)) continue;
    const copy = { ...s };
    if (Array.isArray(s.plans)) {
      const groups = s.plans.filter((g) => g.regions.includes(country));
      if (groups.length > 0) copy.plans = groups;
      else delete copy.plans;
    }
    services.push(copy);
  }
  return { ...data, services };
}

/**
 * Reads and parses a JSON file. Returns { data } or { error }.
 */
export function readJson(file) {
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (e) {
    return { error: `cannot read ${path.relative(ROOT, file) || file}: ${e.message}` };
  }
  try {
    return { raw, data: JSON.parse(raw) };
  } catch (e) {
    return { error: `${path.relative(ROOT, file) || file} is not valid JSON: ${e.message}` };
  }
}

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

function resolveBase() {
  const candidates = process.env.VALIDATE_BASE ? [process.env.VALIDATE_BASE] : ['origin/main', 'main'];
  for (const rev of candidates) {
    try {
      git(['rev-parse', '--verify', '--quiet', `${rev}^{commit}`]);
      return rev;
    } catch {
      // try the next one
    }
  }
  return null;
}

/**
 * Compares the file with the base revision. Returns a list of errors and a status message.
 */
export function checkVersionAgainstBase(data) {
  const base = resolveBase();
  if (!base) {
    const msg = process.env.VALIDATE_BASE
      ? `base revision "${process.env.VALIDATE_BASE}" not found`
      : 'no main branch found';
    return { errors: process.env.VALIDATE_BASE ? [`version check: ${msg}`] : [], message: `version check skipped (${msg})` };
  }

  let baseRaw;
  try {
    baseRaw = git(['show', `${base}:services.json`]);
  } catch {
    return { errors: [], message: `version check skipped (${base} has no services.json yet)` };
  }

  let baseData;
  try {
    baseData = JSON.parse(baseRaw);
  } catch {
    return { errors: [], message: `version check skipped (services.json on ${base} is not valid JSON)` };
  }

  if (isDeepStrictEqual(baseData, data)) {
    return { errors: [], message: `content unchanged from ${base} (version ${data.version})` };
  }

  const baseVersion = baseData && baseData.version;
  if (!Number.isInteger(baseVersion)) {
    return { errors: [], message: `version check skipped (version on ${base} is not a whole number)` };
  }
  if (!(data.version > baseVersion)) {
    return {
      errors: [
        `version: content changed compared with ${base}, so "version" must be higher than ${baseVersion} (it is ${JSON.stringify(data.version)})`,
      ],
      message: '',
    };
  }
  return { errors: [], message: `content changed; version raised from ${baseVersion} to ${data.version} (compared with ${base})` };
}

function main() {
  const file = SOURCE;
  const { data, error } = readJson(file);
  if (error) {
    console.error(`✗ ${error}`);
    process.exit(1);
  }

  const errors = validateData(data);
  const locales = readJson(LOCALES);
  if (locales.error) errors.push(locales.error);
  else errors.push(...validateLocales(locales.data));
  let message = '';
  if (errors.length === 0) {
    const result = checkVersionAgainstBase(data);
    errors.push(...result.errors);
    message = result.message;
  }

  if (errors.length > 0) {
    console.error(`✗ found ${errors.length} problem${errors.length === 1 ? '' : 's'}:`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  console.log(`✓ services.json is valid: ${data.services.length} services, version ${data.version}, updated ${data.updated}`);
  console.log(`✓ locales.json is valid: ${locales.data.length} locales`);
  if (message) console.log(`  ${message}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
