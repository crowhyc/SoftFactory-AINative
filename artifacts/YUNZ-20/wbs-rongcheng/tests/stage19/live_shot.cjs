'use strict';
/* YUNZ-39 / 变更包 #8（CH-15）运行现场取证：用真实 Chromium 打开 live 工作台（127.0.0.1:4180），
   读取顶部全量统计与「详情」面板（分阶段），与 live /api/stats 的 aggregate / phases 对齐，
   输出桌面 1600 与手机 375 截图 + 详情面板截图。
      docker run --rm --network host -e SHOT_DIR=/out \
        -v /opt/wbs-rongcheng:/app -v /opt/wbs-rongcheng/tests/.tools:/tools \
        -v /opt/wbs-rongcheng/tests/.tmp/stage19-live:/out \
        -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
        mcr.microsoft.com/playwright:v1.55.0-jammy node /app/tests/stage19/live_shot.cjs
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
  await page.waitForFunction(() => document.querySelectorAll('#overview-rows .overview-row').length === 1 &&
    document.querySelectorAll('#overview-rows .overview-badge').length === 5 &&
    document.querySelectorAll('#overview-detail-rows .overview-row').length === 5, null, { timeout: 20000 });
  await page.waitForTimeout(400);

  const readZones = () => page.evaluate(() => {
    const readRows = (selector) => Array.from(document.querySelectorAll(selector)).map((row) => ({
      phase: row.getAttribute('data-phase'),
      label: row.querySelector('.overview-phase') ? row.querySelector('.overview-phase').textContent : null,
      badges: Array.from(row.querySelectorAll('.overview-badge')).map((badge) => ({
        value: badge.getAttribute('data-status'),
        count: badge.getAttribute('data-count'),
        percentage: badge.getAttribute('data-percentage'),
        text: badge.textContent,
        bg: getComputedStyle(badge).backgroundColor,
        color: getComputedStyle(badge).color
      }))
    }));
    return {
      total: document.getElementById('overview-total').textContent,
      detailTotal: document.getElementById('overview-detail-total').textContent,
      detailHidden: document.getElementById('overview-detail-panel').hidden,
      detailBtn: document.getElementById('overview-detail-btn').textContent,
      headers: Array.from(document.querySelectorAll('#wbs-table thead th')).map((th) => th.textContent).slice(5, 10),
      top: readRows('#overview-rows .overview-row'),
      phases: readRows('#overview-detail-rows .overview-row'),
      docScrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      barBottom: Math.round(document.getElementById('phase-overview').getBoundingClientRect().bottom),
      tableTop: Math.round(document.querySelector('.table-wrap').getBoundingClientRect().top)
    };
  });

  const closed = await readZones();
  await page.screenshot({ path: path.join(outDir, 'live-workbench-1600.png'), fullPage: false });
  await page.click('#overview-detail-btn');
  await page.waitForTimeout(300);
  const desktopDetail = await readZones();
  await page.screenshot({ path: path.join(outDir, 'live-detail-1600.png'), fullPage: false });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.getElementById('overview-detail-panel').hidden === true, null, { timeout: 8000 });
  await page.setViewportSize({ width: 375, height: 720 });
  await page.waitForTimeout(400);
  const mobile = await readZones();
  await page.screenshot({ path: path.join(outDir, 'live-workbench-375.png'), fullPage: false });
  await page.click('#overview-detail-btn');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(outDir, 'live-detail-375.png'), fullPage: false });

  const stats = await (await fetch(base + '/api/stats')).json();
  const mismatches = [];
  const topRow = closed.top[0] || { badges: [] };
  stats.aggregate.statuses.forEach((status, j) => {
    const badge = topRow.badges[j] || {};
    if (badge.text !== status.value + ' ' + status.count + ' ' + status.percentage.toFixed(1) + '%') {
      mismatches.push('aggregate/' + status.value + '=' + badge.text);
    }
  });
  stats.phases.forEach((phase, index) => {
    const row = closed.phases[index] || {};
    if (row.phase !== phase.key) mismatches.push('阶段顺序 ' + row.phase);
    if (row.label !== phase.name) mismatches.push(phase.key + ' 阶段名=' + row.label);
    phase.statuses.forEach((status, j) => {
      const badge = (row.badges || [])[j] || {};
      if (badge.text !== status.value + ' ' + status.count + ' ' + status.percentage.toFixed(1) + '%') {
        mismatches.push(phase.key + '/' + status.value + '=' + badge.text);
      }
    });
  });
  if (closed.detailHidden !== true || desktopDetail.detailHidden !== false) mismatches.push('详情面板开关异常');
  if (JSON.stringify(closed.headers) !== JSON.stringify(['设计', '开发', '测试', '产品验收', '演示准备'])) {
    mismatches.push('网页阶段列头=' + JSON.stringify(closed.headers));
  }
  if (!/产品验收/.test(desktopDetail.phases[3] ? desktopDetail.phases[3].label : '')) mismatches.push('详情产品阶段标签=' + (desktopDetail.phases[3] || {}).label);
  fs.writeFileSync(path.join(outDir, 'live-zones.json'), JSON.stringify({ base, stats, closed, desktopDetail, mobile, mismatches }, null, 2));
  await browser.close();
  console.log(JSON.stringify({
    base,
    total: closed.total,
    aggregate: topRow.badges.map((b) => b.text),
    detailRows: closed.phases.length,
    headers: closed.headers,
    detailOpenThenEsc: desktopDetail.detailHidden === false && mobile.detailHidden === true,
    mobileNoPageScroll: mobile.docScrollWidth <= mobile.clientWidth + 1,
    liveStatsTotal: stats.total,
    mismatches,
    pageErrors: errors
  }, null, 2));
  process.exit(errors.length === 0 && mismatches.length === 0 ? 0 : 1);
})();
