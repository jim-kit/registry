# Jimkit registry

The list of [Jimkit](https://github.com/jim-kit/jimkit) kits and what people think of them. It holds links and reviews only, never code:
every kit lives in its author's own GitHub repository and is installed from that repository's releases.

Jimkit reads one file from here, [`index.json`](index.json). It is rebuilt every hour from a small database (Supabase) of approved kits and
reviews, and from each kit's GitHub releases. Nobody edits `index.json` or sends pull requests to list a kit.

## List a kit

1. Publish a release of your kit with `jimkit-kit.json` attached (see
   [Writing a kit](https://github.com/jim-kit/jimkit/blob/main/docs/kits.md#writing-and-publishing-a-kit)).
2. Open [jimkit.thejimmy.dev/kits/submit](https://jimkit.thejimmy.dev/kits/submit/), sign in with GitHub and enter `your-name/your-repo`.
   You can only submit repositories under your own GitHub name.
3. The kit is **pending** until a maintainer approves it. Every new kit is reviewed by hand, and you can see its status on the same page.
4. After that, new releases of the kit appear on their own: the index follows the kit's releases.

A kit is described entirely by its newest release (name, description, tools and looks come from its manifest). The first time the index sees
a version it records the file's SHA-256 and never changes it; if you edit a release afterwards Jimkit refuses to install it. Publish a new
version instead. You can withdraw a kit from the same page at any time.

## Review a kit

Open the kit's page on the website, sign in with GitHub and give it one to five stars, with a few words if you like. You can't review your own
kit, there is one review per person per kit, and you can change or delete yours later.

## How it fits together

| Part | What it does |
|---|---|
| The database (Supabase) | Tables for kits, reviews and admins, and the rules about who may do what, enforced by the database itself. Its setup is kept by the maintainers and is not part of this repository. |
| `scripts/build-index.mjs` | Reads the approved kits and the reviews, looks at each kit's GitHub releases, checks every bundle with the same rules the app uses on install (`scripts/lib/bundle.mjs` is a copy of that validator), and writes `index.json`. |
| `.github/workflows/index.yml` | Runs the tests and the script every hour and commits `index.json` when it changed. |

The key in the scripts is Supabase's *publishable* key, which is public by design: the database's rules decide what it may do. No secret is stored
in this repository.

## Maintainers

- **Approve or reject a kit:** open [jimkit.thejimmy.dev/kits/admin](https://jimkit.thejimmy.dev/kits/admin/) and sign in with GitHub. It lists
  what is waiting (with a link to the repository, its releases and whether a release carries `jimkit-kit.json`), and has Approve, Reject (with a
  short note the submitter sees) and Delete. Only GitHub names in the `admins` table can use it, and the database enforces that, not the page.
  You can also edit the `kits` table by hand in the Supabase dashboard.
- **Add an admin:** SQL editor: `insert into public.admins (login) values ('their-github-name') on conflict do nothing;` (lowercase).
- **Add a kit for someone** (for example an organisation's): the admin page has an "Add a kit" box; the kit is approved at once.
- **Remove a review:** the admin page lists the latest reviews with a Delete button.
- **Run it yourself:** `npm test`, then `node scripts/build-index.mjs` (`GITHUB_TOKEN` raises GitHub's rate limit).
- **Rebuild now:** Actions > Index > Run workflow. It also runs by itself within a minute of any change in the database, and every hour.

- **Another registry:** point Jimkit at it with `JIMKIT_REGISTRY` (`user/name` of a repository with an `index.json`, or an https address).

MIT licensed.
