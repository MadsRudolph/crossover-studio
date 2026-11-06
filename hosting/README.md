# Web version

Live: https://crossover.madsrudolph.dev/

The browser build of the app, served by the Cloudflare Worker `crossover-studio` (Workers Static
Assets, custom domain). It runs the whole interface with the bundled System D profile. Opening other
measurement files and saving profiles need the desktop app, because those go through the Rust backend.
The site is public but asks search engines not to index it.

Deploy from this folder (manual; a git push does not update the site):

```sh
npm ci
npx wrangler login   # once per PC
npm run check        # builds the app and does a dry run
npm run deploy
```
