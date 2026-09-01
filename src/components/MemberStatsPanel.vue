<!--
  v1.1 成员支出统计
  - 双维度：creator（谁付的）vs member（钱算谁的）
  - 单成员家庭：退化为一个总支出图
  - 时间范围跟随首页顶部筛选（store.filter.range）
  - 点击柱子 → 跳列表并预填 memberIds
-->
<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { BarChart } from 'echarts/charts'
import {
  GridComponent,
  TooltipComponent,
  TitleComponent,
  LegendComponent
} from 'echarts/components'
import VChart, { THEME_KEY } from 'vue-echarts'
import { provide } from 'vue'
import { useExpenseStore } from '@/stores/expense'
import { useFamilyStore } from '@/stores/family'
import { displayNameOf } from '@/lib/displayName'
import { rangeStartIso } from '@/lib/dateRange'
import { useAnimatedNumber } from '@/lib/useAnimatedNumber'

use([CanvasRenderer, BarChart, GridComponent, TooltipComponent, TitleComponent, LegendComponent])
provide(THEME_KEY, 'light')

const expenseStore = useExpenseStore()
const familyStore = useFamilyStore()

// 聚合数据
interface MemberAgg { memberId: string; total: number; name: string }

const byCreator = ref<MemberAgg[]>([])
const byMember = ref<MemberAgg[]>([])

// 竞态保护：快速切换筛选时丢弃过期聚合结果
let statsSeq = 0

async function loadStats() {
  const seq = ++statsSeq
  // familyStore.members 由 App.vue bootstrap 拉；这里只读不重拉
  //（之前 if (members.length === 0) await familyStore.load() 会在首次启动和
  //  App.vue bootstrap 同步到达时重复打 family_members 接口）
  // 跟 HomeView 列表筛选保持一致:把 categoryIds/memberIds/amount 一起传给 aggregate
  const f = expenseStore.filter
  const extraFilter = {
    categoryIds: f.categoryIds,
    memberIds: f.memberIds,
    minAmount: f.minAmount,
    maxAmount: f.maxAmount
  }
  const since = rangeStartIso(f.range)
  const [creator, member] = await Promise.all([
    expenseStore.aggregateByCreator(since, extraFilter),
    expenseStore.aggregateByMember(since, extraFilter)
  ])
  if (seq !== statsSeq) return // 过期请求丢弃
  // creator 维度: aggregateByCreator 返回的 memberId 实际是 profile.id (expenses.creator_id FK 到 profiles)
  // 需要翻译成 family_member.id 才能用 familyStore.members 找名字
  // family_member.linked_profile_id = profile.id
  function profileToFamilyMemberId(profileId: string): string | null {
    const fm = familyStore.members.find((x) => x.linked_profile_id === profileId)
    return fm?.id || null
  }
  function resolveName(familyMemberId: string | null, fallback: string): string {
    if (!familyMemberId) return fallback.slice(0, 8) // 孤儿 profile,显示 ID 前 8 位
    const m = familyStore.members.find((x) => x.id === familyMemberId)
    if (m) return displayNameOf(m)
    return fallback.slice(0, 8)
  }
  byCreator.value = creator
    .map((c) => {
      const fmId = profileToFamilyMemberId(c.memberId)
      return { memberId: fmId || c.memberId, total: c.total, name: resolveName(fmId, c.memberId) }
    })
    .filter((x) => x.memberId) // 孤儿 profile 暂时不显示
  byMember.value = member.map((m) => ({ ...m, name: resolveName(m.memberId, m.memberId) }))
}

// 监听 expenseStore.revision（数据版本号）：任何筛选变化都会触发 store 的 load()
// 成功后 revision++，记账/分摊/删除也会 revision++，这里随之聚合一次即可；
// 不直接监听 filter 明细 + items，否则一次切换会触发两次聚合请求。
// 首次启动：expense.load() 完成 revision 0→1 时 watch 也会触发 loadStats，
// 所以不需要 onMounted(loadStats) —— 之前两者同时跑会双触发聚合请求。
// 另监听家庭成员数量，新增成员后图表出现新柱子。
let statsTimer: ReturnType<typeof setTimeout> | null = null
watch(
  [() => expenseStore.revision, () => familyStore.members.length],
  () => {
    if (statsTimer) clearTimeout(statsTimer)
    statsTimer = setTimeout(() => void loadStats(), 250)
  }
)

