import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer, type Server } from 'node:http';

test.use({ channel: 'chrome' });
let directory: string;
let server: Server;
let origin: string;

test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'returnops-ui-'));
  const root = resolve(import.meta.dirname, '../..');
  const require = createRequire(join(root, 'package.json'));
  await require('esbuild').build({
    stdin: {
      contents: 'import {createRoot} from "react-dom/client"; import App from "./src/features/returnops/returnops-app"; createRoot(document.getElementById("root")).render(<App testMode />);',
      resolveDir: root, loader: 'tsx',
    },
    bundle: true, outfile: join(directory, 'app.js'), format: 'esm',
    jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' },
  });
  server = createServer(async (request, response) => {
    if (request.url === '/app.js' || request.url === '/app.css') {
      response.setHeader('Content-Type', request.url.endsWith('.css') ? 'text/css' : 'text/javascript');
      response.end(await readFile(join(directory, request.url)));
    } else {
      // Reproduce Tailwind's margin reset, which previously displaced the modal.
      response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{margin:0;padding:0}</style><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('UI server did not start');
  origin = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  if (directory) await rm(directory, { recursive: true, force: true });
});

for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 640 }]) {
  test(`owner controls after scrolling at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto(origin);
    await page.getByRole('button', { name: 'Áo chưa dùng, còn tem nhưng không vừa', exact: true }).click();
    await page.getByRole('button', { name: 'Chủ shop xem xét', exact: true }).click();
    const select = page.getByRole('combobox', { name: 'Hướng xử lý do bạn chọn' });
    await select.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollTo(0, Math.max(100, window.scrollY)));
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    expect((await page.locator('.topbar').boundingBox())?.y).toBe(0);
    await select.focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('listbox')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(select).toBeFocused();
    await select.click();
    await page.getByRole('option', { name: 'Nhận hàng trả rồi hoàn tiền', exact: true }).click();
    await expect(select).toHaveText('Nhận hàng trả rồi hoàn tiền');
    await page.getByLabel('Lý do quyết định (bắt buộc)', { exact: true }).fill('Presentation regression');
    const opener = page.getByRole('button', { name: 'Duyệt xử lý đơn này', exact: true });
    for (const closeWithEscape of [true, false]) {
      await opener.click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      const box = (await dialog.boundingBox())!;
      expect(Math.abs(box.x + box.width / 2 - viewport.width / 2)).toBeLessThan(2);
      expect(Math.abs(box.y + box.height / 2 - viewport.height / 2)).toBeLessThan(2);
      expect(box.y).toBeGreaterThanOrEqual(15);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height - 15);
      await expect(dialog.getByRole('button', { name: 'Đóng xác nhận' })).toBeFocused();
      await page.keyboard.press('Shift+Tab');
      await expect(dialog.getByRole('button', { name: 'Xác nhận', exact: true })).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(dialog.getByRole('button', { name: 'Đóng xác nhận' })).toBeFocused();
      if (closeWithEscape) await page.keyboard.press('Escape');
      else await dialog.getByRole('button', { name: 'Để sau' }).click();
      await expect(dialog).toHaveCount(0);
      await expect(opener).toBeFocused();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
