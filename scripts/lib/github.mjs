import { MAX_BUNDLE_BYTES } from "./bundle.mjs";

const API = "https://api.github.com";
const DOWNLOAD_HOSTS = new Set(["github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com"]);

const headers = (token, extra = {}) => ({ "user-agent": "jimkit-registry", accept: "application/vnd.github+json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...extra });

/** GET a GitHub API path as JSON. Returns null for a 404 (the repository or release is gone). */
export async function api(path, { fetchFn = fetch, token } = {}) {
  const res = await fetchFn(`${API}${path}`, { headers: headers(token) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub answered ${res.status} for ${path}`);
  return res.json();
}

/** Downloads a release asset as text: only from GitHub's own hosts, redirects followed by hand, stopping at the size limit. */
export async function download(url, { fetchFn = fetch, token } = {}) {
  let current = url;
  for (let hop = 0; hop < 6; hop++) {
    const u = new URL(current);
    if (u.protocol !== "https:" || !DOWNLOAD_HOSTS.has(u.hostname)) throw new Error(`won't download from ${u.hostname}`);
    // the token only goes to github.com, never to the storage host it redirects to
    const res = await fetchFn(current, { redirect: "manual", headers: headers(u.hostname === "github.com" ? token : undefined, { accept: "application/octet-stream" }) });
    const next = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && next) { current = new URL(next, current).href; continue; }
    if (!res.ok) throw new Error(`download answered ${res.status}`);
    const limit = MAX_BUNDLE_BYTES + 4096;
    if (Number(res.headers.get("content-length")) > limit) { void res.body?.cancel(); throw new Error("the file is too large to be a kit"); }
    const reader = res.body.getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { void reader.cancel(); throw new Error("the file is too large to be a kit"); }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
  }
  throw new Error("too many redirects");
}
