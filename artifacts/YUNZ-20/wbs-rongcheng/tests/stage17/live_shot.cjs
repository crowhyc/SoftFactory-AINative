'use strict';
/* YUNZ-37 / 变更包 #7（CH-14）运行现场取证：用真实 Chromium 打开 live 工作台（127.0.0.1:4180），
   读取顶部总览条并与 live /api/stats 对齐，输出桌面 1600 与手机 375 两张截图。
      docker run --rm --network host -e SHOT_DIR=/out \
        -v /opt/wbs-rongcheng:/app -v /opt/wbs-rongcheng/tests/.tools:/tools \
        -v /opt/wbs-rongcheng/tests/.tmp/stage17-live:/out \
        -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
        mcr.microsoft.com/playwright:v1.55.0-jammy node /app/tests/stage17/live_shot.cjs
   只读访问 live 服务，不写入现场数据。 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('/tools/node_modules/playwright');

(async () => {
  const base = process.env.LIVE_BASE || 'http://127.0.0.1:4180';
  const outDir = process.env.SHOT_DIR || '/out';
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(base + '/', { waitUntil: 'load' });
  await page.waitForSelector('#identity-list button[data-identity="项目负责人"]', { timeout: 20000 });
  await page.click('#identity-list button[data-identity="项目负责人"]');
  await page.waitForFunction(() => document.getElementById('workbench').hidden === false, null, { timeout: 20000 });
  await page.waitForFunction(() => document.querySelectorAll('#overview-rows .overview-row').length === 5, null, { timeout: 20000 });
  await page.waitForTimeout(400);

  const readBar = () => page.evaluate(() => ({
    total: document.getElementById('overview-total').textContent,
    rows: Array.from(document.querySelectorAll('#overview-rows .overview-row')).map((row) => ({
      phase: row.getAttribute('data-phase'),
      label: row.querySelector('.overview-phase').textContent,
      badges: Array.from(row.querySelectorAll('.overview-badge')).map((badge) => ({
        value: badge.getAttribute('data-status'),
        count: badge.getAttribute('data-count'),
        percentage: badge.getAttribute('data-percentage'),
        text: badge.textContent,
        bg: getComputedStyle(badge).backgroundColor,
        color: getComputedStyle(badge).color
      }))
    })),
    docScrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    barBottom: Math.round(document.getElementById('phase-overview').getBoundingClientRect().bottom),
    tableTop: Math.round(document.querySelector('.table-wrap').getBoundingClientRect().top)
  }));

  const desktop = await readBar();
  await page.screenshot({ path: path.join(outDir, 'live-workbench-1600.png'), fullPage: false });
  await page.setViewportSize({ width: 375, height: 720 });
  await page.waitForTimeout(400);
  const mobile = await readBar();
  await page.screenshot({ path: path.join(outDir, 'live-workbench-375.png'), fullPage: false });

  const stats = await (await fetch(base + '/api/stats')).json();
  const mismatches = [];
  stats.phases.forEach((phase, index) => {
    const row = desktop.rows[index] || {};
    if (row.phase !== phase.key) mismatches.push('阶段顺序 ' + row.phase);
    phase.statuses.forEach((status, j) => {
      const badge = (row.badges || [])[j] || {};
      if (badge.text !== status.value + ' ' + status.count + ' ' + status.percentage.toFixed(1) + '%') {
        mismatches.push(phase.key + '/' + status.value + '=' + badge.text);
      }
    });
  });
  fs.writeFileSync(path.join(outDir, 'live-stats.json'), JSON.stringify({ base, stats, desktop, mobile, mismatches }, null, 2));
  await browser.close();
  console.log(JSON.stringify({
    base,
    total: desktop.total,
    rows: desktop.rows.length,
    design: desktop.rows[0].badges.map((b) => b.text + ' ' + b.bg),
    mobileNoPageScroll: mobile.docScrollWidth <= mobile.clientWidth + 1,
    liveStatsTotal: stats.total,
    mismatches,
    pageErrors: errors
  }, null, 2));
  process.exit(errors.length === 0 && mismatches.length === 0 ? 0 : 1);
})();
