// A copy of packages/sdk/src/bundle.mjs from jim-kit/jimkit, so the registry judges a kit by the rules the app applies when it installs one.
// Copy that file over this one whenever the bundle format changes.
// The addon bundle: one JSON file that is everything Jimkit needs to install an addon without building it.
//
//   { "format": 1,
//     "manifest": { ...the "jimkit" field of the addon's package.json, plus name/version... },
//     "files": { "client.js": "…", "client.css": "…", "server.js": "…" } }
//
// `jimkit addons pack` writes it; an addon repository attaches it to a GitHub release as `jimkit-kit.json`; the host downloads it,
// checks it with validateBundle and keeps the files. This module is plain JavaScript so the host, the command line and the
// registry tooling all run exactly the same checks.

export const BUNDLE_FORMAT = 1;
export const ADDON_API_VERSION = 1;
/** The release asset an addon repository publishes. */
export const BUNDLE_ASSET = "jimkit-kit.json";
/** The only files a bundle may hold. Anything else is refused, so a bundle can't write outside its own folder. */
export const BUNDLE_FILES = ["client.js", "client.css", "server.js", "theme.css"];
export const MAX_FILE_BYTES = 4 * 1024 * 1024;
export const MAX_BUNDLE_BYTES = 6 * 1024 * 1024;

const ID = /^[a-z][a-z0-9-]{1,30}$/;
const TOOL_ID = /^[a-z][a-z0-9-]{0,40}$/;
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const APT = /^[a-z0-9][a-z0-9+.-]+$/;
const CATEGORIES = ["write", "convert", "edit", "inspect", "utilities"];
const THEME_ID = /^[a-z][a-z0-9-]{1,24}$/;
const LAYOUT_ID = /^[a-z][a-z0-9-]{0,24}$/;
/** theme ids a kit may not take: the one built into the host */
export const RESERVED_THEMES = ["basic"];

const isObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const isText = (v, max) => typeof v === "string" && v.trim().length > 0 && v.length <= max;
const isList = (v, max) => Array.isArray(v) && v.length <= max;

/** What is wrong with an addon's settings declaration, or null. Shared with scripts/gen-addons.mjs. */
export function settingsProblem(defs) {
  if (defs === undefined) return null;
  if (!Array.isArray(defs)) return "must be a list";
  const seen = new Set();
  for (const d of defs) {
    if (!d || typeof d.key !== "string" || !/^[A-Za-z][A-Za-z0-9_]*$/.test(d.key)) return `every setting needs a key (letters, digits, _): ${JSON.stringify(d?.key)}`;
    if (seen.has(d.key)) return `"${d.key}" is declared twice`;
    seen.add(d.key);
    if (typeof d.label !== "string" || !d.label) return `"${d.key}" needs a label`;
    if (!["boolean", "number", "text", "select"].includes(d.type)) return `"${d.key}" has type ${JSON.stringify(d.type)}; use boolean, number, text or select`;
    const kind = d.type === "text" || d.type === "select" ? "string" : d.type;
    if (typeof d.default !== kind) return `"${d.key}": the default must be a ${kind}`;
    if (d.type === "select") {
      const values = (d.options ?? []).map((o) => (typeof o === "string" ? o : o?.value));
      if (!values.length) return `"${d.key}" is a select and needs options`;
      if (!values.includes(d.default)) return `"${d.key}": the default isn't one of the options`;
    }
    if (d.type === "number" && d.min !== undefined && d.max !== undefined && d.min > d.max) return `"${d.key}": min is above max`;
  }
  return null;
}

