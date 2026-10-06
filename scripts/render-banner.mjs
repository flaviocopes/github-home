// Renders scripts/banner.html to docs/banner.png at 2x, with transparent rounded corners.
// Run `npm run screenshots` first, since the banner shows docs/screenshot-dark.png.
// Usage: node scripts/render-banner.mjs
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = new URL('..', import.meta.url)
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 560 }, deviceScaleFactor: 2 })
await page.goto(new URL('scripts/banner.html', root).href)
await page.screenshot({ path: fileURLToPath(new URL('docs/banner.png', root)), omitBackground: true })
await browser.close()
console.log('Wrote docs/banner.png')
