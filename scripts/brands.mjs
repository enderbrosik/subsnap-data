// Brand list and recognition model, served next to services.json:
//   /data/brands.json        brands the apps recognize on bank statements (name, website, category, spellings)
//   /data/brand-model.json   the tiny model that matches a bank description to a brand
// Both are built by scripts/build-brands.py in the SubSnap repo and copied here. They must belong together:
// the model's brandCount has to equal the number of brands, and its brand numbers point into the list.
// The apps check the same things, and ignore a downloaded pair that doesn't pass.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './validate.mjs';

export const BRANDS = path.join(ROOT, 'brands.json');
export const MODEL = path.join(ROOT, 'brand-model.json');

const CATEGORIES = ['entertainment', 'music', 'productivity', 'fitness', 'news', 'cloud', 'other'];
const DOMAIN_RE = /^([a-z0-9-]+\.)+[a-z]{2,}$/;
const ALIAS_RE = /^[a-z0-9]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Returns a list of problems (empty = valid). */
export function validateBrands(brandsFile, model) {
  const errors = [];
  const err = (msg) => errors.push(msg);
  const { brands } = brandsFile ?? {};
  if (!Number.isInteger(brandsFile?.version) || brandsFile.version < 1) err('brands.json: version must be a whole number of at least 1');
  if (!DATE_RE.test(brandsFile?.updated ?? '')) err('brands.json: updated must be YYYY-MM-DD');
  if (!Array.isArray(brands) || brands.length < 1 || brands.length > 5000) {
    err('brands.json: brands must be a list of 1 to 5000 entries');
    return errors;
  }
  const names = new Set();
  brands.forEach((b, i) => {
    const where = `brands[${i}] (${b?.name})`;
    if (typeof b?.name !== 'string' || b.name.length < 1 || b.name.length > 80) err(`${where}: name must be 1 to 80 characters`);
    if (names.has(b?.name?.toLowerCase())) err(`${where}: duplicate name`);
    names.add(b?.name?.toLowerCase());
    if (!DOMAIN_RE.test(b?.domain ?? '')) err(`${where}: domain is not a website address`);
    if (!CATEGORIES.includes(b?.category)) err(`${where}: unknown category ${JSON.stringify(b?.category)}`);
    if (!Array.isArray(b?.aliases) || !b.aliases.every((a) => typeof a === 'string' && a.length <= 60 && ALIAS_RE.test(a))) {
      err(`${where}: aliases must be lowercase letters and digits only`);
    }
    if (typeof b?.exact !== 'boolean') err(`${where}: exact must be true or false`);
  });

  if (model?.version !== brandsFile.version) err('brand-model.json: version must match brands.json');
  if (model?.brandCount !== brands.length) err(`brand-model.json: brandCount ${model?.brandCount} does not match ${brands.length} brands`);
  if (!(model?.threshold >= 0.15 && model.threshold <= 0.9)) err('brand-model.json: threshold must be between 0.15 and 0.9');
  if (!(model?.margin >= 0 && model.margin <= 0.5)) err('brand-model.json: margin must be between 0 and 0.5');
  const features = model?.features;
  if (typeof features !== 'object' || features === null || Array.isArray(features)) {
    err('brand-model.json: features must be an object');
    return errors;
  }
  const entries = Object.entries(features);
  if (entries.length > 200000) err('brand-model.json: too many features');
  for (const [name, values] of entries) {
    if (!Array.isArray(values) || values.length < 1 || values.length % 2 !== 1 || !values.every(Number.isFinite)) {
      err(`brand-model.json: feature ${JSON.stringify(name)} must be [idf, brand, weight, ...]`);
      break;
    }
    for (let k = 1; k < values.length; k += 2) {
      if (!Number.isInteger(values[k]) || values[k] < 0 || values[k] >= brands.length) {
        err(`brand-model.json: feature ${JSON.stringify(name)} points at brand ${values[k]}, which doesn't exist`);
        return errors;
      }
    }
  }
  return errors;
}

/** The two files as text, or null when the website doesn't have them yet. Throws if they are not valid. */
export function readBrandFiles() {
  if (!existsSync(BRANDS) || !existsSync(MODEL)) return null;
  const rawBrands = readFileSync(BRANDS, 'utf8');
  const rawModel = readFileSync(MODEL, 'utf8');
  const errors = validateBrands(JSON.parse(rawBrands), JSON.parse(rawModel));
  if (errors.length > 0) throw new Error(`brands.json / brand-model.json are not valid:\n  - ${errors.slice(0, 10).join('\n  - ')}`);
  return { rawBrands, rawModel };
}