/** What is wrong with a manifest that arrives from outside, or null. Stricter than for an addon built into the image: nobody has read this one. */
export function manifestProblem(m) {
  if (!isObject(m)) return "the manifest is missing";
  if (typeof m.id !== "string" || !ID.test(m.id)) return "id must be lowercase letters, digits and dashes (2 to 31 characters)";
  if (!isText(m.name, 60)) return "name is missing or too long";
  if (!isText(m.description, 300)) return "description is missing or too long";
  if (typeof m.version !== "string" || !VERSION.test(m.version)) return `version must look like 1.2.3 (got ${JSON.stringify(m.version)})`;
  if (m.apiVersion !== ADDON_API_VERSION) return `it targets addon API ${m.apiVersion}, this Jimkit speaks ${ADDON_API_VERSION}`;
  if (m.author !== undefined && !isText(m.author, 80)) return "author is too long";
  if (m.homepage !== undefined && !(typeof m.homepage === "string" && /^https?:\/\/\S{1,200}$/.test(m.homepage))) return "homepage must be an http(s) link";

  const categories = new Set(CATEGORIES);
  if (m.categories !== undefined) {
    if (!isList(m.categories, 3)) return "categories: at most 3";
    for (const c of m.categories) {
      if (!isObject(c) || !TOOL_ID.test(c.id ?? "") || !isText(c.name, 40) || !isText(c.blurb, 120) || !isText(c.icon, 40) || typeof c.hue !== "number" || c.hue < 0 || c.hue > 360) return "categories need an id, name, blurb, icon and a hue between 0 and 360";
      categories.add(c.id);
    }
  }
  if (m.themes !== undefined) {
    if (!isList(m.themes, 4) || m.themes.length === 0) return "themes: between 1 and 4";
    const seen = new Set();
    for (const t of m.themes) {
      if (!isObject(t) || !THEME_ID.test(t.id ?? "") || RESERVED_THEMES.includes(t.id)) return `a theme has a bad id (lowercase letters, digits and dashes; not "basic"): ${JSON.stringify(t?.id)}`;
      if (seen.has(t.id)) return `the theme id "${t.id}" is used twice`;
      seen.add(t.id);
      if (!isText(t.name, 30) || !isText(t.blurb, 80)) return `theme "${t.id}" needs a name and a short blurb`;
      if (t.layout !== undefined && !LAYOUT_ID.test(t.layout)) return `theme "${t.id}": layout is "grid" or the id of a layout this addon brings (lowercase letters, digits and dashes)`;
      if (t.flat !== undefined && typeof t.flat !== "boolean") return `theme "${t.id}": flat is true or false`;
      if (t.order !== undefined && (typeof t.order !== "number" || !Number.isFinite(t.order))) return `theme "${t.id}": order is a number`;
    }
  }
  if (!isList(m.tools, 20) || (m.tools.length === 0 && !m.themes)) return "tools: list between 1 and 20";
  const toolIds = new Set();
  for (const t of m.tools) {
    if (!isObject(t) || !TOOL_ID.test(t.id ?? "")) return `a tool has a bad id: ${JSON.stringify(t?.id)}`;
    if (toolIds.has(t.id)) return `the tool id "${t.id}" is used twice`;
    toolIds.add(t.id);
    if (!isText(t.name, 60) || !isText(t.blurb, 120) || !isText(t.icon, 40)) return `tool "${t.id}" needs a name, a short blurb and an icon`;
    if (typeof t.category !== "string" || !categories.has(t.category)) return `tool "${t.id}" is in the unknown category ${JSON.stringify(t.category)}`;
    if (t.status !== undefined && t.status !== "live" && t.status !== "soon") return `tool "${t.id}": status is live or soon`;
    if (t.keywords !== undefined && (!isList(t.keywords, 12) || t.keywords.some((k) => !isText(k, 30)))) return `tool "${t.id}": keywords are up to 12 short words`;
    if (t.aliases !== undefined) {
      if (!isObject(t.aliases) || Object.keys(t.aliases).length > 8 || Object.entries(t.aliases).some(([k, v]) => !TOOL_ID.test(k) || !isObject(v))) return `tool "${t.id}": aliases map up to 8 old ids to the init they start with`;
    }
    if (t.quick !== undefined) {
      if (!isList(t.quick, 6) || t.quick.some((q) => !isObject(q) || !isText(q.label, 40) || !isObject(q.init) || JSON.stringify(q.init).length > 500 || (q.keywords !== undefined && (!isList(q.keywords, 8) || q.keywords.some((k) => !isText(k, 30)))))) return `tool "${t.id}": quick is up to 6 { label, init } entries`;
    }
  }
  if (m.fileActions !== undefined) {
    if (!isList(m.fileActions, 30)) return "fileActions: at most 30";
    for (const a of m.fileActions) {
      if (!isObject(a) || !isText(a.id, 60) || !isText(a.label, 60) || !isText(a.icon, 40)) return "a file action needs an id, a label and an icon";
      if (!toolIds.has(a.tool)) return `file action "${a.id}" points at a tool this addon doesn't have: ${JSON.stringify(a.tool)}`;
      const accept = a.accept;
      if (!isObject(accept) || [accept.ext, accept.mime].some((l) => l !== undefined && (!isList(l, 60) || l.some((x) => !isText(x, 60))))) return `file action "${a.id}": accept needs lists of ext and/or mime`;
      if (a.priority !== undefined && typeof a.priority !== "number") return `file action "${a.id}": priority is a number`;
    }
  }
  if (m.system !== undefined) {
    const apt = m.system?.apt;
    if (!isObject(m.system) || (apt !== undefined && (!isList(apt, 40) || apt.some((p) => typeof p !== "string" || !APT.test(p))))) return "system.apt is a list of Debian package names";
  }
  const settings = settingsProblem(m.settings);
  if (settings) return `settings: ${settings}`;
  return null;
}

/**
 * Checks a parsed bundle. Returns { ok: true, bundle } with `manifest.client` and `manifest.server` set from the files that are
 * really there, or { ok: false, error } in words a person can act on.
 */
