'use strict';
/* YUNZ-35 / 变更包 #6（CH-13）运行现场取证：用真实 Chromium 打开 live 工作台（127.0.0.1:4180），
   点「导出日报」并截图弹层，输出概况行与文本长度。运行方式见 tests/verify_stage15.sh 末尾提示：
     docker run --rm --network host -e SHOT=/out/live-daily-popup.png \
       -v /opt/wbs-rongcheng:/app -v /opt/wbs-rongcheng/tests/.tools:/tools \
       -v /opt/wbs-rongcheng/tests/.tmp/stage15-live:/out \
       -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
       mcr.microsoft.com/playwright:v1.55.0-jammy node /app/tests/stage15/live_shot.cjs
   只读访问 live 服务，不写入现场数据。 */
const { chromium } = require('/tools/node_modules/playwright');
(async () => {
  const base = process.env.LIVE_BASE || 'http://127.0.0.1:4180';
  const shot = process.env.SHOT || '/out/live-daily-popup.png';
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(base + '/', { waitUntil: 'load' });
  await page.waitForSelector('#identity-list button[data-identity="项目负责人"]', { timeout: 20000 });
  await page.click('#identity-list button[data-identity="项目负责人"]');
  await page.waitForFunction(() => document.getElementById('workbench').hidden === false, null, { timeout: 20000 });
  await page.waitForSelector('#daily-btn', { timeout: 20000 });
  await page.click('#daily-btn');
  await page.waitForFunction(() => document.getElementById('daily-panel').hidden === false, null, { timeout: 15000 });
  await page.waitForTimeout(400);
  const info = await page.evaluate(() => {
    const text = document.getElementById('daily-text').textContent;
    const card = document.querySelector('#daily-panel .modal-card');
    return {
      role: card ? card.getAttribute('role') : null,
      ariaModal: card ? card.getAttribute('aria-modal') : null,
      overview: text.split('\n')[0],
      lines: text.split('\n').filter(Boolean).length,
      chars: text.length,
      copyBtn: !!document.getElementById('daily-copy'),
      closeBtn: !!document.getElementById('daily-close'),
      whiteSpace: getComputedStyle(document.getElementById('daily-text')).whiteSpace
    };
  });
  await page.screenshot({ path: shot, fullPage: false });
  await browser.close();
  console.log(JSON.stringify({ base, shot, info, pageErrors: errors }, null, 2));
  process.exit(errors.length === 0 ? 0 : 1);
})();
