#!/usr/bin/env node
import('../dist/login.js').catch((err) => {
  process.stderr.write(`[home-ledger-mcp login] 启动失败: ${err.stack || err.message}\n`);
  process.exit(1);
});
