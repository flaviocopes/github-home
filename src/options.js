const form = document.querySelector('#token-form')
const input = document.querySelector('#token')
const status = document.querySelector('#token-status')
const visitCount = document.querySelector('#visit-count')
const clearVisits = document.querySelector('#clear-visits')

init()

async function init() {
  const { token, cache, visits = {} } = await chrome.storage.local.get(['token', 'cache', 'visits'])
  input.value = token ?? ''
  if (cache) showStatus(connectedText(cache), 'success')
  showVisitCount(visits)
}

form.addEventListener('submit', async (event) => {
  event.preventDefault()
  const token = input.value.trim()
  await chrome.storage.local.remove(['cache', 'error'])

  if (!token) {
    await chrome.storage.local.remove('token')
    showStatus('Token removed.')
    return
  }

  await chrome.storage.local.set({ token })
  showStatus('Checking the token…')
  const result = await chrome.runtime.sendMessage({ type: 'refresh', force: true })
  if (result.ok) showStatus(connectedText(result.cache), 'success')
  else showStatus(result.error, 'error')
})

clearVisits.addEventListener('click', async () => {
  await chrome.storage.local.remove('visits')
  showVisitCount({})
})

function connectedText(cache) {
  return `Connected as @${cache.login}. Found ${cache.repos.length} repositories.`
}

function showStatus(text, type = '') {
  status.textContent = text
  status.className = `status ${type}`
}

function showVisitCount(visits) {
  const count = Object.keys(visits).length
  visitCount.textContent = count
    ? `Right now it remembers visits to ${count} ${count === 1 ? 'repository' : 'repositories'}.`
    : 'No visits recorded yet.'
}
