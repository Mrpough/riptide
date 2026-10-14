import { nativeImage, type NativeImage } from 'electron'
// Plain ESM helper (allowJs); see icon-render.mjs.
import { buildIco, encodePng, renderIcon } from './icon-render.mjs'

/** PNG bytes for the Riptide mark at a given square size. */
export function iconPngBuffer(size: number): Buffer {
  return encodePng(size, size, renderIcon(size, true))
}

/** A nativeImage for use as the application / window icon. */
export function appIcon(size = 256): NativeImage {
  return nativeImage.createFromBuffer(iconPngBuffer(size))
}

/** A crisp tray icon with 1x and 2x representations. */
export function trayIcon(): NativeImage {
  const image = nativeImage.createFromBuffer(iconPngBuffer(16))
  image.addRepresentation({ scaleFactor: 2, buffer: iconPngBuffer(32) })
  return image
}

/** A multi-resolution .ico for Windows packaging. */
export function icoBuffer(): Buffer {
  const sizes = [256, 128, 64, 48, 32, 16]
  return buildIco(sizes.map((size) => ({ size, png: iconPngBuffer(size) })))
}
