// src/lib/logoColor.ts
//
// Approximates a company's brand color by sampling its logo image, for use
// as a Portfolio grid tile's background.
//
// Reading a canvas's pixels requires the image to have loaded with CORS
// headers permitting it — otherwise the canvas is "tainted" and
// getImageData throws. Logo hosts (Finnhub's included) are built for plain
// <img> display, not canvas access, and typically don't send
// Access-Control-Allow-Origin at all — so sampling the URL directly fails
// silently on effectively every real logo. images.weserv.nl re-serves any
// image URL with a permissive CORS header attached (and, per the
// `output=png` param below, without its own lossy recompression); it's
// used here only for the offscreen sampling image — the logo <img> shown
// on the card still points straight at the original URL, unaffected by any
// of this.
//
// Picking "the" color out of a real logo is the other half of the problem.
// Many marks are multi-color (Google's four-color G, a wordmark plus an
// accent glyph) or mostly black/white with one accent color, so a plain
// average of every non-gray pixel blends hues that never actually appear
// together into a muddy composite — averaging Google's blue/red/yellow/green
// in RGB space lands on a khaki-olive that resembles none of them. Instead
// this buckets qualifying pixels by hue and returns the average color of
// the single most-represented bucket: a color that's actually present in
// the logo, not an invented blend of everything in it.

const colorCache = new Map<string, string | null>()
const pending = new Map<string, Promise<string | null>>()

const SAMPLE_SIZE = 32
const MIN_ALPHA = 200 // skip transparent/antialiased-edge pixels
const MIN_SATURATION = 0.15 // skip near-gray/white/black pixels (outlines, wordmark text)
const MIN_QUALIFYING_PIXELS = 6 // too few colored pixels to trust (monochrome mark, decode glitch, etc.)
const HUE_BUCKETS = 24 // 15° each

function rgbToHsl(r: number, g: number, b: number) {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  let h = 0
  let s = 0
  const l = (max + min) / 2
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break
      case g: h = (b - r) / d + 2; break
      default: h = (r - g) / d + 4
    }
    h /= 6
  }
  return { h, s, l }
}

function hue2rgb(p: number, q: number, t: number) {
  if (t < 0) t += 1
  if (t > 1) t -= 1
  if (t < 1 / 6) return p + (q - p) * 6 * t
  if (t < 1 / 2) return q
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
  return p
}

function hslToRgbString(h: number, s: number, l: number) {
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const r = hue2rgb(p, q, h + 1 / 3)
  const g = hue2rgb(p, q, h)
  const b = hue2rgb(p, q, h - 1 / 3)
  return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`
}

function toSamplingUrl(url: string): string {
  // data:/blob: URIs are already same-origin as far as canvas is concerned
  // (nothing to proxy); only http(s) logo URLs need the CORS workaround.
  if (!/^https?:\/\//.test(url)) return url
  const withoutScheme = url.replace(/^https?:\/\//, '')
  // output=png: avoid weserv's own JPEG recompression, which introduces
  // chroma-subsampling fringes around sharp edges (exactly what a flat-color
  // logo on a contrasting background is made of) that can shift a bucket's
  // hue away from the real mark color.
  return `https://images.weserv.nl/?url=${encodeURIComponent(withoutScheme)}&output=png`
}

function sampleDominantColor(img: HTMLImageElement): string | null {
  const canvas = document.createElement('canvas')
  canvas.width = SAMPLE_SIZE
  canvas.height = SAMPLE_SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  // Nearest-neighbor rather than smoothed: a smoothed downscale blends
  // adjacent source pixels together, so a pixel straddling (say) a
  // black-to-orange edge comes out as a third, muddier color that belongs
  // to neither the background nor the mark. Sampling picks one or the
  // other instead, keeping every counted pixel a color that's really there.
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(img, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE)
  // Throws (SecurityError) if the image was served without CORS headers,
  // "tainting" the canvas — caught by the caller.
  const { data } = ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE)

  const bucketR = new Float64Array(HUE_BUCKETS)
  const bucketG = new Float64Array(HUE_BUCKETS)
  const bucketB = new Float64Array(HUE_BUCKETS)
  const bucketCount = new Int32Array(HUE_BUCKETS)
  let totalQualifying = 0

  for (let i = 0; i < data.length; i += 4) {
    const [pr, pg, pb, pa] = [data[i], data[i + 1], data[i + 2], data[i + 3]]
    if (pa < MIN_ALPHA) continue
    const max = Math.max(pr, pg, pb)
    const min = Math.min(pr, pg, pb)
    const sat = max === 0 ? 0 : (max - min) / max
    if (sat < MIN_SATURATION) continue

    const { h } = rgbToHsl(pr, pg, pb)
    const bucket = Math.min(HUE_BUCKETS - 1, Math.floor(h * HUE_BUCKETS))
    bucketR[bucket] += pr; bucketG[bucket] += pg; bucketB[bucket] += pb
    bucketCount[bucket]++
    totalQualifying++
  }
  if (totalQualifying < MIN_QUALIFYING_PIXELS) return null

  let winner = 0
  for (let i = 1; i < HUE_BUCKETS; i++) {
    if (bucketCount[i] > bucketCount[winner]) winner = i
  }
  const n = bucketCount[winner]
  if (n < MIN_QUALIFYING_PIXELS) return null

  const { h, s } = rgbToHsl(bucketR[winner] / n, bucketG[winner] / n, bucketB[winner] / n)
  // Clamp into the same lightness/saturation band the rest of the app's
  // type colors sit in, so a pale or near-black brand mark still reads as
  // a confident tile background rather than washing out (too light for
  // white text) or going near-black (loses the "which company" signal).
  return hslToRgbString(h, Math.max(s, 0.55), 0.42)
}

/**
 * Resolves to an approximate brand color for a logo URL, or null if one
 * can't be extracted (no URL, load/decode failure, CORS-tainted canvas, or
 * a mark with no clearly-dominant color). Results are cached per URL for
 * the lifetime of the page — logos repeat across positions and re-renders.
 */
export function getLogoColor(url: string | null | undefined): Promise<string | null> {
  if (!url) return Promise.resolve(null)
  if (colorCache.has(url)) return Promise.resolve(colorCache.get(url) ?? null)
  const inFlight = pending.get(url)
  if (inFlight) return inFlight

  const promise = new Promise<string | null>((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        resolve(sampleDominantColor(img))
      } catch {
        resolve(null)
      }
    }
    img.onerror = () => resolve(null)
    img.src = toSamplingUrl(url)
  })

  pending.set(url, promise)
  promise.then((color) => {
    colorCache.set(url, color)
    pending.delete(url)
  })
  return promise
}
