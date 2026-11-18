import test from 'node:test';
import assert from 'node:assert/strict';
import { installationInstructions } from '../services/pwaInstallation.ts';

test('iPhone and desktop-mode iPad receive manual Safari home-screen instructions', () => {
  for (const device of [
    { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', platform: 'iPhone', maxTouchPoints: 5 },
    { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)', platform: 'MacIntel', maxTouchPoints: 5 },
  ]) {
    const steps = installationInstructions(device).join(' ');
    assert.match(steps, /Safari/);
    assert.match(steps, /공유.*홈 화면에 추가/);
  }
});

test('Android fallback explains the browser menu and missing-install option without claiming installation', () => {
  const steps = installationInstructions({ userAgent: 'Mozilla/5.0 (Linux; Android 15)', platform: 'Linux armv8l', maxTouchPoints: 5 }).join(' ');
  assert.match(steps, /Chrome/);
  assert.match(steps, /브라우저 메뉴/);
  assert.match(steps, /이미 추가되어/);
  assert.doesNotMatch(steps, /Safari/);
});

test('ordinary Mac and Windows receive desktop guidance instead of iOS share instructions', () => {
  for (const device of [
    { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X)', platform: 'MacIntel', maxTouchPoints: 0 },
    { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', platform: 'Win32', maxTouchPoints: 10 },
  ]) {
    const steps = installationInstructions(device).join(' ');
    assert.match(steps, /Chrome 또는 Edge/);
    assert.doesNotMatch(steps, /Safari|공유 버튼/);
  }
});