// 决定要不要退化为单图
const onlyOneMember = computed(() => familyStore.members.length <= 1)

// 总金额
const creatorTotal = computed(() => byCreator.value.reduce((s, x) => s + x.total, 0))
const memberTotal = computed(() => byMember.value.reduce((s, x) => s + x.total, 0))

// 单成员时的"全部"总和（直接用 expense filter / items 不准确，用一次额外的全量聚合）
// 简化：单成员时直接用 store.totalAmount 的逻辑，但需要重算。
// 实用做法：复用 byMember 的 total
const singleTotal = computed(() => memberTotal.value)

// 图表标题金额数字滚动过渡
const creatorTotalDisplay = useAnimatedNumber(() => creatorTotal.value)
const memberTotalDisplay = useAnimatedNumber(() => memberTotal.value)
const singleTotalDisplay = useAnimatedNumber(() => singleTotal.value)

// 点击柱子 → 跳列表预填 memberIds 并滚动
function onBarClick(memberId: string) {
  // 单成员时点击无效（filter 没意义）
  if (onlyOneMember.value) return
  expenseStore.filter.memberIds = [memberId]
  // 触发 HomeView 的列表滚动
  emit('jump-to-list', memberId)
}

const emit = defineEmits<{
  (e: 'jump-to-list', memberId: string): void
}>()

// 柱条右侧的金额标签：大金额缩写为"万"，避免超出绘图区被裁剪
function formatBarLabel(v: number) {
  if (v >= 10000) return '¥' + (v / 10000).toFixed(1) + '万'
  return '¥' + Math.round(v)
}

// 成员色板：与全局 --color-primary / --color-{blue,green,purple,yellow} 保持一致
const MEMBER_COLORS = ['#f56c2c', '#4f7cff', '#2fb55f', '#8a63f4', '#f5a623', '#00b8a9', '#e05a9c']

// 同一成员在"按付款人 / 按消费成员"两张图中保持同一颜色（按 memberId 稳定映射，而非数组下标）
const memberColorMap = new Map<string, number>()
let nextColorSlot = 0
function colorOf(memberId: string): string {
  const key = memberId || '__none__'
  let idx = memberColorMap.get(key)
  if (idx === undefined) {
    idx = nextColorSlot++ % MEMBER_COLORS.length
    memberColorMap.set(key, idx)
  }
  return MEMBER_COLORS[idx]
}

