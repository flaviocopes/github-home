// Shared by the test and the screenshot script: loads the extension into Chromium,
// serves a fake github.com, and answers the GraphQL API from test/demo-data.json.
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const HOUR = 60 * 60 * 1000
export const DEMO_TOKEN = 'demo-token'

export async function launch(extensionPath, { colorScheme = 'light', viewport = { width: 1280, height: 900 }, deviceScaleFactor = 1 } = {}) {
  // Chrome ignores --load-extension since version 137, so the extension goes in through DevTools
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    colorScheme,
    viewport,
    deviceScaleFactor,
    args: ['--enable-unsafe-extension-debugging'],
    ignoreDefaultArgs: ['--disable-extensions'],
  })
  const cdp = await context.browser().newBrowserCDPSession()
  const workerStarted = context.waitForEvent('serviceworker')
  const { id } = await cdp.send('Extensions.loadUnpacked', { path: extensionPath })
  const worker = context.serviceWorkers().find((w) => w.url().includes(id)) ?? (await workerStarted)
  // Loading the same folder again is what Chrome's reload arrow does: an update, with a new worker
  const reload = async () => {
    const restarted = context.waitForEvent('serviceworker')
    await cdp.send('Extensions.loadUnpacked', { path: extensionPath })
    return restarted
  }
  return { context, worker, id, reload }
}

export async function loadDemoData() {
  const data = JSON.parse(await readFile(new URL('demo-data.json', import.meta.url), 'utf8'))
  // Shift every date so the demo looks the same whenever it runs
  const shift = Date.now() - Date.parse(data.capturedAt)
  const moved = (iso) => (iso ? new Date(Date.parse(iso) + shift).toISOString() : iso)
  const repos = data.repos.map((repo) => ({ ...repo, pushedAt: moved(repo.pushedAt), createdAt: moved(repo.createdAt) }))
  const visits = Object.fromEntries(
    Object.entries(data.visitsHoursAgo).map(([name, hours]) => [
      `${data.viewer.login}/${name}`,
      hours.map((h) => Date.now() - h * HOUR).sort((a, b) => a - b),
    ]),
  )
  return { ...data, repos, visits }
}

export async function serveDemoApi(context, data) {
  await context.route('https://api.github.com/graphql', (route) => {
    if (route.request().headers().authorization !== `Bearer ${DEMO_TOKEN}`) {
      return route.fulfill({ status: 401, json: { message: 'Bad credentials' } })
    }
    const { query, variables } = route.request().postDataJSON()
    if (query.includes('query Repos')) {
      return route.fulfill({
        json: { data: { viewer: { ...data.viewer, repositories: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: data.repos } } } },
      })
    }
    if (query.includes('query Activity')) {
      const result = {}
      for (const [key, name] of Object.entries(variables)) {
        const index = key.match(/^name(\d+)$/)?.[1]
        if (!index) continue
        result[`r${index}`] = {
          defaultBranchRef: { target: { history: { totalCount: data.commits[name] ?? 0 } } },
          stargazers: { edges: starEdges(data.starsThisWeek[name] ?? 0) },
        }
      }
      return route.fulfill({ json: { data: result } })
    }
    return route.fulfill({ status: 400, json: { errors: [{ message: 'Unknown query' }] } })
  })
}

// The stars from this week, newest first, then three older ones that must not count
const starEdges = (thisWeek) =>
  [
    ...Array.from({ length: thisWeek }, (_, i) => Date.now() - (i + 1) * 2 * HOUR),
    ...[10, 20, 40].map((days) => Date.now() - days * 24 * HOUR),
  ].map((time) => ({ starredAt: new Date(time).toISOString() }))

export async function serveFakeGitHub(context, { login = 'flaviocopes', loggedIn = true } = {}) {
  await context.route('https://github.com/**', (route) => {
    if (route.request().resourceType() !== 'document') return route.abort()
    const { pathname } = new URL(route.request().url())
    return route.fulfill({ contentType: 'text/html', body: fakePage({ login, loggedIn, pathname }) })
  })
}

