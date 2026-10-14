'use strict';
// `node --test backend/harness/test` を Node 22 以降でも動かすための入口(ディレクトリ指定はこの index.js が解決される)。
// 個別実行: node --test backend/harness/test/*.test.js
const fs = require('fs');
const path = require('path');
fs.readdirSync(__dirname).filter((f) => f.endsWith('.test.js')).sort().forEach((f) => require(path.join(__dirname, f)));
