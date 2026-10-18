import { expect, test, type Page } from '@playwright/test'
import { signedInApp } from './fakeSupabase'

/**
 * Real-browser checks of the customizable Home / Charts grids. jsdom has no layout engine, so the
 * "do cards overlap / overflow / get cut off after a resize or an edit" class of bug can only be
 * caught here, against real measured boxes.
 */


async function readGrid(page: Page) {
  return page.evaluate(() => {
    const grid = document.querySelector<HTMLElement>('.mne-masonry')!
    const g = grid.getBoundingClientRect()
    const boxes = Array.from(grid.querySelectorAll<HTMLElement>(':scope > .mne-masonry-item'))
      .map((el) => {
        const r = el.getBoundingClientRect()
        const label = el.querySelector('.mne-dash-label')?.textContent ?? el.textContent?.slice(0, 24) ?? ''
        // Empty space between the card and the bottom of its cell: a card that did not stretch to its row.
        const card = el.querySelector('.mne-card')
        const cardGap = card ? r.bottom - card.getBoundingClientRect().bottom : 0
        return { label, l: r.left, t: r.top, r: r.right, b: r.bottom, cardGap }
      })
      .filter((x) => x.b - x.t > 0 && x.r - x.l > 0)
    return { columns: Number(grid.dataset.columns), container: { l: g.left, t: g.top, r: g.right, b: g.bottom }, boxes }
  })
}

/** All cards inside the container, none overlapping, none hanging below it. */
async function expectSoundGrid(page: Page, label: string) {
  // Wait for the layout to stop moving: cards animate to new positions for 180ms and the page's own
  // content (live badge, price refresh bar, Pulse) can still change heights right after load.
  let prev = ''
  let stable = 0
  for (let i = 0; i < 40 && stable < 2; i++) {
    await page.waitForTimeout(150)
    const now = JSON.stringify((await readGrid(page)).boxes.map((x) => [x.l, x.t, x.r, x.b].map(Math.round)))
    stable = now === prev ? stable + 1 : 0
    prev = now
  }
  const { container, boxes, columns } = await readGrid(page)
  expect(boxes.length, `${label}: cards on screen`).toBeGreaterThan(0)
  const E = 1.5
  for (const x of boxes) {
    expect(x.l, `${label}: "${x.label}" left of container`).toBeGreaterThanOrEqual(container.l - E)
    expect(x.r, `${label}: "${x.label}" right edge ${x.r} past container ${container.r}`).toBeLessThanOrEqual(container.r + E)
  }
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j]
      const overlap = a.l < b.r - E && b.l < a.r - E && a.t < b.b - E && b.t < a.b - E
      expect(overlap, `${label} (${columns} cols): "${a.label}" overlaps "${b.label}"`).toBe(false)
    }
  }
  // A grid: cards that share a top share a bottom, and every card fills its cell (one height per row).
  if (columns > 1) {
    const rows = new Map<number, typeof boxes>()
    for (const x of boxes) rows.set(Math.round(x.t), [...(rows.get(Math.round(x.t)) ?? []), x])
    for (const [top, cells] of rows) {
      for (const x of cells) {
        expect(Math.abs(x.b - cells[0].b), `${label} (${columns} cols): row at ${top}: "${x.label}" ends at ${x.b} but "${cells[0].label}" at ${cells[0].b}`).toBeLessThanOrEqual(E)
        expect(x.cardGap, `${label} (${columns} cols): "${x.label}" leaves ${x.cardGap}px empty under its card`).toBeLessThanOrEqual(E + 4) // 4px: the edit-mode outline offset
      }
    }
  }
  const lowest = Math.max(...boxes.map((x) => x.b))
  expect(container.b, `${label}: grid is shorter than its lowest card`).toBeGreaterThanOrEqual(lowest - E)
  return { container, boxes, columns }
}

const labels = (page: Page) => page.locator('.mne-masonry > .mne-masonry-item .mne-dash-label').allTextContents()
const editButton = (page: Page) => page.getByRole('button', { name: 'Edit layout' })

async function openHome(page: Page, width = 1440) {
  await page.setViewportSize({ width, height: 900 })
  await page.goto('/')
  await expect(page.locator('body')).toContainText('2,000', { timeout: 15_000 })
  await expect(page.locator('.mne-masonry-item').first()).toBeVisible()
}

const VIEWPORTS = [1600, 1440, 1180, 1024, 900, 768, 640, 480, 390, 320]

