#!/usr/bin/env node
// node scripts/build-index.mjs   rebuilds index.json from the approved kits and the reviews in the database, and the kits' GitHub releases.
// GITHUB_TOKEN raises GitHub's API rate limit; SUPABASE_URL and SUPABASE_KEY point at another database (the defaults are the project's own, publishable key).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildIndex } from "./lib/index.mjs";
import { fetchRows } from "./lib/supabase.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const file = join(root, "index.json");
const previous = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { kits: [] };
let warnings = 0;
const index = await buildIndex({ rows: await fetchRows(), token: process.env.GITHUB_TOKEN, previous, warn: (m) => { warnings++; console.warn(`warning: ${m}`); } });
const text = JSON.stringify(index, null, 2) + "\n";
if (existsSync(file) && readFileSync(file, "utf8") === text) console.log(`index.json is up to date (${index.kits.length} kits, ${warnings} warnings)`);
else { writeFileSync(file, text); console.log(`index.json written: ${index.kits.length} kits, ${warnings} warnings`); }
