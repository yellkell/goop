/**
 * Headless creature photography — serves the built dist, opens the
 * workbench (dev.html) in headless Chromium with SwiftShader WebGL, runs
 * each ?shot=<scene> mini-performance until the page raises
 * window.__SHOT_READY, and saves a PNG per scene.
 *
 *   node scripts/shot.mjs [outDir] [scene ...]
 *
 * Scenes default to: glob boxer punched reform ko.
 */

import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const outDir = process.argv[2] ?? 'shots';
const scenes = process.argv.length > 3 ? process.argv.slice(3) : ['glob', 'boxer', 'punched', 'reform', 'ko'];
mkdirSync(outDir, { recursive: true });

const PORT = 5199;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  stdio: 'pipe',
});
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('vite preview did not start')), 15000);
  server.stdout.on('data', (d) => {
    if (String(d).includes('http')) {
      clearTimeout(timer);
      resolve();
    }
  });
  server.on('exit', () => reject(new Error('vite preview exited early')));
});

const browser = await chromium.launch({
  // In sandboxed CI-style environments the pre-installed Chromium is used;
  // locally, drop executablePath and let Playwright find its own.
  executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});

try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  page.on('console', (m) => {
    if (m.type() === 'error') console.error('[page]', m.text());
  });
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));

  for (const scene of scenes) {
    await page.goto(`http://localhost:${PORT}/dev.html?shot=${scene}`, { waitUntil: 'load' });
    // Software WebGL (CI) crawls through the raymarch — give it a while.
    await page.waitForFunction(() => window.__SHOT_READY === true, undefined, { timeout: 120000 });
    await page.waitForTimeout(150);
    const file = `${outDir}/${scene}.png`;
    await page.screenshot({ path: file });
    console.log('shot:', file);
  }
} finally {
  await browser.close();
  server.kill();
}
