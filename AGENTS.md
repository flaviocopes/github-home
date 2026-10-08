# Repo Foyer

A Chrome extension that replaces the github.com home page with three short lists of your repositories (most used, recently created, getting traction) and a search box. It's plain JavaScript with no build step.

## Files

- `manifest.json`: Manifest V3. Permissions: `storage`, plus host access to `api.github.com`. The content script runs on `github.com/*` at `document_start`.
- `src/background.js`: the service worker. It fetches every repo you own, belong to through an organization or collaborate on with the GraphQL API, sorted by last push. Then, for each repo pushed in the last 90 days, it counts your commits on the default branch in that window and the stars from the last 7 days, in parallel batches of 10. It caches the result in `chrome.storage.local` and refreshes it when it's older than 5 minutes.
- `src/content.js`: on `/` and `/dashboard` it hides GitHub's content, injects the list into `.application-main` and renders it from the cache. On every page it records visits to `owner/repo` paths. A `MutationObserver` keeps it working across GitHub's in-page navigation.
- `src/content.css`: the hiding rules and the list's styles, built on GitHub's own CSS variables so light and dark themes follow the site.
- `src/options.html`, `src/options.js`, `src/options.css`: the settings page, for the token and the visit history.
- `icons/`: `icon.svg` is the source, and the PNGs are rendered from it.
- `test/harness.mjs`: loads the extension into Playwright's Chromium, serves a fake github.com and answers the GraphQL API from `test/demo-data.json`.
- `test/test.mjs`: the test.
- `scripts/screenshots.mjs`: the README screenshots, from the demo data. `--live` uses your own repos and writes to `preview/`.
- `scripts/banner.html` and `scripts/render-banner.mjs`: the README banner, rendered to `docs/banner.png`.
- `scripts/build-release.sh`: zips the extension into `dist/Repo-Foyer-<version>.zip`.

## Build and run

```sh
npm install                          # Playwright, for the test and the images
npx playwright install chromium      # the browser they run in
npm test                             # home page, search, navigation, visits, settings and errors
node test/test.mjs <folder>          # the same test on another copy, like an unzipped release
npm run screenshots                  # docs/screenshot-light.png and docs/screenshot-dark.png
npm run preview                      # the same with your own repos, in preview/ (needs the gh CLI)
npm run banner                       # docs/banner.png at 2x, from the dark screenshot
npm run icons                        # icons/*.png from icons/icon.svg
scripts/build-release.sh             # dist/Repo-Foyer-<version>.zip and its SHA-256
```

To try a change in your own Chrome, open `chrome://extensions`, turn on Developer mode, click **Load unpacked** and pick this folder. After editing, click the reload arrow on the Repo Foyer card and reload the GitHub tab.

## Rules

- Run `npm test` after every change, and add a check to `test/test.mjs` for any new behavior.
- Never open the real github.com logged in to test, and never put a real token in the repo. The test and the screenshots use the fake page and the demo data.
- Count commits from each repo's history. GitHub leaves private repos out of `contributionsCollection`, even for the account owner, so the contribution data misses most private work.
- Build the page with the `h()` helper in `content.js`. Repo descriptions come from GitHub, so never put them in `innerHTML`.
- Keep the old page hidden until GitHub swaps in the new one when leaving the home page (the `LEAVE_TIMEOUT` logic in `sync()`), or the feed flashes for a moment.
- Don't add permissions the extension doesn't need.
- The version in `manifest.json` and `package.json` must equal the release tag without the `v`. Releases attach the zip from `scripts/build-release.sh`, built from the tagged commit.
- The showreel video lives on flaviocopes.com, not in this repo. A local copy at `/repo-foyer-showreel.mp4` is ignored by git.
