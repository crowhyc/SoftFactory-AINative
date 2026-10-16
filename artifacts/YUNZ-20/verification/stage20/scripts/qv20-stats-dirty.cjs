'use strict';
/* YUNZ-40 / Stage20：脏数据（一行缺 product 键）下 statsOverview 的「只截断不补齐」分支。
   该分支无法经数据文件触发（服务启动会一次性迁移归一），故直接以模块调用取证，
   与 qv20-make-iso-data.py 的第二套算法（Fraction 精确有理数）结果逐项比对。 */
const fs = require('fs');
const path = require('path');

const S20 = process.env.S20 || '/qv';
const APP = process.env.APP_DIR || '/app';
const doc = JSON.parse(fs.readFileSync(path.join(S20, 'iso', 'isoD', 'wbs.dirty.json'), 'utf8'));
const expected = JSON.parse(fs.readFileSync(path.join(S20, 'results', 'expected-stats.json'), 'utf8'))
  .datasets.isoD;
const stats = require(path.join(APP, 'server.js')).statsOverview(doc);

let pass = 0;
let fail = 0;
const check = (id, ok, detail) => {
  if (ok) { pass += 1; console.log('PASS  ' + id + (detail === undefined ? '' : '  :: ' + JSON.stringify(detail))); }
  else { fail += 1; console.log('FAIL  ' + id + '  -> ' + JSON.stringify(detail)); }
};
const tenths = (values) => values.map((v) => Math.round(Number(v) * 10));

check('03/脏数据 total=3 且五键齐备（缺键行不计入）',
  stats.total === 3 && (stats.phases || []).length === 5, stats.total);
check('03/脏数据 aggregate 计数 = [12,1,1,0,0]（一行缺 product 键 -> 分母 15 但计数 14）',
  JSON.stringify((stats.aggregate.statuses || []).map((s) => s.count)) === JSON.stringify(expected.aggregate.counts),
  { actual: (stats.aggregate.statuses || []).map((s) => s.count), expected: expected.aggregate.counts });
check('03/脏数据 aggregate 只截断：80.0/6.6/6.6/0.0/0.0，五项合计 93.2 < 100.0',
  JSON.stringify(tenths((stats.aggregate.statuses || []).map((s) => s.percentage)))
    === JSON.stringify(tenths(expected.aggregate.percentages)),
  { actual: (stats.aggregate.statuses || []).map((s) => s.percentage),
    expected: expected.aggregate.percentages });
const product = (stats.phases || []).filter((p) => p.key === 'product')[0];
check('03/脏数据 product 阶段计数 = [2,0,0,0,0]（2 != 3），占比 66.6 不补齐',
  JSON.stringify((product.statuses || []).map((s) => s.count)) === JSON.stringify(expected.phases[3].counts)
  && JSON.stringify(tenths((product.statuses || []).map((s) => s.percentage)))
    === JSON.stringify(tenths(expected.phases[3].percentages)),
  { counts: (product.statuses || []).map((s) => s.count),
    percentages: (product.statuses || []).map((s) => s.percentage) });
check('03/脏数据下仍不报错且 phases 键名与显示名正确',
  (stats.phases || []).map((p) => p.key).join(',') === 'design,dev,test,product,demo_prep'
  && (stats.phases || [])[3].name === '\u4ea7\u54c1\u9a8c\u6536',
  (stats.phases || []).map((p) => p.key + ':' + p.name));

console.log('PASS=' + pass + ' FAIL=' + fail);
process.exit(fail ? 1 : 0);
