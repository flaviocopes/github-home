const ROOT_ID = 'github-home'
const HOME_PATHS = new Set(['/', '/dashboard'])
const DAY = 24 * 60 * 60 * 1000
const VISIT_GAP = 30 * 60 * 1000
const MAX_VISITS_PER_REPO = 50
const FORGET_VISITS_AFTER = 180 * DAY
const LEAVE_TIMEOUT = 1500
const MOST_USED_COUNT = 10
const RECENT_COUNT = 8
const SEARCH_LIMIT = 30

const RESERVED_OWNERS = new Set([
  'about', 'account', 'apps', 'blog', 'codespaces', 'collections', 'contact', 'copilot',
  'customer-stories', 'dashboard', 'enterprise', 'events', 'explore', 'features', 'gist',
  'github-copilot', 'issues', 'join', 'login', 'logout', 'marketplace', 'new', 'notifications',
  'organizations', 'orgs', 'pricing', 'pulls', 'readme', 'search', 'security', 'sessions',
  'settings', 'signup', 'site', 'solutions', 'sponsors', 'stars', 'team', 'topics', 'trending',
  'users',
])

const relativeTime = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

let data = { loaded: false, cache: null, visits: {}, hasToken: false, error: null }
let ui = null
let lastPath = null
let leaveTimer = null
let scheduled = false

const observer = new MutationObserver(schedule)
observer.observe(document.documentElement, { childList: true, subtree: true })
for (const event of ['DOMContentLoaded', 'popstate', 'pageshow', 'turbo:load', 'turbo:render']) {
  window.addEventListener(event, schedule)
  document.addEventListener(event, schedule)
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && ['cache', 'token', 'error'].some((key) => key in changes)) load()
})

load()
sync()

function schedule() {
  if (scheduled) return
  scheduled = true
  requestAnimationFrame(() => {
    scheduled = false
    sync()
  })
}

function sync() {
  if (!chrome.runtime?.id) {
    observer.disconnect()
    return
  }

  if (location.pathname !== lastPath) {
    lastPath = location.pathname
    recordVisit(lastPath)
  }

  if (!HOME_PATHS.has(location.pathname)) {
    // Keep the old page hidden until GitHub swaps in the new one, or the feed flashes
    if (ui?.root.isConnected) leaveTimer ??= setTimeout(teardown, LEAVE_TIMEOUT)
    else teardown()
    return
  }

  clearTimeout(leaveTimer)
  leaveTimer = null
  document.documentElement.setAttribute('data-github-home', '')
  if (!document.body) return
  if (!isLoggedIn()) {
    teardown()
    return
  }

  const host = document.querySelector('.application-main') ?? document.querySelector('main')
  if (!host) return

  ui ??= buildUI()
  for (const stale of document.querySelectorAll(`#${ROOT_ID}`)) {
    if (stale !== ui.root) stale.remove()
  }
  if (ui.root.parentElement !== host) {
    host.setAttribute('data-github-home-host', '')
    host.prepend(ui.root)
    render()
    focusFilter()
    requestRefresh()
  }
}

function teardown() {
  clearTimeout(leaveTimer)
  leaveTimer = null
  document.documentElement.removeAttribute('data-github-home')
  ui?.root.remove()
}

function isLoggedIn() {
  return Boolean(
    document.querySelector('meta[name="user-login"]')?.content ||
      document.body.classList.contains('logged-in'),
  )
}

async function load() {
  if (!chrome.runtime?.id) return
  const stored = await chrome.storage.local.get(['cache', 'visits', 'token', 'error'])
  data = {
    loaded: true,
    cache: stored.cache ?? null,
    visits: stored.visits ?? {},
    hasToken: Boolean(stored.token),
    error: stored.error ?? null,
  }
  if (ui?.root.isConnected) render()
}

async function requestRefresh(force = false) {
  if (!chrome.runtime?.id) return
  ui.refreshing = true
  renderStatus()
  await chrome.runtime.sendMessage({ type: 'refresh', force })
  ui.refreshing = false
  renderStatus()
}

async function recordVisit(path) {
  const key = repoKey(path)
  if (!key || !chrome.runtime?.id) return

  const { visits = {} } = await chrome.storage.local.get('visits')
  const now = Date.now()
  const times = visits[key] ?? []
  if (now - (times.at(-1) ?? 0) < VISIT_GAP) return

  visits[key] = [...times, now].slice(-MAX_VISITS_PER_REPO)
  for (const [repo, list] of Object.entries(visits)) {
    if (now - list.at(-1) > FORGET_VISITS_AFTER) delete visits[repo]
  }
  await chrome.storage.local.set({ visits })
  data.visits = visits
}

function repoKey(path) {
  const [owner, name] = path.split('/').filter(Boolean)
  if (!owner || !name || RESERVED_OWNERS.has(owner.toLowerCase())) return null
  return `${owner}/${name}`.toLowerCase()
}

