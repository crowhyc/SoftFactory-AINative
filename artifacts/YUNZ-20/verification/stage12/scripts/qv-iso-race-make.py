#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import io, json, sys
src, a, va, b, vb = sys.argv[1:6]
# 说明：宿主 locale 为 C（无 C.UTF-8），argv 里的非 ASCII 会被 surrogateescape 化，
# 因此这里用 ASCII 令牌传参，再映射为中文枚举值（脚本文件本身为 UTF-8，字面量安全）。
TOKEN = {'START': '\u5df2\u5f00\u59cb', 'BLOCKED': '\u963b\u585e'}
va, vb = TOKEN.get(va, va), TOKEN.get(vb, vb)
doc = json.load(io.open(src, encoding='utf-8'))
for out, val in ((a, va), (b, vb)):
    d = json.load(io.open(src, encoding='utf-8'))
    d['tasks'][0]['phases']['design'] = val
    # ensure_ascii=True：避免 Python 3.6 对非 BMP 字符的代理对往返问题；JSON 语义等价
    json.dump(d, io.open(out, 'w', encoding='utf-8'), ensure_ascii=True)
print('race payloads written: %s / %s' % (a, b))
