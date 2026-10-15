// Builds index.json: for every approved kit, its releases (with the hash of each bundle) and its reviews. This file is all Jimkit reads.
import { createHash } from "node:crypto";
import { BUNDLE_ASSET, compareVersions, validateBundle } from "./bundle.mjs";
import { api, download } from "./github.mjs";

const sha256 = (t) => createHash("sha256").update(t).digest("hex");

/** One kit's reviews from the database rows: newest first, never the author's own. */
export function reviewsFor(rows, repo, warn = () => {}) {
  const owner = repo.split("/")[0];
  const out = [];
  for (const r of rows.reviews ?? []) {
    if (r.repo !== repo) continue;
    if (String(r.reviewer).toLowerCase() === owner) { warn(`${repo}: the author's own review (${r.reviewer}), skipped`); continue; }
    if (!Number.isInteger(r.rating) || r.rating < 1 || r.rating > 5) { warn(`${repo}: a review by ${r.reviewer} has rating ${r.rating}, skipped`); continue; }
    out.push({ user: r.reviewer, rating: r.rating, text: String(r.body ?? "").trim().slice(0, 600), ...(r.version ? { version: r.version } : {}), date: r.created_at ?? "" });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date) || a.user.localeCompare(b.user));
}

export function rate(reviews) {
  if (!reviews.length) return null;
  const sum = reviews.reduce((n, r) => n + r.rating, 0);
  return { average: Math.round((sum / reviews.length) * 10) / 10, count: reviews.length };
}

/**
 * `rows` is what the database holds (see supabase.mjs). `previous` is the index as it was: a version already in it keeps the hash it was first seen with. If its release asset changes
 * afterwards the new file is ignored (and reported), so what people reviewed and what Jimkit verifies stay the same file; the author
 * publishes a new version instead.
 */
export async function buildIndex({ rows, fetchFn, token, previous = { kits: [] }, warn = () => {} }) {
  const kits = [];
  for (const row of [...(rows.kits ?? [])].sort((a, b) => a.repo.localeCompare(b.repo))) {
    const [user, name] = row.repo.split("/");
    const kit = { user, name, key: row.repo };
    const releases = await api(`/repos/${kit.user}/${kit.name}/releases?per_page=30`, { fetchFn, token });
    if (!releases) { warn(`${kit.key}: no such repository, left out`); continue; }
    const before = previous.kits.find((k) => k.repo === kit.key);
    const versions = [];
    let described = null;
    for (const rel of releases) {
      if (rel.draft || rel.prerelease) continue;
      const asset = (rel.assets ?? []).find((a) => a.name === BUNDLE_ASSET);
      if (!asset) continue;
      let text;
      try { text = await download(asset.browser_download_url, { fetchFn, token }); } catch (e) { warn(`${kit.key} ${rel.tag_name}: ${e.message}`); continue; }
      let json;
      try { json = JSON.parse(text); } catch { warn(`${kit.key} ${rel.tag_name}: not JSON`); continue; }
      const checked = validateBundle(json);
      if (!checked.ok) { warn(`${kit.key} ${rel.tag_name}: ${checked.error}`); continue; }
      const m = checked.bundle.manifest;
      if (versions.some((v) => v.version === m.version)) { warn(`${kit.key} ${rel.tag_name}: version ${m.version} appears twice`); continue; }
      const sha = sha256(text);
      const known = before?.versions.find((v) => v.version === m.version);
      if (known && known.sha256 !== sha) { warn(`${kit.key} ${m.version}: the release asset changed after it was listed; keeping the original hash. Publish a new version instead.`); versions.push(known); continue; }
      versions.push({ version: m.version, tag: rel.tag_name, sha256: sha, size: Buffer.byteLength(text), date: rel.published_at ?? "", server: !!checked.bundle.files["server.js"], ...(m.system?.apt?.length ? { apt: m.system.apt } : {}) });
      if (!described || compareVersions(m.version, described.version) > 0) described = m;
    }
    if (!versions.length) { warn(`${kit.key}: no release carries a valid ${BUNDLE_ASSET}, left out`); continue; }
    versions.sort((a, b) => compareVersions(b.version, a.version));
    const info = await api(`/repos/${kit.user}/${kit.name}`, { fetchFn, token });
    const reviews = reviewsFor(rows, kit.key, warn);
    const d = described ?? before;
    kits.push({
      repo: kit.key,
      name: d.name, description: d.description, ...(d.author ? { author: d.author } : {}), ...(d.homepage ? { homepage: d.homepage } : {}),
      tools: described ? described.tools.map((t) => ({ name: t.name, blurb: t.blurb, icon: t.icon })) : before.tools,
      ...((described?.themes ?? before?.themes)?.length ? { themes: (described?.themes ?? before?.themes).map((t) => ({ name: t.name, blurb: t.blurb ?? "" })) } : {}),
      latest: versions[0].version, versions,
      rating: rate(reviews), reviews: reviews.slice(0, 30),
      ...(typeof info?.stargazers_count === "number" ? { stars: info.stargazers_count } : {}),
    });
  }
  return { format: 1, kits };
}