function buildUI() {
  const input = h('input', {
    type: 'text',
    class: 'gh-home-filter',
    placeholder: 'Find a repository…',
    'aria-label': 'Find a repository',
    autocomplete: 'off',
    spellcheck: 'false',
    oninput: () => {
      ui.selected = 0
      render()
    },
    onkeydown: onFilterKeydown,
  })
  const status = h('span', { class: 'gh-home-status' })
  const body = h('div', { class: 'gh-home-body' })

  const root = h(
    'div',
    { id: ROOT_ID, 'data-turbo-temporary': true },
    h(
      'div',
      { class: 'gh-home-header' },
      h('h1', { class: 'gh-home-title' }, 'Your repositories'),
      input,
      h('a', { class: 'gh-home-button gh-home-button-primary', href: '/new' }, 'New'),
    ),
    body,
    h(
      'div',
      { class: 'gh-home-footer' },
      status,
      h('button', { type: 'button', class: 'gh-home-link-button', onclick: () => requestRefresh(true) }, 'Refresh'),
      h('button', { type: 'button', class: 'gh-home-link-button', onclick: openOptions }, 'Settings'),
    ),
  )

  return { root, input, body, status, selected: 0, refreshing: false }
}

function focusFilter() {
  if (!document.activeElement || document.activeElement === document.body) {
    ui.input.focus({ preventScroll: true })
  }
}

function openOptions() {
  chrome.runtime.sendMessage({ type: 'openOptions' })
}

function renderStatus() {
  if (ui.refreshing) ui.status.textContent = 'Refreshing…'
  else if (data.cache) ui.status.textContent = `Updated ${timeAgo(data.cache.fetchedAt, Date.now())}`
  else ui.status.textContent = ''
}

function render() {
  renderStatus()
  if (!data.loaded) {
    ui.body.replaceChildren()
    return
  }
  if (!data.hasToken && !data.cache) {
    ui.body.replaceChildren(setupCard())
    return
  }

  const now = Date.now()
  const query = ui.input.value.trim().toLowerCase()
  let content
  if (!data.cache) content = messageBox(data.error ? 'Could not load your repositories.' : 'Loading your repositories…')
  else if (query) content = resultsView(query, now)
  else content = homeView(now)

  ui.body.replaceChildren(...[errorBanner(), content].filter(Boolean))
}

function homeView(now) {
  const { repos, login } = data.cache
  const scored = scoreRepos(now)
  const mostUsed = scored.filter((entry) => !entry.repo.archived && entry.score > 0.5).slice(0, MOST_USED_COUNT)
  const recent = repos
    .filter((repo) => !repo.fork && sameLogin(repo.owner, login))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, RECENT_COUNT)

  return h(
    'div',
    { class: 'gh-home-columns' },
    section(
      'Most used',
      'Your commits, visits and pushes lately',
      mostUsed.map(({ repo, commits, visits }) =>
        repoRow(repo, [
          commits ? plural(commits, 'commit') : null,
          visits ? plural(visits, 'visit') : null,
          repo.pushedAt ? `pushed ${timeAgo(repo.pushedAt, now)}` : null,
        ]),
      ),
      'Nothing yet. Push some code or open a few repos.',
    ),
    section(
      'Recently created',
      null,
      recent.map((repo) => repoRow(repo, [`created ${timeAgo(repo.createdAt, now)}`])),
      'No repositories yet.',
    ),
  )
}

function resultsView(query, now) {
  const terms = query.split(/\s+/)
  const score = new Map(scoreRepos(now).map((entry) => [entry.repo.nwo, entry.score]))
  const results = data.cache.repos
    .filter((repo) => {
      const text = `${repo.nwo} ${repo.description}`.toLowerCase()
      return terms.every((term) => text.includes(term))
    })
    .map((repo) => ({ repo, match: nameMatch(repo.name.toLowerCase(), query) }))
    .sort((a, b) => b.match - a.match || score.get(b.repo.nwo) - score.get(a.repo.nwo))
    .slice(0, SEARCH_LIMIT)

  ui.selected = Math.min(ui.selected, Math.max(results.length - 1, 0))

  const rows = results.map(({ repo }, index) => {
    const row = repoRow(repo, [repo.pushedAt ? `updated ${timeAgo(repo.pushedAt, now)}` : null])
    if (index === ui.selected) row.querySelector('a').classList.add('is-selected')
    return row
  })

  const view = section('Results', String(results.length), rows, `No repositories match “${query}”.`)
  view.classList.add('gh-home-results')
  return view
}

function nameMatch(name, query) {
  if (name === query) return 3
  if (name.startsWith(query)) return 2
  if (name.includes(query)) return 1
  return 0
}