function fakePage({ login, loggedIn, pathname }) {
  const home = pathname === '/'
  const title = home ? 'Dashboard' : pathname.split('/').filter(Boolean).slice(0, 2).join(' / ')
  const content = home
    ? `<aside class="sidebar"><h2>Top repositories</h2><p>GitHub's own sidebar</p></aside>
       <main><h2>Home</h2><div class="feed">GitHub's feed, which the extension hides</div></main>`
    : `<main><h2>${title}</h2><div class="feed">A repository page</div></main>`

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>GitHub</title>
  ${loggedIn ? `<meta name="user-login" content="${login}">` : ''}
  <style>
    :root {
      --bgColor-default: #ffffff; --bgColor-muted: #f6f8fa; --bgColor-inset: #f6f8fa;
      --fgColor-default: #1f2328; --fgColor-muted: #59636e; --fgColor-accent: #0969da;
      --borderColor-default: #d1d9e0; --borderColor-muted: #d1d9e0b3; --bgColor-accent-muted: #ddf4ff;
      --button-default-bgColor-rest: #f6f8fa; --button-primary-bgColor-rest: #1f883d;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bgColor-default: #0d1117; --bgColor-muted: #151b23; --bgColor-inset: #010409;
        --fgColor-default: #f0f6fc; --fgColor-muted: #9198a1; --fgColor-accent: #4493f8;
        --borderColor-default: #3d444d; --borderColor-muted: #3d444db3; --bgColor-accent-muted: #388bfd1a;
        --button-default-bgColor-rest: #212830; --button-primary-bgColor-rest: #238636;
      }
    }
    body { margin: 0; background: var(--bgColor-default); color: var(--fgColor-default);
      font: 14px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif; }
    .app-header { display: flex; align-items: center; gap: 12px; height: 64px; padding: 0 16px;
      background: var(--bgColor-inset); border-bottom: 1px solid var(--borderColor-default); }
    .app-header .icon-button { width: 32px; height: 32px; border: 1px solid var(--borderColor-default); border-radius: 6px;
      display: grid; place-items: center; color: var(--fgColor-muted); }
    .app-header .context { font-weight: 600; font-size: 14px; }
    .app-header .search { margin-left: auto; width: 320px; height: 32px; border: 1px solid var(--borderColor-default); border-radius: 6px;
      display: flex; align-items: center; gap: 8px; padding: 0 10px; color: var(--fgColor-muted); font-size: 13px; }
    .app-header kbd { padding: 0 5px; border: 1px solid var(--borderColor-default); border-radius: 4px; font: 11px ui-monospace, monospace; }
    .app-header .avatar { width: 32px; height: 32px; border-radius: 50%; background: linear-gradient(135deg, #6e7fd6, #3a4a9f); }
    .application-main { display: flex; gap: 24px; padding: 24px; }
    .sidebar { width: 280px; }
  </style>
</head>
<body class="${loggedIn ? 'logged-in' : 'logged-out'}">
  <header class="app-header">
    <span class="icon-button"><svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M1 2.75A.75.75 0 0 1 1.75 2h12.5a.75.75 0 0 1 0 1.5H1.75A.75.75 0 0 1 1 2.75Zm0 5A.75.75 0 0 1 1.75 7h12.5a.75.75 0 0 1 0 1.5H1.75A.75.75 0 0 1 1 7.75ZM1.75 12h12.5a.75.75 0 0 1 0 1.5H1.75a.75.75 0 0 1 0-1.5Z"/></svg></span>
    <svg width="32" height="32" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"/></svg>
    <span class="context">${title}</span>
    <span class="search"><svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M10.68 11.74a6 6 0 0 1-7.922-8.982 6 6 0 0 1 8.982 7.922l3.04 3.04a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215ZM11.5 7a4.499 4.499 0 1 0-8.997 0A4.499 4.499 0 0 0 11.5 7Z"/></svg>Type <kbd>/</kbd> to search</span>
    <span class="icon-button"><svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M7.75 2a.75.75 0 0 1 .75.75V7h4.25a.75.75 0 0 1 0 1.5H8.5v4.25a.75.75 0 0 1-1.5 0V8.5H2.75a.75.75 0 0 1 0-1.5H7V2.75A.75.75 0 0 1 7.75 2Z"/></svg></span>
    <span class="icon-button"><svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 16a2 2 0 0 0 1.985-1.75c.017-.137-.097-.25-.235-.25h-3.5c-.138 0-.252.113-.235.25A2 2 0 0 0 8 16ZM3 5a5 5 0 0 1 10 0v2.947c0 .05.015.098.042.139l1.703 2.555A1.519 1.519 0 0 1 13.482 13H2.518a1.516 1.516 0 0 1-1.263-2.36l1.703-2.554A.255.255 0 0 0 3 7.947Zm5-3.5A3.5 3.5 0 0 0 4.5 5v2.947c0 .346-.102.683-.294.97l-1.703 2.556a.017.017 0 0 0-.003.01l.001.006c0 .002.002.004.004.006l.006.004.007.001h10.964l.007-.001.006-.004.004-.006.001-.007a.017.017 0 0 0-.003-.01l-1.703-2.554a1.745 1.745 0 0 1-.294-.97V5A3.5 3.5 0 0 0 8 1.5Z"/></svg></span>
    <span class="avatar"></span>
  </header>
  <div class="application-main">${content}</div>
</body>
</html>`
}
