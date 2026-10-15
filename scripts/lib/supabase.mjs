// Reads what the index is built from: the approved kits and every review. Both are public by design, so the
// publishable key is enough and no secret is needed here.
export const DEFAULT_URL = "https://kjitkrkyuxyfygsdxvcp.supabase.co";
export const DEFAULT_KEY = "sb_publishable_O5uZOGAYPoRCmlGd6qctpQ_xwvqU95U";
const PAGE = 1000;

async function table(path, { url, key, fetchFn }) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const res = await fetchFn(`${url}/rest/v1/${path}`, { headers: { apikey: key, range: `${from}-${from + PAGE - 1}`, accept: "application/json" } });
    if (!res.ok) throw new Error(`the database answered ${res.status} for ${path.split("?")[0]}`);
    const page = await res.json();
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

/** { kits: [{ repo, submitted_by }], reviews: [{ repo, reviewer, rating, body, version, created_at }] } */
export async function fetchRows({ url = process.env.SUPABASE_URL || DEFAULT_URL, key = process.env.SUPABASE_KEY || DEFAULT_KEY, fetchFn = fetch } = {}) {
  const opts = { url: url.replace(/\/+$/, ""), key, fetchFn };
  return {
    kits: await table("kits?select=repo,submitted_by&status=eq.approved&order=repo", opts),
    reviews: await table("reviews?select=repo,reviewer,rating,body,version,created_at&order=created_at.desc", opts),
  };
}
