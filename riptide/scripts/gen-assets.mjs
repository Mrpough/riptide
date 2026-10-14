/**
 * Generates the static icon assets that electron-builder needs for packaging
 * (Windows .ico, macOS/Linux .png). Safe to run repeatedly; output is
 * deterministic. Run with `npm run gen:assets`.
 *
 * The same renderer powers the runtime tray/window icons, so there is exactly
 * one definition of the mark.
 */
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildIco, encodePng, renderIcon } from '../src/main/icon-render.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const resources = join(root, 'resources')

const png = (size) => encodePng(size, size, renderIcon(size, true))

await fs.mkdir(resources, { recursive: true })

await fs.writeFile(join(resources, 'icon.png'), png(512))
await fs.writeFile(join(resources, 'tray.png'), png(32))
await fs.writeFile(
  join(resources, 'icon.ico'),
  buildIco([256, 128, 64, 48, 32, 16].map((size) => ({ size, png: png(size) })))
)

console.log('Generated resources/icon.png, resources/icon.ico and resources/tray.png')
