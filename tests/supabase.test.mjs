import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchRows } from "../scripts/lib/supabase.mjs";

test("reads approved kits and reviews with the publishable key, page by page", async () => {
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push({ url, headers: init.headers });
    const u = new URL(url);
    if (u.pathname.endsWith("/kits")) return Response.json([{ repo: "ada/word-count", submitted_by: "ada" }]);
    const from = Number(init.headers.range.split("-")[0]);
    return Response.json(from === 0 ? Array.from({ length: 1000 }, (_, i) => ({ repo: "ada/word-count", reviewer: `u${i}`, rating: 5 })) : [{ repo: "ada/word-count", reviewer: "last", rating: 4 }]);
  };
  const rows = await fetchRows({ url: "https://x.supabase.co/", key: "sb_publishable_test", fetchFn });
  assert.equal(rows.kits.length, 1);
  assert.equal(rows.reviews.length, 1001);
  assert.ok(calls.every((c) => c.headers.apikey === "sb_publishable_test" && !c.headers.authorization), "only the apikey header is sent");
  assert.ok(calls[0].url.startsWith("https://x.supabase.co/rest/v1/kits?") && calls[0].url.includes("status=eq.approved"));
});

test("fails loudly when the database can't be read, so the old index stays", async () => {
  await assert.rejects(fetchRows({ url: "https://x.supabase.co", key: "k", fetchFn: async () => new Response("", { status: 503 }) }), /503/);
});