// Commits in the last 90 days, visits from this browser and push recency, each fading over time
function scoreRepos(now) {
  const { repos, commits } = data.cache
  return repos
    .map((repo) => {
      const key = repo.nwo.toLowerCase()
      const commitCount = commits[key] ?? 0
      const times = data.visits[key] ?? []
      const visitScore = times.reduce((sum, time) => sum + 0.5 ** ((now - time) / (14 * DAY)), 0)
      const pushScore = repo.pushedAt ? 6 * 0.5 ** ((now - repo.pushedAt) / (7 * DAY)) : 0
      return {
        repo,
        commits: commitCount,
        visits: times.filter((time) => now - time < 30 * DAY).length,
        score: 1.5 * Math.log2(1 + commitCount) + visitScore + pushScore,
      }
    })
    .sort((a, b) => b.score - a.score)
}

function onFilterKeydown(event) {
  if (event.key === 'Escape') {
    ui.input.value = ''
    ui.selected = 0
    render()
    return
  }

  const links = [...ui.body.querySelectorAll('.gh-home-results .gh-home-repo-link')]
  if (!links.length) return

  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    const step = event.key === 'ArrowDown' ? 1 : -1
    ui.selected = (ui.selected + step + links.length) % links.length
    links.forEach((link, index) => link.classList.toggle('is-selected', index === ui.selected))
    links[ui.selected].scrollIntoView({ block: 'nearest' })
  }

  if (event.key === 'Enter') {
    event.preventDefault()
    const link = links[ui.selected] ?? links[0]
    if (event.metaKey || event.ctrlKey) window.open(link.href, '_blank')
    else link.click()
  }
}

function section(title, note, rows, emptyText) {
  return h(
    'section',
    { class: 'gh-home-section' },
    h(
      'div',
      { class: 'gh-home-section-header' },
      h('h2', { class: 'gh-home-section-title' }, title),
      note ? h('span', { class: 'gh-home-section-note' }, note) : null,
    ),
    rows.length
      ? h('ul', { class: 'gh-home-list' }, rows)
      : h('p', { class: 'gh-home-empty' }, emptyText),
  )
}

function repoRow(repo, meta) {
  const ownRepo = sameLogin(repo.owner, data.cache.login)
  return h(
    'li',
    { class: 'gh-home-repo' },
    h(
      'a',
      { class: 'gh-home-repo-link', href: `/${repo.nwo}` },
      h(
        'span',
        { class: 'gh-home-repo-title' },
        ownRepo ? null : h('span', { class: 'gh-home-repo-owner' }, `${repo.owner} / `),
        h('span', { class: 'gh-home-repo-name' }, repo.name),
        repo.private ? h('span', { class: 'gh-home-badge' }, 'Private') : null,
        repo.fork ? h('span', { class: 'gh-home-badge' }, 'Fork') : null,
        repo.archived ? h('span', { class: 'gh-home-badge gh-home-badge-attention' }, 'Archived') : null,
      ),
      repo.description ? h('span', { class: 'gh-home-repo-description' }, repo.description) : null,
      h(
        'span',
        { class: 'gh-home-repo-meta' },
        repo.language
          ? h(
              'span',
              { class: 'gh-home-language' },
              h('span', { class: 'gh-home-language-dot', style: { backgroundColor: repo.color ?? '' } }),
              repo.language,
            )
          : null,
        meta.filter(Boolean).map((text) => h('span', {}, text)),
      ),
    ),
  )
}

function setupCard() {
  return h(
    'div',
    { class: 'gh-home-box gh-home-setup' },
    h('h2', { class: 'gh-home-section-title' }, 'Connect your GitHub account'),
    h('p', {}, 'Add a GitHub token in the extension settings, and this page will list your repositories.'),
    h('button', { type: 'button', class: 'gh-home-button gh-home-button-primary', onclick: openOptions }, 'Open settings'),
  )
}

function messageBox(text) {
  return h('div', { class: 'gh-home-box' }, h('p', {}, text))
}

function errorBanner() {
  if (!data.error) return null
  return h(
    'div',
    { class: 'gh-home-banner' },
    h('span', {}, data.error),
    h('button', { type: 'button', class: 'gh-home-link-button', onclick: openOptions }, 'Settings'),
  )
}

function sameLogin(a, b) {
  return a.toLowerCase() === b.toLowerCase()
}

function plural(count, word) {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

function timeAgo(time, now) {
  const seconds = Math.round((time - now) / 1000)
  const units = [
    ['year', 365 * 86400],
    ['month', 30 * 86400],
    ['week', 7 * 86400],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ]
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return relativeTime.format(Math.round(seconds / size), unit)
  }
  return 'just now'
}

function h(tag, props = {}, ...children) {
  const node = document.createElement(tag)
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue
    if (key === 'class') node.className = value
    else if (key === 'style') Object.assign(node.style, value)
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value)
    else node.setAttribute(key, value === true ? '' : value)
  }
  node.append(...children.flat(Infinity).filter((child) => child != null && child !== false))
  return node
}
