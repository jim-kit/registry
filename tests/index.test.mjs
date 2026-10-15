import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { buildIndex, rate } from "../scripts/lib/index.mjs";

const sha = (t) => createHash("sha256").update(t).digest("hex");
const bundle = (over = {}) => JSON.stringify({
  format: 1,
  manifest: { id: over.id ?? "word-count", name: "Word count", description: "Counts words.", version: over.version ?? "1.0.0", apiVersion: 1, author: "Ada",
    tools: [{ id: "wc", category: "utilities", name: "Word count", blurb: "Counts", icon: "PenLine" }] },
  files: { "client.js": `export default {${over.salt ?? ""}}`, ...(over.server ? { "server.js": "x" } : {}) },
});

/** GitHub, as far as the crawler asks: releases lists, repository info, and downloads behind a redirect. */
function github(repos) {
  const calls = [];
  const fetchFn = async (url) => {
    calls.push(url);
    const u = new URL(url);
    let m;
    if (u.hostname === "api.github.com" && (m = /^\/repos\/([^/]+\/[^/]+)\/releases$/.exec(u.pathname))) {
      const r = repos[m[1]];
      return r ? Response.json(r.releases.map((rel) => ({ tag_name: rel.tag, draft: !!rel.draft, prerelease: !!rel.prerelease, published_at: "2026-10-01T00:00:00Z",
        assets: rel.body === undefined ? [] : [{ name: "jimkit-kit.json", browser_download_url: `https://github.com/${m[1]}/releases/download/${rel.tag}/jimkit-kit.json` }] }))) : new Response("", { status: 404 });
    }
    if (u.hostname === "api.github.com" && (m = /^\/repos\/([^/]+\/[^/]+)$/.exec(u.pathname))) return repos[m[1]] ? Response.json({ stargazers_count: repos[m[1]].stars ?? 0 }) : new Response("", { status: 404 });
    if (u.hostname === "github.com" && (m = /^\/([^/]+\/[^/]+)\/releases\/download\/([^/]+)\//.exec(u.pathname))) {
      return new Response(null, { status: 302, headers: { location: `https://release-assets.githubusercontent.com/${m[1]}/${m[2]}` } });
    }
    if (u.hostname === "release-assets.githubusercontent.com") {
      const [user, name, tag] = u.pathname.slice(1).split("/");
      return new Response(repos[`${user}/${name}`].releases.find((r) => r.tag === tag).body);
    }
    return new Response("", { status: 404 });
  };
  return { fetchFn, calls };
}

/** What the database holds: approved kits, and reviews as the table stores them. */
const rows = (kits, reviews = []) => ({ kits: kits.map((repo) => ({ repo, submitted_by: repo.split("/")[0] })), reviews });
const review = (repo, reviewer, rating, extra = {}) => ({ repo, reviewer, rating, body: "", version: null, created_at: "2026-10-10T00:00:00Z", ...extra });

test("lists a kit with its versions, hashes and reviews", async () => {
  const data = rows(["ada/word-count"], [
    review("ada/word-count", "grace", 5, { body: "Great.", created_at: "2026-10-12T00:00:00Z" }),
    review("ada/word-count", "linus", 4, { version: "1.0.0" }),
    review("ada/word-count", "ada", 5), // the author's own: ignored
    review("ada/word-count", "mallory", 11), // out of range: ignored
    review("someone/else", "grace", 1), // another kit's
  ]);
  const v1 = bundle(), v2 = bundle({ version: "1.1.0", server: true });
  const { fetchFn } = github({ "ada/word-count": { stars: 7, releases: [{ tag: "v1.1.0", body: v2 }, { tag: "v1.0.0", body: v1 }] } });
  const warnings = [];
  const index = await buildIndex({ rows: data, fetchFn, warn: (m) => warnings.push(m) });
  assert.equal(index.format, 1);
  const k = index.kits[0];
  assert.deepEqual({ repo: k.repo, name: k.name, latest: k.latest, stars: k.stars, author: k.author }, { repo: "ada/word-count", name: "Word count", latest: "1.1.0", stars: 7, author: "Ada" });
  assert.deepEqual(k.versions.map((v) => [v.version, v.tag, v.sha256, v.server]), [["1.1.0", "v1.1.0", sha(v2), true], ["1.0.0", "v1.0.0", sha(v1), false]]);
  assert.deepEqual(k.rating, { average: 4.5, count: 2 });
  assert.deepEqual(k.reviews.map((r) => r.user), ["grace", "linus"]);
  assert.equal(k.reviews[0].text, "Great.");
  assert.equal(warnings.filter((w) => /own review|rating 11/.test(w)).length, 2);
});

test("a kit that brings looks lists them", async () => {
  const look = JSON.stringify({ format: 1, manifest: { id: "dusk", name: "Dusk", description: "A dim look.", version: "1.0.0", apiVersion: 1, tools: [], themes: [{ id: "dusk", name: "Dusk", blurb: "Dim purple-grey surfaces" }] }, files: { "theme.css": ':root[data-theme="dusk"] { --color-bg: #1b1a24; }' } });
  const index = await buildIndex({ rows: rows(["ada/dusk"]), fetchFn: github({ "ada/dusk": { releases: [{ tag: "v1.0.0", body: look }] } }).fetchFn });
  assert.deepEqual(index.kits[0].themes, [{ name: "Dusk", blurb: "Dim purple-grey surfaces" }]);
  assert.deepEqual(index.kits[0].tools, []);
});

test("leaves out drafts, prereleases, releases without a bundle, and bundles that don't validate", async () => {
  const good = bundle();
  const { fetchFn } = github({ "ada/word-count": { releases: [
    { tag: "v2.0.0", body: bundle({ version: "2.0.0" }), draft: true },
    { tag: "v1.9.0", body: bundle({ version: "1.9.0" }), prerelease: true },
    { tag: "v1.5.0" }, // no asset
    { tag: "v1.4.0", body: '{"format":1,"manifest":{},"files":{}}' },
    { tag: "v1.0.0", body: good },
  ] } });
  const warnings = [];
  const index = await buildIndex({ rows: rows(["ada/word-count"]), fetchFn, warn: (m) => warnings.push(m) });
  assert.deepEqual(index.kits[0].versions.map((v) => v.version), ["1.0.0"]);
  assert.ok(warnings.some((w) => /v1\.4\.0.*manifest/.test(w)));
});

test("a listed version keeps the hash it was first seen with", async () => {
  const original = bundle();
  const first = await buildIndex({ rows: rows(["ada/word-count"]), fetchFn: github({ "ada/word-count": { releases: [{ tag: "v1.0.0", body: original }] } }).fetchFn });
  const tampered = bundle({ salt: "evil: 1" });
  const warnings = [];
  const second = await buildIndex({ rows: rows(["ada/word-count"]), previous: first, fetchFn: github({ "ada/word-count": { releases: [{ tag: "v1.0.0", body: tampered }] } }).fetchFn, warn: (m) => warnings.push(m) });
  assert.equal(second.kits[0].versions[0].sha256, sha(original));
  assert.ok(warnings.some((w) => /changed after it was listed/.test(w)));
});

test("a kit whose repository is gone, or that has no usable release, is left out", async () => {
  const warnings = [];
  const index = await buildIndex({ rows: rows(["ada/gone", "ada/empty"]), fetchFn: github({ "ada/empty": { releases: [] } }).fetchFn, warn: (m) => warnings.push(m) });
  assert.deepEqual(index.kits, []);
  assert.equal(warnings.length, 2);
});

test("only downloads from GitHub, and never sends the token to storage", async () => {
  const seen = [];
  const fetchFn = async (url, init) => {
    const u = new URL(url);
    seen.push([u.hostname, init?.headers?.authorization]);
    if (u.hostname === "api.github.com" && u.pathname.endsWith("/releases")) return Response.json([{ tag_name: "v1.0.0", assets: [{ name: "jimkit-kit.json", browser_download_url: "https://github.com/ada/word-count/releases/download/v1.0.0/jimkit-kit.json" }] }]);
    if (u.hostname === "api.github.com") return Response.json({});
    if (u.hostname === "github.com") return new Response(null, { status: 302, headers: { location: "https://evil.example/kit.json" } });
    return new Response(bundle());
  };
  const warnings = [];
  const index = await buildIndex({ rows: rows(["ada/word-count"]), fetchFn, token: "t0ken", warn: (m) => warnings.push(m) });
  assert.deepEqual(index.kits, []);
  assert.ok(warnings.some((w) => /won't download from evil\.example/.test(w)));
  assert.ok(!seen.some(([host]) => host === "evil.example"));
});

test("the rating is the mean to one decimal", () => {
  assert.equal(rate([]), null);
  assert.deepEqual(rate([{ rating: 5 }, { rating: 4 }, { rating: 4 }]), { average: 4.3, count: 3 });
});
