import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

const iconsDir = path.resolve(import.meta.dirname, '../icons')
const svg = await readFile(path.join(iconsDir, 'icon.svg'), 'utf8')

const browser = await chromium.launch()
const page = await browser.newPage()

for (const size of [16, 32, 48, 128]) {
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(`<style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`)
  await page.screenshot({ path: path.join(iconsDir, `icon${size}.png`), omitBackground: true })
}

await browser.close()
