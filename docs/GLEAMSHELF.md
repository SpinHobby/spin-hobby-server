# Gleamshelf imports

Gleamshelf is the photo studio app that cleans a product photo and writes a title, description, category and series for it, using models that run on the
shop's own computer. This is how its drafts reach the admin. Nothing it sends is a product until a person adds it.

## The flow

1. **Connect once.** An owner opens Admin, Imports, "Connect the app", and presses "Show a new code". The code is 8 digits, works once and expires after 10
   minutes. In the Gleamshelf folder: `npm run connect -- <the address shown> --code <the code>`. The app is given a token (kept only by its hash here) that
   can send drafts and read the category and series lists, nothing else. The owner can disconnect it at any time.
2. **Run photos.** `npm run batch -- <photos> --out <folder> --write-listing` (it uses this shop's categories and series for the listings once connected).
3. **Send them.** `npm run push -- <folder>` (`--dry-run` shows what would be sent). One draft per source photo: sending the same photo again replaces the
   draft while nobody has handled it.
4. **Review.** Admin, Imports. Each draft has the cleaned photo, title, description, category, series, whether the product was found online, and flags
   worth a look. A person types the **price and stock** (Gleamshelf never guesses them), then adds it or rejects it.

## What "add" does

`POST /admin/imports/:id/add` takes the same body as the quick add (`POST /admin/products/quick-add`) and calls it with the draft's photo, so a draft becomes
a product the same way a hand-typed one does: Square item, series, storefront details, and undone again if any step fails. The draft stays a draft when
the add fails. The form keeps the product off the website by default.

## Routes

| Route | Who | What |
| --- | --- | --- |
| `POST /gleamshelf/pair` | anyone (10 a minute per address, 20 wrong codes in 10 minutes in all) | trades a code for the app's token |
| `GET /gleamshelf/ping`, `GET /gleamshelf/config` | the app's token | still connected? the category and series lists |
| `POST /gleamshelf/imports` | the app's token | a draft (JSON in the `draft` field) with its photo (the `photo` file, up to 6 MB) |
| `GET /admin/imports?status=draft\|added\|rejected` | staff | the list, the counts and the category names |
| `GET /admin/imports/:id`, `POST …/:id/add`, `POST …/:id/reject` | staff | look, add, reject |
| `POST /admin/imports/pairing`, `GET /admin/imports/connections`, `DELETE …/connections/:id` | owner | connect and disconnect apps |

Tables: `import_pairings`, `import_tokens`, `product_imports` (migration `20261013120000_gleamshelf_imports.sql`). Photos of drafts are kept in the image
storage under `imports/` and removed when the draft is added or rejected.

## Not done yet

- A badge in the sidebar with the number of drafts waiting.
- Pushing straight from the Gleamshelf editor (today it is the `push` command).
- Other shops: the draft is shop-neutral; a connector for Shopify or WooCommerce is a second file next to `connectors/spinhobby.ts` in Gleamshelf.
