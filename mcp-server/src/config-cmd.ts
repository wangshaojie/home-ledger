// home-ledger-mcp config 子命令
// 子命令:
//   set --url <url> --key <anon_key>   保存到本地
//   show                              显示当前配置(URL 脱敏)
//   reset                             删除本地配置

import { createInterface } from 'node:readline';
import { deleteConfig, loadConfig, saveConfig } from './config-store.js';

const log = (msg: string): void => {
  process.stdout.write(`${msg}\n`);
};

async function prompt(question: string, hidden = false): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: !hidden });
    if (hidden) {
      process.stdout.write(question);
      let input = '';
      const onData = (chunk: Buffer) => {
        const ch = chunk.toString('utf8');
        if (ch === '\n' || ch === '\r' || ch === '\u0004') {
          process.stdin.removeListener('data', onData);
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
      };
      process.stdin.setRawMode?.(true);
      process.stdin.resume();
      process.stdin.on('data', onData);
    } else {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer);
      });
    }
  });
}

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i]?.startsWith('--')) {
      out[argv[i]!.slice(2)] = argv[++i] ?? '';
    }
  }
  return out;
}

async function main(): Promise<void> {
  const cmd = process.argv[2];

  if (cmd === 'show') {
    const cfg = await loadConfig();
    if (!cfg) {
      log('❌ 未配置。运行 `home-ledger-mcp config set` 配置。');
      return;
    }
    const maskedKey = cfg.supabase_anon_key.slice(0, 8) + '...' + cfg.supabase_anon_key.slice(-6);
    log(`URL: ${cfg.supabase_url}`);
    log(`anon_key: ${maskedKey}`);
    return;
  }

  if (cmd === 'reset') {
    await deleteConfig();
    log('✅ 配置已删除');
    return;
  }

  if (cmd === 'set') {
    const args = parseArgs(process.argv.slice(3));
    let url = args.url;
    let key = args.key;

    if (!url) {
      url = (await prompt('Supabase URL (https://xxxxx.supabase.co): ')).trim();
    }
    if (!url) {
      log('❌ URL 不能为空');
      process.exit(1);
    }
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(url)) {
      log('⚠️ URL 格式看起来不像 Supabase (期望 https://xxxxx.supabase.co)');
    }

    if (!key) {
      key = (await prompt('Supabase anon key (粘贴,隐藏): ', true)).trim();
    }
    if (!key || key.length < 100) {
      log('❌ anon key 长度不对(应该 100+ 字符)');
      process.exit(1);
    }

    await saveConfig({ supabase_url: url, supabase_anon_key: key });
    log('✅ 配置已保存到本地加密文件');
    log('   下次启动 MCP server 会自动读取,无需再设 env');
    return;
  }

  // 默认:交互式设置
  log('用法:');
  log('  home-ledger-mcp config set --url <url> --key <anon_key>');
  log('  home-ledger-mcp config set                                # 交互式');
  log('  home-ledger-mcp config show');
  log('  home-ledger-mcp config reset');
}

main().catch((e) => {
  log(`❌ ${(e as Error).message}`);
  process.exit(1);
});
