// Loads the extension into Chromium with a fake github.com and the demo API, then checks
// the home page, search, in-page navigation, visit tracking and the settings page.
// Usage: node test/test.mjs [extension folder, default: this repo]
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEMO_TOKEN, launch, loadDemoData, serveDemoApi, serveFakeGitHub } from './harness.mjs'

const extension = process.argv[2] ? resolve(process.argv[2]) : fileURLToPath(new URL('..', import.meta.url))
const data = await loadDemoData()
// The demo data only has public repos, so the test makes one private
data.repos = data.repos.map((repo) => (repo.name === 'things-cli' ? { ...repo, isPrivate: true } : repo))
const { context, worker, id, reload } = await launch(extension)
const storage = (keys) => worker.evaluate((keys) => chrome.storage.local.get(keys), keys)
const setStorage = (items) => worker.evaluate((items) => chrome.storage.local.set(items), items)
const names = (page, selector) => page.locator(`${selector} .gh-home-repo-name`).allTextContents()

try {
  await serveDemoApi(context, data)
  await serveFakeGitHub(context)
  await setStorage({ token: DEMO_TOKEN, visits: data.visits })

  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))

  await page.goto('https://github.com/')
  await page.waitForSelector('#github-home .gh-home-repo')
  assert.equal(await page.locator('main').isHidden(), true, 'the feed is hidden')
  assert.equal(await page.locator('.sidebar').isHidden(), true, 'the sidebar is hidden')
  assert.equal(await page.locator('.app-header').isVisible(), true, 'the GitHub header stays')
  assert.equal(await page.evaluate(() => document.activeElement.className), 'gh-home-filter', 'the search box has focus')

  assert.deepEqual(await page.locator('#github-home .gh-home-section-title').allTextContents(), ['Most used', 'Recently created', 'Getting traction'])
  const [mostUsed, recent, traction] = await Promise.all([1, 2, 3].map((n) => names(page, `.gh-home-columns .gh-home-section:nth-child(${n})`)))
  assert.deepEqual([mostUsed.length, recent.length, traction.length], [10, 10, 10], 'every list has the same number of repos')
  assert.ok(mostUsed.indexOf('architecture-dissector') < mostUsed.indexOf('fstack') || !mostUsed.includes('fstack'), 'recent work beats old commits')
  assert.ok(mostUsed.slice(0, 4).includes('releases-manager'), 'commits, pushes and visits put releases-manager near the top')
  assert.equal(recent[0], 'testvm', 'the newest repo comes first')
  assert.ok(!recent.includes('htmx'), 'forks are not in Recently created')
  assert.deepEqual(traction.slice(0, 3), ['work-tracebook', 'skill-cabinet', 'note-repo'], 'the most stars this week come first')
  assert.ok(!traction.includes('fstack'), 'repos without recent pushes are not checked for stars')

  const cliTools = page.locator('.gh-home-columns .gh-home-section:first-child .gh-home-repo-link', { hasText: /^cli-tools-cabinet/ })
  assert.match(await cliTools.textContent(), /^cli-tools-cabinet\d+h$/, 'a row is the name and the last push, nothing else')
  assert.match(await cliTools.getAttribute('title'), /^One catalog for every CLI tool/, 'the description shows on hover')
  const thingsCli = page.locator('.gh-home-columns .gh-home-section:first-child .gh-home-repo-link', { hasText: /^things-cli/ })
  assert.match(await thingsCli.textContent(), /^things-cliPrivate\d+[hd]$/, 'private repos say so')
  assert.equal(await page.locator('.gh-home-columns .gh-home-section:first-child .gh-home-badge').count(), 1, 'public repos have no label')
  const factorylog = page.locator('.gh-home-columns .gh-home-section:nth-child(3) .gh-home-repo-link', { hasText: /^work-tracebook/ })
  assert.equal(await factorylog.textContent(), 'work-tracebook+57 ★', 'only stars from the last 7 days count')

  const layout = () =>
    page.evaluate(() => {
      const tops = [...document.querySelectorAll('.gh-home-columns .gh-home-section')].map((section) => Math.round(section.getBoundingClientRect().top))
      const name = [...document.querySelectorAll('.gh-home-repo-name')].find((node) => node.textContent === 'footage-ferry')
      const original = name.textContent
      name.textContent = 'a-very-long-repository-name-for-the-layout-check'
      const cut = name.scrollWidth > name.clientWidth
      name.textContent = original
      return { columns: new Set(tops).size === 1 ? 3 : 1, cut }
    })
  await page.setViewportSize({ width: 640, height: 900 })
  assert.deepEqual(await layout(), { columns: 3, cut: true }, 'small windows keep three columns and cut long names')
  await page.setViewportSize({ width: 560, height: 900 })
  assert.equal((await layout()).columns, 1, 'tiny windows stack the lists')
  await page.setViewportSize({ width: 1280, height: 900 })

  const starIn = (list, name) =>
    page.locator(`${list} .gh-home-repo`, { has: page.locator('.gh-home-repo-name', { hasText: new RegExp(`^${name}$`) }) }).locator('.gh-home-star')
  const mostUsedNow = () => names(page, '.gh-home-columns .gh-home-section:nth-child(1)')
  await starIn('.gh-home-section:nth-child(2)', 'couch-snake').click()
  assert.equal((await mostUsedNow())[0], 'couch-snake', 'a starred repo goes to the top of Most used')
  assert.equal(page.url(), 'https://github.com/', 'starring does not open the repo')
  assert.equal(await starIn('.gh-home-section:nth-child(1)', 'couch-snake').getAttribute('aria-pressed'), 'true')
  await starIn('.gh-home-section:nth-child(3)', 'number-pantry').click()
  assert.deepEqual((await mostUsedNow()).slice(0, 2), ['number-pantry', 'couch-snake'], 'the newest star comes first')
  assert.equal((await mostUsedNow()).length, 10, 'starred repos take the place of others')
  await page.focus('.gh-home-filter')
  await page.keyboard.type('pixel')
  await starIn('.gh-home-results', 'react-pixel-art').click()
  assert.equal(await page.evaluate(() => document.activeElement.className), 'gh-home-filter', 'starring a result keeps the search focused')
  await page.keyboard.press('Escape')
  assert.deepEqual((await mostUsedNow()).slice(0, 3), ['react-pixel-art', 'number-pantry', 'couch-snake'])
  assert.deepEqual((await storage('starred')).starred, ['flaviocopes/react-pixel-art', 'flaviocopes/number-pantry', 'flaviocopes/couch-snake'])
  for (const name of ['react-pixel-art', 'number-pantry', 'couch-snake']) await starIn('.gh-home-section:nth-child(1)', name).click()
  assert.deepEqual((await storage('starred')).starred, [], 'unstarring removes them')
  assert.deepEqual(await mostUsedNow(), mostUsed, 'Most used is back to the ranking')
  await page.focus('.gh-home-filter')

  await page.keyboard.type('note')
  assert.deepEqual(await names(page, '.gh-home-results'), ['note-repo'])
  await page.keyboard.press('Escape')
  await page.keyboard.type('pixel')
  assert.deepEqual(await names(page, '.gh-home-results'), ['react-pixel-art'], 'the search covers repos that are in neither list')
  await page.keyboard.press('Escape')
  await page.keyboard.type('cli')
  const results = await names(page, '.gh-home-results')
  assert.equal(results[0], 'cli-tools-cabinet', 'a name match on the most used repo comes first')
  await page.keyboard.press('ArrowDown')
  const selected = await page.locator('.gh-home-results .is-selected .gh-home-repo-name').textContent()
  assert.equal(selected, results[1])
  await page.keyboard.press('Enter')
  await page.waitForURL(`https://github.com/flaviocopes/${results[1]}`)
  assert.equal(await page.locator('#github-home').count(), 0, 'nothing is injected on a repo page')
  const { visits } = await storage('visits')
  assert.equal(visits[`flaviocopes/${results[1]}`].length, 1, 'the visit is recorded')

  await page.goto('https://github.com/settings/profile')
  assert.equal((await storage('visits')).visits['settings/profile'], undefined, 'settings pages are not repos')

  // GitHub's in-page navigation changes the URL first and swaps the body later
  await page.goto('https://github.com/')
  await page.waitForSelector('#github-home .gh-home-repo')
  const state = () =>
    page.evaluate(() => ({
      attribute: document.documentElement.hasAttribute('data-github-home'),
      injected: Boolean(document.querySelector('#github-home')),
      mainVisible: Boolean(document.querySelector('main')?.checkVisibility()),
    }))
  const swapBody = (html) =>
    page.evaluate((html) => {
      const body = document.createElement('body')
      body.className = 'logged-in'
      body.innerHTML = html
      document.body.replaceWith(body)
    }, html)

  await page.evaluate(() => history.pushState({}, '', '/flaviocopes/chip-pops'))
  await page.waitForTimeout(100)
  assert.deepEqual(await state(), { attribute: true, injected: true, mainVisible: false }, 'the old page stays hidden until the swap')
  await swapBody('<div class="application-main"><main>Repo page</main></div>')
  await page.waitForTimeout(100)
  assert.deepEqual(await state(), { attribute: false, injected: false, mainVisible: true }, 'the repo page shows after the swap')
  await page.evaluate(() => history.pushState({}, '', '/'))
  await swapBody('<div class="application-main"><main>Feed</main></div>')
  await page.waitForTimeout(100)
  assert.deepEqual(await state(), { attribute: true, injected: true, mainVisible: false }, 'the list comes back on the home page')

  await setStorage({ token: 'wrong-token' })
  await worker.evaluate(() => chrome.storage.local.remove(['cache', 'error']))
  await page.reload()
  await page.waitForSelector('.gh-home-banner')
  assert.match(await page.locator('.gh-home-banner').textContent(), /GitHub rejected the token/)

  await worker.evaluate(() => chrome.storage.local.remove(['token', 'cache', 'error']))
  await page.reload()
  await page.waitForSelector('.gh-home-setup')

  const options = await context.newPage()
  await options.goto(`chrome-extension://${id}/src/options.html`)
  await options.fill('#token', DEMO_TOKEN)
  await options.click('button[type=submit]')
  await options.waitForSelector('#token-status.success')
  assert.equal(await options.textContent('#token-status'), `Connected as @flaviocopes. Found ${data.repos.length} repositories.`)
  await page.bringToFront()
  await page.waitForSelector('#github-home .gh-home-repo')

  await serveFakeGitHub(context, { loggedIn: false })
  await page.reload()
  await page.waitForTimeout(300)
  assert.equal(await page.locator('#github-home').count(), 0, 'logged-out visitors see the normal page')
  assert.equal(await page.locator('main').isVisible(), true)

  // An update must not keep showing a fresh cache that an older version wrote without stars
  await setStorage({ token: DEMO_TOKEN, cache: { login: 'flaviocopes', fetchedAt: Date.now(), repos: [], commits: {} } })
  const updated = await reload()
  let cache
  for (let attempt = 0; attempt < 50 && !cache?.stars; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 100))
    ;({ cache } = await updated.evaluate(() => chrome.storage.local.get('cache')))
  }
  assert.equal(cache?.stars?.['flaviocopes/work-tracebook'], 57, 'the updated extension fetches again right away')

  assert.deepEqual(errors, [], 'no page errors')
  console.log(`ok: home page, search, navigation, visits, settings and error states, with ${data.repos.length} demo repos`)
} finally {
  await context.close()
}
