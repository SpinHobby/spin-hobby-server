# Moving the API to api.spinhobby.com

The live API answers at `https://spin-hobby-server.onrender.com`. That address belongs to Render: every copy of the
website has it built in, so changing hosts would mean rebuilding the site at the same moment. `https://api.spinhobby.com`
is ours: it can point at Render today and somewhere else later, and it puts the API on the same site as the shop,
which a browser treats more kindly (it is what would let sign-in move to a cookie the page's scripts can't read).

**The old address keeps working.** Render answers on both, so nothing breaks while this is done step by step, and
anything that still calls the old one (webhooks, an old tab) carries on.

Staging stays on `spin-hobby-server-staging.onrender.com`: nobody types it and nothing outside the team depends on it.

## The order matters

Do these in order. The website change (step 5) must not be released before step 3 passes: the site would be built
pointing at an address that does not answer. Its build refuses to go live in that case, but don't rely on it.

1. **Render: add the domain.** Service `spin-hobby-api` → Settings → Custom Domains → add `api.spinhobby.com`.
   (`render.yaml` lists it too, for anyone who sets the service up again from the blueprint.)
2. **DNS: point it at Render.** spinhobby.com's DNS is managed at Netlify (Domain management → DNS records). Add:

   | Type | Name | Value |
   |---|---|---|
   | `CNAME` | `api` | `spin-hobby-server.onrender.com` |

   Back in Render, press **Verify**. Render issues the https certificate by itself; it takes a few minutes.
3. **Check it answers:**

   ```sh
   curl https://api.spinhobby.com/health/live     # {"success":true,"status":"live",…}
   ```

4. **Check the server still sees real visitor addresses.** Rate limits count per visitor, which depends on how many
   proxies sit in front of the server (`trustProxyHops` in `src/config/app.config.ts`: three on Render's own address).
   Open `https://api.spinhobby.com/health` in a browser, then look at the service's Logs in Render for that request's
   line: `GET /health 200 … ip=…`. The `ip` should be your own public address (search "what is my ip"), the same one
   the old address logs for you.
   - It is: nothing to do.
   - It is some other address (a Cloudflare or Render one): the chain is a different length on the new domain. Set
     `TRUST_PROXY_HOPS` on Render to the number that makes it yours (try 2, then 4), and note the number here.
5. **Release the website change** that makes `https://api.spinhobby.com` the default (spin-hobby repo). After it is
   live, open spinhobby.com, add something to the cart and open the checkout: the browser's Network tab should show
   requests going to `api.spinhobby.com`.
6. **Tell the server its own address.** On Render set `PUBLIC_API_URL=https://api.spinhobby.com`. The server uses it
   for links back to itself: the stop link in reminder emails, the photo addresses it gives eBay, and the server
   address shown when pairing Gleamshelf. All of these work on the old address too, so this step is tidiness, not a
   fix, and is safe to do last.

## What to leave alone

- **`ALLOWED_ORIGINS`**: lists the websites allowed to call the API (`https://spinhobby.com`, the admin). The API's
  own address is not one of them.
- **Square's webhook** (`SQUARE_WEBHOOK_URL`, and the address typed into Square's dashboard): Square signs each
  message with the address it called, so the two must match exactly. Leave both on the old address. To move them
  later, change both at the same moment.
- **PayPal's webhook and eBay's sign-in return address**: typed into their dashboards with the old address; they keep
  working. Move them only if the old address is ever going away.
- **Gleamshelf apps already paired**: they saved the old address and keep working.

## Going back

Release the website with `VITE_API_URL=https://spin-hobby-server.onrender.com` set in Netlify (Site configuration →
Environment variables), or revert the website change. Nothing on the server needs undoing.