// 把 hex 颜色向浅色方向混合（factor: 0~1，越大越接近白色）
function lighten(hex: string, factor: number): string {
  const n = parseInt(hex.slice(1), 16)
  const r = Math.min(255, Math.round(((n >> 16) & 255) + (255 - ((n >> 16) & 255)) * factor))
  const g = Math.min(255, Math.round(((n >> 8) & 255) + (255 - ((n >> 8) & 255)) * factor))
  const b = Math.min(255, Math.round((n & 255) + (255 - (n & 255)) * factor))
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`
}

// 每个成员的柱体用其专属色的渐变（浅→深，延续原来的渐变质感）
function barGradient(color: string) {
  return {
    type: 'linear',
    x: 0,
    y: 0,
    x2: 1,
    y2: 0,
    colorStops: [
      { offset: 0, color: lighten(color, 0.4) },
      { offset: 1, color }
    ]
  }
}

// 横向 bar 配置
function buildOption(rows: MemberAgg[], total: number, title: string) {
  // 按金额降序
  const sorted = [...rows].sort((a, b) => b.total - a.total)
  return {
    // 数据更新动画：切换筛选/记账时柱状图平滑过渡
    animation: true,
    animationDuration: 450,
    animationEasing: 'cubicOut',
    animationDurationUpdate: 450,
    animationEasingUpdate: 'cubicOut',
    animationThreshold: 2000,
    // right 需给右侧金额标签留足空间（series label 不参与 containLabel 计算）
    grid: { left: 40, right: 90, top: 30, bottom: 30, containLabel: true },
    tooltip: {
      trigger: 'item',
      formatter: (p: any) => {
        const v = (p.value as number) || 0
        return `${p.name}<br/>¥${v.toFixed(2)}（${total > 0 ? ((v / total) * 100).toFixed(1) : '0.0'}%）`
      }
    },
    xAxis: {
      type: 'value',
      axisLabel: { formatter: (v: number) => '¥' + v.toFixed(0) }
    },
    yAxis: {
      type: 'category',
      data: sorted.map((r) => r.name),
      inverse: true
    },
    series: [
      {
        type: 'bar',
        data: sorted.map((r) => ({
          value: r.total,
          name: r.name,
          memberId: r.memberId,
          // 每人一个专属色（同成员在两张图中颜色一致）
          itemStyle: { color: barGradient(colorOf(r.memberId)) }
        })),
        itemStyle: {
          borderRadius: [0, 6, 6, 0],
          shadowColor: 'rgba(15, 23, 42, 0.10)',
          shadowBlur: 6
        },
        label: {
          show: true,
          position: 'right',
          formatter: (p: any) => formatBarLabel(p.value as number)
        }
      }
    ]
  }
}

const creatorOption = computed(() => buildOption(byCreator.value, creatorTotal.value, '按付款人'))
const memberOption = computed(() => buildOption(byMember.value, memberTotal.value, '按消费成员'))
const singleOption = computed(() => buildOption(byMember.value, singleTotal.value, '总支出'))
</script>

<template>
  <div class="member-stats-panel">
    <div class="panel-head">
      <h3>成员支出统计</h3>
    </div>

    <div v-if="onlyOneMember" class="single-chart">
      <v-chart
        v-if="byMember.length > 0"
        class="chart"
        :option="singleOption"
        :init-options="{ renderer: 'canvas' }"
        @click="(p: any) => onBarClick(p.data?.memberId)"
      />
      <div v-else class="empty-tip">本月还没有支出数据</div>
      <div class="single-total">
        <div class="label">总支出</div>
        <div class="value">¥{{ singleTotalDisplay.toFixed(2) }}</div>
      </div>
    </div>

    <div v-else class="dual-chart">
      <div class="chart-cell">
        <div class="chart-title">
          <span>按付款人（我付的）</span>
          <span class="total">¥{{ creatorTotalDisplay.toFixed(2) }}</span>
        </div>
        <v-chart
          v-if="byCreator.length > 0"
          class="chart"
          :option="creatorOption"
          :init-options="{ renderer: 'canvas' }"
          @click="(p: any) => onBarClick(p.data?.memberId)"
        />
        <div v-else class="empty-tip">本月还没有支出数据</div>
        <div class="hint">点击柱子查看该付款人的账单</div>
      </div>
      <div class="chart-cell">
        <div class="chart-title">
          <span>按消费成员（钱算谁头上）</span>
          <span class="total">¥{{ memberTotalDisplay.toFixed(2) }}</span>
        </div>
        <v-chart
          v-if="byMember.length > 0"
          class="chart"
          :option="memberOption"
          :init-options="{ renderer: 'canvas' }"
          @click="(p: any) => onBarClick(p.data?.memberId)"
        />
        <div v-else class="empty-tip">本月还没有支出数据</div>
        <div class="hint">点击柱子查看该消费成员的账单</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.member-stats-panel {
  background: #fff;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: 20px;
  margin-bottom: 16px;
  box-shadow: var(--shadow-card);
}
.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px 12px;
  margin-bottom: 16px;
}
.panel-head h3 {
  margin: 0;
  font-size: 16px;
  color: var(--color-text);
  font-weight: 700;
}
.dual-chart {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
}
.chart-cell {
  display: flex;
  flex-direction: column;
}
.chart-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 14px;
  color: var(--color-text-soft);
  margin-bottom: 8px;
  padding: 0 4px;
}
.chart-title .total {
  font-weight: 700;
  color: var(--color-text);
  font-size: 15px;
  font-variant-numeric: tabular-nums;
}
.chart {
  height: 280px;
  width: 100%;
  cursor: pointer;
}
.hint {
  font-size: 12px;
  color: var(--color-text-muted);
  margin-top: 4px;
  text-align: center;
}
.empty-tip {
  height: 280px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-muted);
  background: var(--color-bg);
  border-radius: var(--radius-md);
  font-size: 13px;
}
.single-chart {
  position: relative;
}
.single-total {
  position: absolute;
  top: 20px;
  right: 30px;
  text-align: right;
}
.single-total .label {
  font-size: 12px;
  color: var(--color-text-muted);
}
.single-total .value {
  font-size: 22px;
  font-weight: 700;
  color: var(--color-text);
  margin-top: 4px;
  font-variant-numeric: tabular-nums;
}
@media (max-width: 768px) {
  .dual-chart {
    grid-template-columns: 1fr;
  }
}
</style>
