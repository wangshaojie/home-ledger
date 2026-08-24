// Standalone type-check runner — bypasses shell cwd issues
// Usage: node scripts/check-types.cjs
const { spawnSync } = require('node:child_process')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
console.log('[check-types] cwd:', root)

const r = spawnSync(
  process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
  ['exec', 'vue-tsc', '--noEmit'],
  {
    cwd: root,
    stdio: 'inherit',
    shell: false,
    windowsHide: true
  }
)

console.log('[check-types] exit:', r.status)
process.exit(r.status || 0)
