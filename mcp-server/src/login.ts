// login 子命令
// 当前流程(简化版):
//   1) 用户在 Vercel 激活页(下一步做)登录,点授权
//   2) 页面上显示 token + device_id
//   3) 用户复制粘贴到这里
//   4) 我们 verify + 存到 keytar
//
// 后续会升级成 OAuth Device Flow,用户只需要复制验证码,token 由 MCP server 自动拿

import { createInterface } from 'node:readline';
import { saveToken, type StoredToken } from './credentials.js';
import { verifyToken } from './supabase.js';
import { resolveConfig } from './config.js';

const log = (msg: string): void => {
  process.stdout.write(`${msg}\n`);
};

async function prompt(question: string, hidden = false): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: !hidden });
    if (hidden) {
      // 简单隐藏:用户输入时显示 *
      process.stdout.write(question);
      let input = '';
      process.stdin.setRawMode?.(true);
      process.stdin.on('data', (chunk) => {
        const ch = chunk.toString('utf8');
        if (ch === '\n' || ch === '\r' || ch === '\u0004') {
          process.stdin.setRawMode?.(false);
          process.stdout.write('\n');
          rl.close();
          resolve(input);
        } else if (ch === '\u0003') {
          process.exit(1);
        } else if (ch === '\u007f' || ch === '\b') {
          if (input.length > 0) {
            input = input.slice(0, -1);
            process.stdout.write('\b \b');
          }
        } else {
          input += ch;
          process.stdout.write('*');
        }
      });
    } else {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer);
      });
    }
  });
}

async function main(): Promise<void> {
  try {
    await resolveConfig();
  } catch (e) {
    log(`❌ ${(e as Error).message}`);
    log('   运行 `home-ledger-mcp config set` 配置 Supabase 连接。');
    process.exit(1);
  }

  log('=== 家庭记账 MCP 设备激活 ===\n');
  log('步骤 1: 在浏览器打开激活页(部署好之后会告诉你 URL)');
  log('步骤 2: 用你的家庭记账账号登录');
  log('步骤 3: 输入设备名(随便,例 "我的 Mavis")');
  log('步骤 4: 点"授权" → 复制页面上的 access_token\n');

  const deviceName = (await prompt('设备名: ')).trim();
  if (!deviceName) {
    log('❌ 设备名不能为空');
    process.exit(1);
  }

  const token = (await prompt('access_token (粘贴): ', true)).trim();
  if (!token || token.length !== 64) {
    log('❌ token 格式错误(应该是 64 个十六进制字符)');
    process.exit(1);
  }

  log('\n正在验证 token ...');
  let verified;
  try {
    verified = await verifyToken(token);
  } catch (e) {
    log(`❌ 验证失败: ${(e as Error).message}`);
    log('可能原因: token 输入错 / 已过期 / 已被吊销 / SUPABASE 配置错');
    process.exit(1);
  }

  const stored: StoredToken = {
    device_id: verified.device_id,
    device_name: deviceName,
    token,
    scopes: verified.scopes,
    expires_at: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(), // 粗略 30 天,实际以服务端为准
    created_at: new Date().toISOString(),
  };
  // 实际 expires_at 应该用 verify 返回的,但 verify 当前没返——先粗略存
  // 不影响功能:服务端每次都验,本机存的时间只是用于"找 active token"过滤

  await saveToken(stored);

  log(`\n✅ 设备激活成功!`);
  log(`   设备名: ${stored.device_name}`);
  log(`   设备 ID: ${stored.device_id}`);
  log(`   权限: ${stored.scopes.join(', ')}`);
  log(`\n现在可以在 Cursor / Claude Desktop / Mavis 等配置 MCP server:`);
  log(`   command: npx home-ledger-mcp`);
  log(`   env: HOME_LEDGER_SUPABASE_URL / HOME_LEDGER_SUPABASE_ANON_KEY\n`);
}

main().catch((e) => {
  log(`❌ 致命错误: ${(e as Error).message}`);
  process.exit(1);
});
