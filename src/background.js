const API_URL = 'https://api.github.com/graphql'
const STALE_AFTER = 5 * 60 * 1000
const ACTIVITY_DAYS = 90
const STAR_DAYS = 7
const MAX_PAGES = 20
const HISTORY_BATCH = 10

const REPOS_QUERY = `
  query Repos($cursor: String) {
    viewer {
      id
      login
      repositories(
        first: 100
        after: $cursor
        ownerAffiliations: [OWNER, ORGANIZATION_MEMBER, COLLABORATOR]
        orderBy: { field: PUSHED_AT, direction: DESC }
      ) {
        pageInfo { hasNextPage endCursor }
        nodes {
          nameWithOwner
          name
          owner { login }
          description
          isPrivate
          isFork
          isArchived
          pushedAt
          createdAt
          isInOrganization
        }
      }
    }
  }
`

// GitHub hides private repos from contributionsCollection, even for the owner,
// so commits are counted on each repo's default branch instead
function activityQuery(count) {
  const indexes = [...Array(count).keys()]
  return `
    query Activity($from: GitTimestamp!, $author: ID!, ${indexes.map((i) => `$owner${i}: String!, $name${i}: String!`).join(', ')}) {
      ${indexes.map((i) => `r${i}: repository(owner: $owner${i}, name: $name${i}) { ...Activity }`).join('\n')}
    }
    fragment Activity on Repository {
      defaultBranchRef {
        target {
          ... on Commit {
            history(since: $from, author: { id: $author }, first: 0) { totalCount }
          }
        }
      }
      stargazers(first: 100, orderBy: { field: STARRED_AT, direction: DESC }) {
        edges { starredAt }
      }
    }
  `
}

let inflight = null

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'refresh') {
    refresh(message.force).then(sendResponse)
    return true
  }
  if (message.type === 'openOptions') {
    chrome.runtime.openOptionsPage()
  }
})

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage())

function refresh(force = false) {
  inflight ??= runRefresh(force).finally(() => {
    inflight = null
  })
  return inflight
}

async function runRefresh(force) {
  const { token, cache } = await chrome.storage.local.get(['token', 'cache'])
  if (!token) return { ok: false, error: 'Add a GitHub token in the extension settings.' }
  if (!force && cache && Date.now() - cache.fetchedAt < STALE_AFTER) return { ok: true, cache }

  try {
    const next = await fetchRepos(token)
    await chrome.storage.local.set({ cache: next, error: null })
    return { ok: true, cache: next }
  } catch (error) {
    await chrome.storage.local.set({ error: error.message })
    return { ok: false, error: error.message }
  }
}

async function fetchRepos(token) {
  const since = Date.now() - ACTIVITY_DAYS * 24 * 60 * 60 * 1000
  const repos = []
  let viewer = null
  let cursor = null
  let activity = null

  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await graphql(token, REPOS_QUERY, { cursor })
    viewer = data.viewer
    const { pageInfo, nodes } = data.viewer.repositories
    repos.push(...nodes.filter(Boolean).map(toRepo))

    // Repos come sorted by last push, so once one is older than `since` we know every active repo
    const done = !pageInfo.hasNextPage
    if (!activity && (done || repos.at(-1).pushedAt < since)) {
      const active = repos.filter((repo) => repo.pushedAt >= since)
      activity = fetchActivity(token, active, viewer.id, since)
    }
    if (done) break
    cursor = pageInfo.endCursor
  }

  const { commits, stars } = (await activity) ?? { commits: {}, stars: {} }
  return { login: viewer.login, fetchedAt: Date.now(), repos, commits, stars }
}

// Commits by you in the last 90 days, and stars from anyone in the last 7 days
async function fetchActivity(token, active, authorId, since) {
  const batches = []
  for (let i = 0; i < active.length; i += HISTORY_BATCH) {
    batches.push(active.slice(i, i + HISTORY_BATCH))
  }

  const starsSince = Date.now() - STAR_DAYS * 24 * 60 * 60 * 1000
  const commits = {}
  const stars = {}
  await Promise.all(
    batches.map(async (batch) => {
      const variables = { from: new Date(since).toISOString(), author: authorId }
      batch.forEach((repo, i) => {
        variables[`owner${i}`] = repo.owner
        variables[`name${i}`] = repo.name
      })
      const data = await graphql(token, activityQuery(batch.length), variables)
      batch.forEach((repo, i) => {
        const node = data[`r${i}`]
        const key = repo.nwo.toLowerCase()
        const count = node?.defaultBranchRef?.target?.history?.totalCount
        if (count) commits[key] = count
        const recent = (node?.stargazers.edges ?? []).filter((edge) => Date.parse(edge.starredAt) >= starsSince).length
        if (recent) stars[key] = recent
      })
    }),
  )
  return { commits, stars }
}

async function graphql(token, query, variables) {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  })

  if (response.status === 401) {
    throw new Error('GitHub rejected the token. Check it in the extension settings.')
  }
  if (!response.ok) {
    throw new Error(`GitHub API error ${response.status}`)
  }

  const json = await response.json()
  // Repos behind org SAML come back as errors next to the rest of the data
  if (!json.data) {
    throw new Error(json.errors?.[0]?.message ?? 'GitHub returned no data')
  }
  return json.data
}

function toRepo(node) {
  return {
    nwo: node.nameWithOwner,
    owner: node.owner.login,
    name: node.name,
    description: node.description ?? '',
    private: node.isPrivate,
    fork: node.isFork,
    archived: node.isArchived,
    pushedAt: Date.parse(node.pushedAt) || 0,
    createdAt: Date.parse(node.createdAt) || 0,
    org: node.isInOrganization,
  }
}