for (const path of ['/', '/charts']) {
  test(`${path}: no overlap or overflow at any window size, in view and edit mode`, async ({ page }) => {
    await signedInApp(page)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto(path)
    await expect(page.locator('.mne-masonry-item').first()).toBeVisible({ timeout: 15_000 })
    for (const width of VIEWPORTS) {
      await page.setViewportSize({ width, height: 900 })
      await expectSoundGrid(page, `${path} view @${width}`)
    }
    await editButton(page).click()
    for (const width of [...VIEWPORTS].reverse()) {
      await page.setViewportSize({ width, height: 900 })
      await expectSoundGrid(page, `${path} edit @${width}`)
    }
    await page.getByRole('button', { name: 'Done' }).click()
    await expectSoundGrid(page, `${path} back to view`)
  })
}

test('home: hiding a card removes it, closes the gap, survives reload and is saved to the account', async ({ page }) => {
  const db = await signedInApp(page)
  await openHome(page)
  await editButton(page).click()
  await expect(page.getByRole('region', { name: 'Layout editor' })).toBeVisible()
  const before = await readGrid(page)

  await page.getByRole('button', { name: 'Hide P&L' }).click()
  await expect(page.getByRole('button', { name: 'Show P&L' })).toBeVisible()
  expect(await labels(page)).not.toContain('P&L')
  const after = await expectSoundGrid(page, 'after hide')
  expect(after.boxes.length).toBe(before.boxes.length - 1)

  await expect.poll(() => db.calls.some((c) => c.path.endsWith('/user_settings') && JSON.stringify(c.body).includes('"hidden":true'))).toBe(true)
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByText('Unrealized, all stocks')).toHaveCount(0)

  // same device: restored from the local copy on the first render
  await page.waitForLoadState('networkidle')
  await page.reload()
  await expect(page.locator('.mne-masonry-item').first()).toBeVisible()
  await expect(page.getByText('Unrealized, all stocks')).toHaveCount(0)

  // a different device: no local copy, comes from the account
  await page.waitForLoadState('networkidle')
  await page.evaluate(() => { localStorage.removeItem('mne_dashboard_layouts'); localStorage.removeItem('mne_needs_signin') })
  await page.reload()
  await expect(page.locator('.mne-masonry-item').first()).toBeVisible()
  await expect(page.getByText('Unrealized, all stocks')).toHaveCount(0)

  // bring it back
  await editButton(page).click()
  await page.getByRole('button', { name: 'Show P&L' }).click()
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByText('Unrealized, all stocks')).toBeVisible()
})

test('home: dragging a card by its handle reorders the grid and the new order is kept', async ({ page }) => {
  const db = await signedInApp(page)
  await openHome(page)
  await editButton(page).click()
  const start = await labels(page)
  expect(start.slice(0, 3)).toEqual(['Net worth', 'Allocation', 'Portfolio Pulse'])

  const handle = page.getByRole('button', { name: 'Move Allocation' })
  const target = page.locator('.mne-masonry-item', { hasText: 'Portfolio Pulse' }).first()
  const hb = (await handle.boundingBox())!
  const tb = (await target.boundingBox())!
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2)
  await page.mouse.down()
  // straight down from the handle: through empty space, then onto the Pulse card
  const px = hb.x + hb.width / 2
  const py = tb.y + tb.height / 2
  await page.mouse.move(px, py, { steps: 12 })
  // while held, the card is lifted and follows the pointer (its bar's handle sits under the pointer)
  const lifted = page.locator('.mne-masonry-item.is-dragging')
  await expect(lifted).toHaveCount(1)
  const liftedHandle = (await lifted.locator('.mne-dash-handle').boundingBox())!
  expect(liftedHandle.x + liftedHandle.width / 2).toBeCloseTo(px, 0)
  expect(liftedHandle.y + liftedHandle.height / 2).toBeCloseTo(py, 0)
  await page.mouse.up()

  const now = await labels(page)
  expect(now.indexOf('Allocation')).toBeGreaterThan(start.indexOf('Allocation'))
  expect([...now].sort()).toEqual([...start].sort())
  await expect(page.locator('.mne-masonry-item.is-dragging')).toHaveCount(0)
  // settled into the grid: no leftover drag offset
  expect(await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('.mne-masonry-item')).every((el) => el.style.translate === ''))).toBe(true)
  await expectSoundGrid(page, 'after drag')

  await expect.poll(() => db.calls.filter((c) => c.path.endsWith('/user_settings')).length).toBe(1) // one save per drop, not per swap
  await page.getByRole('button', { name: 'Done' }).click()
  await page.waitForLoadState('networkidle')
  await page.reload()
  await expect(page.locator('.mne-masonry-item').first()).toBeVisible()
  await editButton(page).click()
  expect(await labels(page)).toEqual(now)
})

