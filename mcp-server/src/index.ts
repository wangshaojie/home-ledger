// MCP server 主文件
// 暴露 6 个工具给 AI agent:add_expense / list_recent / delete_expense / list_categories / list_members / whoami
// 启动时:1) 读 token  2) 调 verify_mcp_token 确认有效  3) 起 stdio transport

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { getActiveToken, listTokens } from './credentials.js';
import {
  addExpense,
  deleteExpense,
  listCategories,
  listMembers,
  listRecent,
  verifyToken,
} from './supabase.js';
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
          '在家庭记账中记一笔支出,自动归属当前用户所在家庭。默认值约定:' +
          '分类不传→自动归"餐饮";账户不传→自动用"微信支付";' +
          '消费成员不传→默认只有爸爸一人(单选时用单条记录);' +
          '多人共同消费(如全家吃饭)传多个 member_ids → 按人数均分拆成多条记录;' +
          '付款人固定默认爸爸;消费时间自动=发起记账的时刻(发任务时间)。' +
          '需要分类/成员 ID 时先调 home_ledger_list_categories / home_ledger_list_members 获取,不要凭空编造。' +
          '拿不准就不传,保持默认。返回 expense_id(多人分摊时返回多条,可逐个删除)。',
        inputSchema: {
          type: 'object',
          properties: {
            amount: {
              type: 'number',
              description: '金额(数字,> 0,<= 10000000,单位:元;多人分摊时传总金额)',
            },
            note: {
              type: 'string',
              description: '备注(可选,如"午餐 - 兰州拉面")',
            },
            category_id: {
              type: 'string',
              description:
                '分类 ID(可选;必须来自 home_ledger_list_categories 返回的 id;' +
                '不传则默认归为"餐饮")',
            },
            account_id: {
              type: 'string',
              description: '支付账户 ID(可选;不传则默认"微信支付")',
            },
            member_ids: {
              type: 'array',
              items: { type: 'string' },
              description:
                '消费成员 ID 列表(可选;多人共同消费如全家吃饭/几个人一起 AA 时才填,' +
                '会按人数均分并拆成多条记录;ID 必须来自 home_ledger_list_members;' +
                '不传则默认爸爸一人)',
            },
          },
          required: ['amount'],
        },
      },
      {
        name: 'home_ledger_list_categories',
        description:
          '列出当前用户家庭的全部支出分类(含图标、名称和分类 ID)。' +
          '【记账前先调它】获取 category_id,再调 home_ledger_add_expense 时带上分类。',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'home_ledger_list_members',
        description:
          '列出当前用户家庭的消费成员(名字、类型和成员 ID)。' +
          '【多人共同消费(AA)记账前先调它】获取 member_id 列表,再传给 home_ledger_add_expense 的 member_ids。' +
          '单人记账不用调,默认爸爸一人。',
        inputSchema: {
          type: 'object',
          properties: {},
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
          member_ids?: string[];
        };
        if (typeof a.amount !== 'number' || a.amount <= 0) {
          throw new Error('amount 必须是大于 0 的数字');
        }
        const results = await addExpense(stored.token, {
          amount: a.amount,
          note: a.note,
          category_id: a.category_id,
          account_id: a.account_id,
          member_ids: Array.isArray(a.member_ids) ? a.member_ids : undefined,
        }, hostname());
        if (results.length === 1) {
          const r = results[0];
          return {
            content: [
              {
                type: 'text',
                text:
                  `✅ 记账成功\n` +
                  `金额: ¥${r.amount}\n` +
                  `日期: ${r.spent_at}\n` +
                  `expense_id: ${r.expense_id}\n` +
                  `家庭: ${r.family_id}\n` +
                  `创建者: ${r.creator_id}`,
              },
            ],
          };
        }
        // 多人分摊:每条一行
        const lines = results.map(
          (r) => `- ¥${r.amount} | id=${r.expense_id} | 日期 ${r.spent_at}`,
        );
        return {
          content: [
            {
              type: 'text',
              text:
                `✅ 记账成功,已按 ${results.length} 人均分拆条(可对整组分摊分别删除):\n` +
                `${lines.join('\n')}`,
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

      if (name === 'home_ledger_list_categories') {
        const cats = await listCategories(stored.token);
        if (cats.length === 0) {
          return { content: [{ type: 'text', text: '当前家庭没有任何分类。' }] };
        }
        const lines = cats.map((c) => `- ${c.icon} ${c.name} | id=${c.id}`);
        return {
          content: [
            {
              type: 'text',
              text: `当前家庭分类(${cats.length}):\n${lines.join('\n')}`,
            },
          ],
        };
      }

      if (name === 'home_ledger_list_members') {
        const members = await listMembers(stored.token);
        if (members.length === 0) {
          return { content: [{ type: 'text', text: '当前家庭还没有成员。' }] };
        }
        const typeLabel = (t: string): string =>
          t === 'adult' ? '大人' : t === 'child' ? '小孩' : t === 'pet' ? '宠物' : t;
        const lines = members.map(
          (m) => `- ${m.name} (${typeLabel(m.member_type)})${m.is_me ? ' [我]' : ''} | id=${m.id}`,
        );
        return {
          content: [
            {
              type: 'text',
              text: `当前家庭成员(${members.length}):\n${lines.join('\n')}`,
            },
          ],
        };
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