export function validateBundle(value) {
  if (!isObject(value)) return { ok: false, error: "That isn't an addon bundle." };
  if (value.format !== BUNDLE_FORMAT) return { ok: false, error: `This bundle is format ${JSON.stringify(value.format)}; this Jimkit reads format ${BUNDLE_FORMAT}.` };
  if (!isObject(value.files)) return { ok: false, error: "The bundle has no files." };
  let total = 0;
  for (const [name, text] of Object.entries(value.files)) {
    if (!BUNDLE_FILES.includes(name)) return { ok: false, error: `The bundle holds a file it may not: ${name}.` };
    if (typeof text !== "string") return { ok: false, error: `${name} isn't text.` };
    const bytes = text.length > MAX_FILE_BYTES ? text.length : new TextEncoder().encode(text).length;
    if (bytes > MAX_FILE_BYTES) return { ok: false, error: `${name} is too large (limit ${MAX_FILE_BYTES / 1024 / 1024} MB).` };
    total += bytes;
  }
  if (total > MAX_BUNDLE_BYTES) return { ok: false, error: `The bundle is too large (limit ${MAX_BUNDLE_BYTES / 1024 / 1024} MB).` };
  const problem = manifestProblem(value.manifest);
  if (problem) return { ok: false, error: `Its manifest is not valid: ${problem}.` };
  const files = value.files;
  const manifest = { ...value.manifest, client: typeof files["client.js"] === "string", server: typeof files["server.js"] === "string" };
  const sheet = files["theme.css"];
  if (sheet !== undefined) {
    if (!manifest.themes) return { ok: false, error: "The bundle has a theme.css but its manifest brings no themes." };
    const bad = themeCssProblem(sheet);
    if (bad) return { ok: false, error: `theme.css: ${bad}.` };
  } else if (manifest.themes && !manifest.client) return { ok: false, error: "The manifest brings themes but the bundle has no theme.css (and no client code with a layout)." };
  if (!manifest.client && !manifest.server && sheet === undefined) return { ok: false, error: "The bundle has neither a client nor a server part." };
  return { ok: true, bundle: { format: BUNDLE_FORMAT, manifest, files } };
}

/**
 * What a theme stylesheet may not do, or null. Plain CSS only: no @import (it would fetch from somewhere else) and no url() that is not
 * an inline data: URI or a fragment, so a theme can't load anything from outside the bundle.
 */
export function themeCssProblem(css) {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  if (/@import\b/i.test(text)) return "@import is not allowed";
  for (const m of text.matchAll(/url\(\s*(['"]?)([^'")]*)\1\s*\)/gi)) if (!/^(data:|#)/i.test(m[2].trim())) return "url() may only point at a data: URI";
  if (/<\/?style|<script/i.test(text)) return "that is not plain CSS";
  return null;
}

/** 1 if a is newer than b, -1 if older, 0 if equal. Prereleases sort before their release. */
export function compareVersions(a, b) {
  const split = (v) => {
    const [core, pre] = String(v).split("-", 2);
    return { n: core.split(".").map((x) => Number(x) || 0), pre };
  };
  const x = split(a), y = split(b);
  for (let i = 0; i < 3; i++) if ((x.n[i] ?? 0) !== (y.n[i] ?? 0)) return (x.n[i] ?? 0) > (y.n[i] ?? 0) ? 1 : -1;
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  return x.pre > y.pre ? 1 : -1;
}

const USER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO = /^[A-Za-z0-9._-]{1,100}$/;

/**
 * "user/name", "user/name@1.2.0" or a GitHub link (…/user/name, …/user/name.git, …/user/name/releases/tag/v1.2.0) -> { user, name, key,
 * version? }. `key` is the lowercase "user/name" the registry and the installed list use; GitHub names are case-insensitive.
 */
export function parseSource(input) {
  let s = String(input ?? "").trim();
  let version;
  const url = /^(?:https?:\/\/)?(?:www\.)?github\.com\/(.+)$/i.exec(s);
  if (url) {
    const parts = url[1].split(/[?#]/)[0].split("/").filter(Boolean);
    const tag = parts[2] === "releases" && parts[3] === "tag" ? parts[4] : parts[2] === "tree" ? parts[3] : undefined;
    s = `${parts[0] ?? ""}/${(parts[1] ?? "").replace(/\.git$/i, "")}`;
    if (tag) version = tag.replace(/^v(?=\d)/, "");
  } else {
    const at = s.indexOf("@");
    if (at > 0) { version = s.slice(at + 1).replace(/^v(?=\d)/, ""); s = s.slice(0, at); }
  }
  const [user, name, ...more] = s.split("/");
  if (more.length || !user || !name || !USER.test(user) || !REPO.test(name) || name === "." || name === "..") return null;
  if (version !== undefined && !VERSION.test(version)) return null;
  return { user, name, key: `${user}/${name}`.toLowerCase(), version };
}