test('home: keyboard reorder works on the handle and keeps focus', async ({ page }) => {
  await signedInApp(page)
  await openHome(page)
  await editButton(page).click()
  const handle = page.getByRole('button', { name: 'Move Allocation' })
  await handle.focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('button', { name: 'Move Allocation' })).toBeFocused()
  expect((await labels(page)).indexOf('Allocation')).toBe(2)
  await expect(page.getByRole('status')).toContainText('Allocation moved to position 3')
  await page.keyboard.press('ArrowLeft')
  expect((await labels(page)).indexOf('Allocation')).toBe(1)
  await expectSoundGrid(page, 'after keyboard moves')
})

test('home: the width control resizes a card to 1, 2 or all columns', async ({ page }) => {
  await signedInApp(page)
  await openHome(page, 1440)
  await editButton(page).click()
  const widthOf = async (name: string) => (await page.locator('.mne-masonry-item', { hasText: name }).first().boundingBox())!.width
  const { container, columns } = await readGrid(page)
  expect(columns).toBe(3)
  const total = container.r - container.l
  const colW = (total - 2 * 24) / 3
  const group = page.getByRole('group', { name: 'Width of Allocation' })

  await group.getByRole('button', { name: 'Full' }).click()
  await page.waitForTimeout(450)
  expect(await widthOf('Allocation')).toBeCloseTo(total, 0)
  await expectSoundGrid(page, 'allocation full')

  await group.getByRole('button', { name: '2' }).click()
  await page.waitForTimeout(450)
  expect(await widthOf('Allocation')).toBeCloseTo(2 * colW + 24, 0)
  await expectSoundGrid(page, 'allocation 2 cols')

  await group.getByRole('button', { name: '1' }).click()
  await page.waitForTimeout(450)
  expect(await widthOf('Allocation')).toBeCloseTo(colW, 0)
  await expectSoundGrid(page, 'allocation 1 col')

  // shrinking the window re-clamps without overflow
  await group.getByRole('button', { name: 'Full' }).click()
  for (const w of [1100, 800, 600, 400]) {
    await page.setViewportSize({ width: w, height: 900 })
    await expectSoundGrid(page, `allocation full @${w}`)
  }
})

test('home on a phone: only hide / show is offered', async ({ page }) => {
  await signedInApp(page)
  await openHome(page, 390)
  expect((await readGrid(page)).columns).toBe(1)
  await editButton(page).click()
  await expect(page.getByRole('button', { name: /^Move / })).toHaveCount(0)
  await expect(page.getByRole('group', { name: /^Width of / })).toHaveCount(0)
  await page.getByRole('button', { name: 'Hide Allocation' }).click()
  expect(await labels(page)).not.toContain('Allocation')
  await page.getByRole('button', { name: 'Show Allocation' }).click()
  expect(await labels(page)).toContain('Allocation')
  await expectSoundGrid(page, 'phone edit')
  await page.getByRole('button', { name: 'Done' }).click()
  await expectSoundGrid(page, 'phone view')
})

test('resizing from desktop to phone while editing swaps the controls and keeps the grid sound', async ({ page }) => {
  await signedInApp(page)
  await openHome(page, 1440)
  await editButton(page).click()
  await expect(page.getByRole('button', { name: 'Move Allocation' })).toBeVisible()
  await page.setViewportSize({ width: 390, height: 800 })
  await expect(page.getByRole('button', { name: 'Move Allocation' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Hide Allocation' })).toBeVisible()
  await expectSoundGrid(page, 'phone')
  await page.setViewportSize({ width: 1440, height: 900 })
  await expect(page.getByRole('button', { name: 'Move Allocation' })).toBeVisible()
  await expectSoundGrid(page, 'desktop again')
})

test('charts: rows stay one height per row after rearranging, and reset restores the default order', async ({ page }) => {
  await signedInApp(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/charts')
  await expect(page.locator('.mne-masonry-item').first()).toBeVisible({ timeout: 15_000 })
  await expectSoundGrid(page, 'charts default')

  await editButton(page).click()
  const original = await labels(page)
  await page.getByRole('button', { name: `Move ${original[0]}` }).focus()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  expect(await labels(page)).not.toEqual(original)
  await expectSoundGrid(page, 'charts custom order')
  await page.getByRole('button', { name: 'Done' }).click()
  await expectSoundGrid(page, 'charts custom order, view')

  await editButton(page).click()
  await page.getByRole('button', { name: 'Reset layout' }).click()
  expect(await labels(page)).toEqual(original)
  await expectSoundGrid(page, 'charts reset')
})

test('hiding every chart leaves a hint, not a blank page', async ({ page }) => {
  await signedInApp(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/charts')
  await expect(page.locator('.mne-masonry-item').first()).toBeVisible({ timeout: 15_000 })
  await editButton(page).click()
  for (;;) {
    const hide = page.getByRole('button', { name: /^Hide / }).first()
    if (!(await hide.count())) break
    await hide.click()
  }
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByText(/every card is hidden/i)).toBeVisible()
})
