#!/usr/bin/env node
import('../dist/config-cmd.js').catch((err) => {
  process.stderr.write(`[home-ledger-mcp config] 启动失败: ${err.stack || err.message}\n`);
  process.exit(1);
});
