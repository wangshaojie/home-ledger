// MCP server 主文件
// 暴露 4 个工具给 AI agent:home_ledger_add_expense / list_recent / delete_expense / whoami
// 启动时:1) 读 token  2) 调 verify_mcp_token 确认有效  3) 起 stdio transport

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { getActiveToken, listTokens } from './credentials.js';
import { addExpense, deleteExpense, listRecent, verifyToken } from './supabase.js';
import { resolveConfig } from './config.js';
import { hostname } from 'node:os';

// 所有日志走 stderr,绝不污染 stdout(JSON-RPC 通道)
const log = (msg: string): void => {
  process.stderr.write(`[home-ledger-mcp] ${msg}\n`);
};

function createServer(): Server {
  const server = new Server(
    {
      name: 'home-ledger-mcp',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  // 列出工具
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'home_ledger_add_expense',
        description:
          '在家庭记账中记一笔支出。会自动归属到当前用户所在家庭。' +
          '调用前请确认:金额、分类(可选)、账户(可选)、日期(默认今天)、备注(可选)。' +
          '返回:expense_id(可后续用 home_ledger_delete_expense 删除)。',
        inputSchema: {
          type: 'object',
          properties: {
            amount: {
              type: 'number',
              description: '金额(数字,> 0,<= 10000000,单位:元)',
            },
            note: {
              type: 'string',
              description: '备注(可选,如"午餐 - 兰州拉面")',
            },
            category_id: {
              type: 'string',
              description: '分类 ID(可选;不传则不归类)',
            },
            account_id: {
              type: 'string',
              description: '支付账户 ID(可选;不传则不绑账户)',
            },
            spent_at: {
              type: 'string',
              description:
                '消费日期 YYYY-MM-DD(可选)。默认【不要填】:不填则自动记录为发起记账的时刻(含时分)。' +
                '仅当补记过去某天(非今天)的账时才填,如"昨天"或具体日期(会记为该日 00:00)。',
            },
          },
          required: ['amount'],
        },
      },
      {
        name: 'home_ledger_list_recent',
        description:
          '查询当前用户家庭最近 N 笔支出(默认 10,最多 100)。' +
          '返回字段:amount / note / category_name / account_name / spent_at / creator_name。',
        inputSchema: {
          type: 'object',
          properties: {
            limit: {
              type: 'number',
              description: '返回条数(1-100,默认 10)',
            },
          },
        },
      },
      {
        name: 'home_ledger_delete_expense',
        description:
          '软删一笔支出(同家庭成员可删)。' +
          '参数:expense_id(从 list_recent 或 add_expense 返回)。',
        inputSchema: {
          type: 'object',
          properties: {
            expense_id: {
              type: 'string',
              description: '要删除的 expense ID(从 list_recent 拿)',
            },
          },
          required: ['expense_id'],
        },
      },
      {
        name: 'home_ledger_whoami',
        description:
          '查看当前 MCP 设备绑定的用户和设备信息(用户 ID、家庭、token 过期时间等)。' +
          '调试用,日常不需调用。',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
    ],
  }));

  // 调用工具
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    // whoami 不走 token 验(读本地 credentials 就够)
    if (name === 'home_ledger_whoami') {
      const tokens = await listTokens();
      const active = tokens.find((t) => new Date(t.expires_at).getTime() > Date.now());
      if (!active) {
        return {
          content: [
            {
              type: 'text',
              text: '当前没有活跃的 MCP 设备。请运行 `home-ledger-mcp login` 完成激活。',
            },
          ],
        };
      }
      return {
        content: [
          {
            type: 'text',
            text:
              `设备名: ${active.device_name}\n` +
              `设备 ID: ${active.device_id}\n` +
              `权限: ${active.scopes.join(', ')}\n` +
              `token 过期: ${active.expires_at}\n` +
              `创建: ${active.created_at}`,
          },
        ],
      };
    }

    // 其他工具:必须先拿 active token 并 verify
    const stored = await getActiveToken();
    if (!stored) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: '未登录。请先运行 `home-ledger-mcp login` 完成激活。',
          },
        ],
      };
    }

    // 验 token 确认还活着(可能服务器端已吊销/过期)
    let verified;
    try {
      verified = await verifyToken(stored.token);
    } catch (e) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `token 已失效: ${(e as Error).message}\n请重新运行 home-ledger-mcp login。`,
          },
        ],
      };
    }

    try {
      if (name === 'home_ledger_add_expense') {
        const a = (args ?? {}) as {
          amount: number;
          note?: string;
          category_id?: string;
          account_id?: string;
          spent_at?: string;
        };
        if (typeof a.amount !== 'number' || a.amount <= 0) {
          throw new Error('amount 必须是大于 0 的数字');
        }
        const result = await addExpense(stored.token, {
          amount: a.amount,
          note: a.note,
          category_id: a.category_id,
          account_id: a.account_id,
          spent_at: a.spent_at,
        }, hostname());
        return {
          content: [
            {
              type: 'text',
              text:
                `✅ 记账成功\n` +
                `金额: ¥${result.amount}\n` +
                `日期: ${result.spent_at}\n` +
                `expense_id: ${result.expense_id}\n` +
                `家庭: ${result.family_id}\n` +
                `创建者: ${result.creator_id}`,
            },
          ],
        };
      }

      if (name === 'home_ledger_list_recent') {
        const a = (args ?? {}) as { limit?: number };
        const limit = Math.min(Math.max(a.limit ?? 10, 1), 100);
        const items = await listRecent(stored.token, limit);
        if (items.length === 0) {
          return { content: [{ type: 'text', text: '没有找到任何账单。' }] };
        }
        const lines = items.map(
          (it) =>
            `- ${it.spent_at} | ¥${it.amount} | ${it.category_name ?? '未分类'} | ${it.account_name ?? '未指定账户'} | ${it.creator_name ?? '?'} | ${it.note ?? ''} | id=${it.expense_id}`,
        );
        return {
          content: [
            {
              type: 'text',
              text: `最近 ${items.length} 笔:\n${lines.join('\n')}`,
            },
          ],
        };
      }

      if (name === 'home_ledger_delete_expense') {
        const a = (args ?? {}) as { expense_id: string };
        if (!a.expense_id) {
          throw new Error('expense_id 不能为空');
        }
        await deleteExpense(stored.token, a.expense_id);
        return { content: [{ type: 'text', text: `✅ 已删除 expense ${a.expense_id}` }] };
      }

      return {
        isError: true,
        content: [{ type: 'text', text: `未知工具: ${name}` }],
      };
    } catch (e) {
      log(`工具 ${name} 执行失败: ${(e as Error).message}`);
      return {
        isError: true,
        content: [{ type: 'text', text: `执行失败: ${(e as Error).message}` }],
      };
    }
  });

  return server;
}

async function main(): Promise<void> {
  // 1. 校验配置存在
  try {
    await resolveConfig();
  } catch (e) {
    log((e as Error).message);
    process.exit(1);
  }

  // 2. 检查是否至少有一个 active token
  const active = await getActiveToken();
  if (!active) {
    log('⚠️ 当前没有可用的 MCP 设备 token');
    log('请先运行 `home-ledger-mcp login` 完成激活(MCP 工具暂时只能 whoami)');
    // 不退出 — whoami 还能用
  } else {
    log(`已加载设备: ${active.device_name} (过期 ${active.expires_at})`);
  }

  // 3. 起 stdio transport
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log('MCP server 已启动(stdio)');
}

main().catch((e) => {
  log(`致命错误: ${e.stack ?? e.message}`);
  process.exit(1);
});
