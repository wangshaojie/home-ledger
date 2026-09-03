#!/usr/bin/env node
// MCP server 入口脚本
// 走 stdio transport,被 AI agent 子进程启动
// 所有日志走 stderr(避免污染 stdout JSON-RPC 通道)

import('../dist/index.js').catch((err) => {
  process.stderr.write(`[home-ledger-mcp] 启动失败: ${err.stack || err.message}\n`);
  process.exit(1);
});
