// 多尺寸 PNG → ICO（用于 electron-builder icon）
// 用法: node scripts/build-icon.cjs
const fs = require('node:fs')
const path = require('node:path')
const pngToIco = require('png-to-ico').default

const ROOT = path.resolve(__dirname, '..')
const SOURCE_PNG = path.join(ROOT, 'build', 'icon-256.png')
const OUTPUT_ICO = path.join(ROOT, 'build', 'icon.ico')

async function main() {
  if (!fs.existsSync(SOURCE_PNG)) {
    console.error(`Source PNG not found: ${SOURCE_PNG}`)
    process.exit(1)
  }

  // 多尺寸（electron-builder 推荐 256）
  const sizes = [16, 24, 32, 48, 64, 128, 256]
  const pngBuffers = []

  // 1. 256 已有，直接用
  pngBuffers.push(fs.readFileSync(SOURCE_PNG))

  // 2. 用 sharp/pic 缩放（如果装了）—— 简单起见只输出 256
  console.log('Using single 256x256 PNG (electron-builder will downscale as needed)')

  const ico = await pngToIco(pngBuffers)
  fs.writeFileSync(OUTPUT_ICO, ico)
  console.log(`✅ ICO written: ${OUTPUT_ICO} (${ico.length} bytes)`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
