// Renders the home page with the demo data into docs/screenshot-light.png and docs/screenshot-dark.png.
// With --live it uses your own repos instead (the token from `gh auth token`) and writes to preview/.
// Usage: node scripts/screenshots.mjs [--live]
import { execSync } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { DEMO_TOKEN, launch, loadDemoData, serveDemoApi, serveFakeGitHub } from '../test/harness.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const live = process.argv.includes('--live')
const outDir = new URL(live ? '../preview/' : '../docs/', import.meta.url)
await mkdir(outDir, { recursive: true })

const data = await loadDemoData()
const token = live ? execSync('gh auth token').toString().trim() : DEMO_TOKEN
const login = live ? execSync('gh api user --jq .login').toString().trim() : data.viewer.login

for (const colorScheme of ['light', 'dark']) {
  const { context, worker } = await launch(root, { colorScheme, viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 })
  try {
    if (!live) await serveDemoApi(context, data)
    await serveFakeGitHub(context, { login })
    await worker.evaluate((items) => chrome.storage.local.set(items), { token, visits: live ? {} : data.visits })

    const page = await context.newPage()
    await page.goto('https://github.com/')
    await page.waitForSelector('#github-home .gh-home-repo', { timeout: 30000 })
    await page.evaluate(() => document.activeElement.blur())
    const path = fileURLToPath(new URL(`screenshot-${colorScheme}.png`, outDir))
    await page.screenshot({ path })
    console.log(`Wrote ${path}`)
  } finally {
    await context.close()
  }
}
