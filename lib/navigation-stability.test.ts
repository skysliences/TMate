import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

void test('navigation style contract: fixed equal slots, no scaling or spring overshoot', async () => {
  const css = await readFile(
    new URL('../app/glass-navigation.css', import.meta.url),
    'utf8',
  );
  assert.match(css, /grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
  assert.doesNotMatch(css, /\bscale\(/);
  assert.doesNotMatch(css, /(?:top|bottom): -\d/);
  assert.doesNotMatch(css, /cubic-bezier\([^)]*1\.[1-9]/);
  const mobile = css.slice(css.indexOf('@media (max-width: 760px)'));
  const nav = mobile.slice(
    mobile.indexOf('.glass-nav {'),
    mobile.indexOf('.glass-nav-capsule'),
  );
  assert.match(nav, /position: fixed/);
  assert.match(nav, /left: 0/);
  assert.match(nav, /right: 0/);
  assert.match(nav, /transform: none !important/);
  assert.match(nav, /margin-inline: auto/);
});

void test('mobile tabs isolate document scrolling and do not focus touch destinations', async () => {
  const css = await readFile(
    new URL('../app/glass-navigation.css', import.meta.url),
    'utf8',
  );
  assert.match(css, /touch-action: pinch-zoom/);
  assert.doesNotMatch(css, /touch-action: pan-y/);
  assert.match(css, /\.app-tabs > \.workspace\s*\{[^}]*overflow-y: auto/);
  assert.match(css, /overscroll-behavior-y: contain/);
  const source = await readFile(
    new URL('../components/glass-navigation.tsx', import.meta.url),
    'utf8',
  );
  assert.match(source, /event.pointerType !== 'touch'/);
});
