<script setup lang="ts">
import { computed, ref, onMounted, watch } from 'vue'
import { useExpenseStore } from '@/stores/expense'
import { useCategoryStore } from '@/stores/category'
import { usePaymentAccountStore } from '@/stores/paymentAccount'
import { useFamilyStore } from '@/stores/family'
import { displayNameOf } from '@/lib/displayName'
import * as echarts from 'echarts/core'
import { LineChart, PieChart } from 'echarts/charts'
import {
  TitleComponent,
  TooltipComponent,
  LegendComponent,
  GridComponent
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import VChart from 'vue-echarts'

echarts.use([
  LineChart,
  PieChart,
  TitleComponent,
  TooltipComponent,
  LegendComponent,
  GridComponent,
  CanvasRenderer
])

const store = useExpenseStore()
const categoryStore = useCategoryStore()
const accountStore = usePaymentAccountStore()
const familyStore = useFamilyStore()

// v2026-09-01 支持查看去年 / 前年 / 指定月份
const range = ref<'month' | 'year' | 'lastYear' | 'beforeLastYear' | 'custom'>('month')
const customMonth = ref('')

/** 当前统计期间（起止时间戳，含起不含止） */
const period = computed(() => {
  const now = new Date()
  let start: Date
  let end: Date
  switch (range.value) {
    case 'month':
      start = new Date(now.getFullYear(), now.getMonth(), 1)
      end = new Date(now.getFullYear(), now.getMonth() + 1, 1)
      break
    case 'year':
      start = new Date(now.getFullYear(), 0, 1)
      end = new Date(now.getFullYear() + 1, 0, 1)
      break
    case 'lastYear':
      start = new Date(now.getFullYear() - 1, 0, 1)
      end = new Date(now.getFullYear(), 0, 1)
      break
    case 'beforeLastYear':
      start = new Date(now.getFullYear() - 2, 0, 1)
      end = new Date(now.getFullYear() - 1, 0, 1)
      break
    case 'custom': {
      const [y, m] = customMonth.value.split('-').map(Number)
      if (!y || !m) {
        start = new Date(now.getFullYear(), now.getMonth(), 1)
        end = new Date(now.getFullYear(), now.getMonth() + 1, 1)
      } else {
        start = new Date(y, m - 1, 1)
        end = new Date(y, m, 1)
      }
      break
    }
  }
  return { start: start.getTime(), end: end.getTime() }
})

/** 期间显示文案：本月 / 今年 / 去年 / 前年 / 2025年3月 */
const periodLabel = computed(() => {
  switch (range.value) {
    case 'month':
      return '本月'
    case 'year':
      return '今年'
    case 'lastYear':
      return '去年'
    case 'beforeLastYear':
      return '前年'
    case 'custom': {
      const [y, m] = customMonth.value.split('-').map(Number)
      return y ? `${y}年${m}月` : ''
    }
  }
})

/** 是否落在当前统计期间内 */
function inPeriod(e: { spent_at: string }) {
  const t = new Date(e.spent_at).getTime()
  return t >= period.value.start && t < period.value.end
}

/** 切到「指定月份」但还没选过时，默认当前月，避免空白统计 */
function onRangeChange(v: string | number | boolean | undefined) {
  if (v === 'custom' && !customMonth.value) {
    const now = new Date()
    customMonth.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  }
}

const dailySeries = computed(() => {
  const days = Math.round((period.value.end - period.value.start) / 86400000)
  const arr: { date: string; amount: number }[] = []
  for (let i = 0; i < days; i++) {
    const d = new Date(period.value.start + i * 86400000)
    const key = `${d.getMonth() + 1}/${d.getDate()}`
    arr.push({ date: key, amount: 0 })
  }
  store.items.forEach((e) => {
    const t = new Date(e.spent_at).getTime()
    if (t >= period.value.start && t < period.value.end) {
      const idx = Math.floor((t - period.value.start) / 86400000)
      if (idx >= 0 && idx < days) arr[idx].amount += Number(e.amount)
    }
  })
  return arr
})

const lineOption = computed(() => ({
  tooltip: {
    trigger: 'axis',
    formatter: (p: any) => `${p[0].axisValue}<br/>支出：¥ ${p[0].data.toFixed(2)}`
  },
  grid: { left: 50, right: 30, top: 30, bottom: 40 },
  xAxis: {
    type: 'category',
    data: dailySeries.value.map((d) => d.date),
    axisLine: { lineStyle: { color: '#e6e8eb' } },
    axisLabel: {
      color: '#909399',
      fontSize: 11,
      interval: dailySeries.value.length > 90 ? 29 : 4
    }
  },
  yAxis: {
    type: 'value',
    axisLine: { show: false },
    axisTick: { show: false },
    splitLine: { lineStyle: { color: '#f0f1f2' } },
    axisLabel: {
      color: '#909399',
      formatter: (v: number) => (v >= 1000 ? v / 1000 + 'k' : v)
    }
  },
  series: [
    {
      data: dailySeries.value.map((d) => Math.round(d.amount * 100) / 100),
      type: 'line',
      smooth: true,
      symbol: 'circle',
      symbolSize: 6,
      lineStyle: { color: '#f56c2c', width: 2 },
      itemStyle: { color: '#f56c2c' },
      areaStyle: {
        color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
          { offset: 0, color: 'rgba(245,108,44,0.25)' },
          { offset: 1, color: 'rgba(245,108,44,0.02)' }
        ])
      }
    }
  ]
}))

const categoryData = computed(() => {
  const map = new Map<string, number>()
  store.items.forEach((e) => {
    if (!inPeriod(e)) return
    map.set(e.category_id, (map.get(e.category_id) || 0) + Number(e.amount))
  })
  return categoryStore.items
    .map((c) => ({
      name: c.name,
      value: map.get(c.id) || 0,
      icon: c.icon
    }))
    .filter((d) => d.value > 0)
    .sort((a, b) => b.value - a.value)
})

const pieOption = computed(() => ({
  tooltip: {
    trigger: 'item',
    formatter: (p: any) =>
      `${p.seriesName}<br/>${p.marker} ${p.name}<br/>¥ ${p.value.toFixed(2)} (${p.percent}%)`
  },
  legend: {
    bottom: 0,
    type: 'scroll',
    textStyle: { color: '#646a73', fontSize: 12 }
  },
  series: [
    {
      name: '分类占比',
      type: 'pie',
      radius: ['45%', '70%'],
      center: ['50%', '45%'],
      avoidLabelOverlap: true,
      itemStyle: { borderRadius: 6, borderColor: '#fff', borderWidth: 2 },
      label: { show: false },
      labelLine: { show: false },
      data: categoryData.value
    }
  ],
  color: [
    '#f56c2c','#4f7cff','#2fb55f','#8a63f4','#f5a623',
    '#00b8a9','#e05a9c','#5b8ff9','#ff9d4d','#269a99'
  ]
}))

const accountData = computed(() => {
  const map = new Map<string, number>()
  store.items.forEach((e) => {
    if (!inPeriod(e)) return
    if (e.account_id) {
      map.set(e.account_id, (map.get(e.account_id) || 0) + Number(e.amount))
    }
  })
  return accountStore.items
    .map((a) => ({
      id: a.id,
      name: a.name,
      icon: a.icon,
      value: map.get(a.id) || 0
    }))
    .filter((d) => d.value > 0)
    .sort((a, b) => b.value - a.value)
})

const accountPieOption = computed(() => ({
  tooltip: {
    trigger: 'item',
    formatter: (p: any) =>
      `${p.seriesName}<br/>${p.marker} ${p.name}<br/>¥ ${p.value.toFixed(2)} (${p.percent}%)`
  },
  legend: {
    bottom: 0,
    type: 'scroll',
    textStyle: { color: '#646a73', fontSize: 12 }
  },
  series: [
    {
      name: '支付账户占比',
      type: 'pie',
      radius: ['45%', '70%'],
      center: ['50%', '45%'],
      avoidLabelOverlap: true,
      itemStyle: { borderRadius: 6, borderColor: '#fff', borderWidth: 2 },
      label: { show: false },
      labelLine: { show: false },
      data: accountData.value.map((d) => ({ name: d.name, value: d.value }))
    }
  ],
  color: [
    '#4f7cff','#2fb55f','#f56c2c','#f5a623','#8a63f4',
    '#00b8a9','#e05a9c','#5b8ff9','#ff9d4d','#269a99'
  ]
}))

const memberRanking = computed(() => {
  const map = new Map<string, number>()
  store.items.forEach((e) => {
    if (!inPeriod(e)) return
    map.set(e.member_id, (map.get(e.member_id) || 0) + Number(e.amount))
  })
  return familyStore.members
    .map((m) => ({
      id: m.id,
      name: displayNameOf(m),
      total: map.get(m.id) || 0
    }))
    .sort((a, b) => b.total - a.total)
})

const payerRanking = computed(() => {
  const map = new Map<string, number>()
  store.items.forEach((e) => {
    if (!inPeriod(e)) return
    if (!e.payer_id) return
    map.set(e.payer_id, (map.get(e.payer_id) || 0) + Number(e.amount))
  })
  return familyStore.members
    .filter((m) => (map.get(m.id) || 0) > 0)
    .map((m) => ({
      id: m.id,
      name: displayNameOf(m),
      total: map.get(m.id) || 0
    }))
    .sort((a, b) => b.total - a.total)
})

const totalInRange = computed(() =>
  store.items.filter(inPeriod).reduce((s, e) => s + Number(e.amount), 0)
)

function fmt(n: number) {
  return '¥ ' + Number(n).toFixed(2)
}

// 首次进入统计页 / 切换顶部 range 时,按统计口径重新拉数据
// v2026-09-02 修复:之前只有 items.length === 0 才 load,
// 切菜单时 store.items 已经有「今天/本周」数据,统计页想看「本月/去年」就空白
// loadForStats 不依赖记账页 filter,不会污染记账页 state
function loadForStats() {
  // 'month' 走 SQL month 下界(精准)
  // 'year' / 'lastYear' / 'beforeLastYear' / 'custom' 拉全量,在前端 inPeriod 过滤
  const target: 'month' | 'all' = range.value === 'month' ? 'month' : 'all'
  void store.loadForStats(target)
}

onMounted(() => {
  loadForStats()
})

// 切顶部 range 时重新拉
watch(range, () => {
  loadForStats()
})
</script>

<template>
  <div class="stats">
    <div class="page-header">
      <div>
        <h2 class="page-title">家庭支出统计</h2>
        <p class="page-sub">按家庭成员 / 分类 / 支付账户洞察家庭开支</p>
      </div>
      <div class="range-pills">
        <el-radio-group v-model="range" @change="onRangeChange">
          <el-radio-button value="month">本月</el-radio-button>
          <el-radio-button value="year">本年</el-radio-button>
          <el-radio-button value="lastYear">去年</el-radio-button>
          <el-radio-button value="beforeLastYear">前年</el-radio-button>
          <el-radio-button value="custom">指定月份</el-radio-button>
        </el-radio-group>
        <el-date-picker
          v-if="range === 'custom'"
          v-model="customMonth"
          type="month"
          format="YYYY年MM月"
          value-format="YYYY-MM"
          :clearable="false"
          size="default"
          class="month-picker"
        />
      </div>
    </div>

    <div
      class="top-row"
      v-loading="store.loading"
      element-loading-text="数据加载中…"
    >
      <div class="big-stat highlight">
        <div class="big-stat-icon"><el-icon><TrendCharts /></el-icon></div>
        <div>
          <div class="big-stat-label">{{ periodLabel }}总支出</div>
          <div class="big-stat-value">{{ fmt(totalInRange) }}</div>
        </div>
      </div>
      <div class="top3">
        <div class="top3-title">
          消费排行 TOP 3
          <span class="top3-sub">花在谁身上</span>
        </div>
        <div v-for="(m, i) in memberRanking.slice(0, 3)" :key="m.id" class="top3-row">
          <span class="rank" :class="`rank-${i + 1}`">{{ i + 1 }}</span>
          <span class="top3-name">{{ m.name }}</span>
          <span class="top3-amount">{{ fmt(m.total) }}</span>
        </div>
        <div v-if="memberRanking.length === 0" class="empty-mini">暂无数据</div>
      </div>
      <div class="top3">
        <div class="top3-title">
          付款排行 TOP 3
          <span class="top3-sub">谁掏的钱</span>
        </div>
        <div v-for="(m, i) in payerRanking.slice(0, 3)" :key="m.id" class="top3-row">
          <span class="rank" :class="`rank-${i + 1}`">{{ i + 1 }}</span>
          <span class="top3-name">{{ m.name }}</span>
          <span class="top3-amount">{{ fmt(m.total) }}</span>
        </div>
        <div v-if="payerRanking.length === 0" class="empty-mini">暂无数据</div>
      </div>
    </div>

    <div
      class="chart-card"
      v-loading="store.loading"
      element-loading-text="数据加载中…"
    >
      <div class="chart-title">{{ periodLabel }}每日支出趋势</div>
      <v-chart class="chart" :option="lineOption" autoresize />
    </div>

    <div class="chart-row">
      <div
        class="chart-card"
        v-loading="store.loading"
        element-loading-text="数据加载中…"
      >
        <div class="chart-title">分类支出占比</div>
        <v-chart class="chart" :option="pieOption" autoresize />
      </div>
      <div
        class="chart-card"
        v-loading="store.loading"
        element-loading-text="数据加载中…"
      >
        <div class="chart-title">分类支出明细</div>
        <div class="cat-bars">
          <div v-for="c in categoryData" :key="c.name" class="cat-bar-row">
            <div class="cat-bar-label">
              <span class="cat-bar-icon">{{ c.icon }}</span>
              <span>{{ c.name }}</span>
            </div>
            <div class="cat-bar-track">
              <div
                class="cat-bar-fill"
                :style="{
                  width: categoryData[0] ? (c.value / categoryData[0].value) * 100 + '%' : '0%'
                }"
              />
            </div>
            <div class="cat-bar-amount">{{ fmt(c.value) }}</div>
          </div>
          <div v-if="categoryData.length === 0" class="empty-mini">暂无数据</div>
        </div>
      </div>
    </div>

    <div class="chart-row">
      <div
        class="chart-card"
        v-loading="store.loading"
        element-loading-text="数据加载中…"
      >
        <div class="chart-title">支付账户占比</div>
        <v-chart class="chart" :option="accountPieOption" autoresize />
      </div>
      <div
        class="chart-card"
        v-loading="store.loading"
        element-loading-text="数据加载中…"
      >
        <div class="chart-title">支付账户明细</div>
        <div class="cat-bars">
          <div v-for="a in accountData" :key="a.id" class="cat-bar-row">
            <div class="cat-bar-label">
              <span class="cat-bar-icon">{{ a.icon }}</span>
              <span>{{ a.name }}</span>
            </div>
            <div class="cat-bar-track">
              <div
                class="cat-bar-fill acc-fill"
                :style="{
                  width: accountData[0] ? (a.value / accountData[0].value) * 100 + '%' : '0%'
                }"
              />
            </div>
            <div class="cat-bar-amount">{{ fmt(a.value) }}</div>
          </div>
          <div v-if="accountData.length === 0" class="empty-mini">暂无数据</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.stats {
  max-width: 1200px;
  margin: 0 auto;
}
.page-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px 12px;
  margin-bottom: 20px;
}
.page-title {
  font-size: 26px;
  font-weight: 700;
  margin: 0 0 4px;
  letter-spacing: -0.3px;
}
.page-sub {
  color: var(--color-text-soft);
  font-size: 13px;
  margin: 0;
}
/* 本月 / 本年 胶囊切换：胶囊间留间距、可换行 */
.range-pills {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.range-pills .month-picker {
  flex-shrink: 0;
}
.range-pills :deep(.el-radio-group) {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0;
}
.range-pills :deep(.el-radio-button) {
  margin: 0;
  padding: 0;
  flex-shrink: 0;
}
.range-pills :deep(.el-radio-button + .el-radio-button) {
  margin-left: 0;
}
.range-pills :deep(.el-radio-button__inner) {
  border: none;
  background: transparent;
  border-radius: 8px;
  padding: 8px 16px;
  box-shadow: none;
  color: var(--color-text-soft);
  font-weight: 500;
  transition: background 0.15s, color 0.15s;
}
.range-pills :deep(.el-radio-button__inner:hover) {
  color: var(--color-primary);
}
.range-pills :deep(.el-radio-button__original-radio:checked + .el-radio-button__inner) {
  background: var(--color-primary-soft);
  color: var(--color-primary);
  font-weight: 600;
}

.top-row {
  display: grid;
  grid-template-columns: 1.3fr 1fr 1fr;
  gap: 16px;
  margin-bottom: 20px;
}
.big-stat,
.top3 {
  background: #fff;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: 24px;
  box-shadow: var(--shadow-card);
  transition: transform 0.2s, box-shadow 0.2s;
}
.big-stat {
  display: flex;
  align-items: center;
  gap: 14px;
}
.big-stat:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-card-hover);
}
.big-stat.highlight {
  background: linear-gradient(135deg, #ff8f4d 0%, #f56c2c 100%);
  border: none;
  color: #fff;
}
.big-stat.highlight:hover {
  box-shadow: 0 8px 22px rgba(245, 108, 44, 0.35);
}
.big-stat-icon {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  background: var(--color-primary-soft);
  color: var(--color-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  flex-shrink: 0;
}
.big-stat.highlight .big-stat-icon {
  background: rgba(255, 255, 255, 0.22);
  color: #fff;
}
.big-stat-label {
  color: var(--color-text-soft);
  font-size: 13px;
  margin-bottom: 8px;
}
.big-stat.highlight .big-stat-label {
  color: rgba(255, 255, 255, 0.85);
}
.big-stat-value {
  font-size: 36px;
  font-weight: 700;
  color: var(--color-primary);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.3px;
}
.big-stat.highlight .big-stat-value {
  color: #fff;
}
.top3-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text);
  margin-bottom: 16px;
  display: flex;
  align-items: baseline;
  gap: 6px;
}
.top3-sub {
  font-size: 11px;
  color: var(--color-text-soft);
  font-weight: 400;
}
.top3-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 0;
}
.rank {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
  color: #fff;
  background: #c0c4cc;
}
.rank-1 { background: #f5a623; }
.rank-2 { background: #b8bcc4; }
.rank-3 { background: #d4985f; }
.top3-name {
  flex: 1;
  font-size: 14px;
}
.top3-amount {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
/* 窄窗口：大数字卡整行，两个排行卡片并排换行 */
@media (max-width: 1100px) {
  .top-row {
    grid-template-columns: 1fr 1fr;
  }
  .big-stat {
    grid-column: 1 / -1;
  }
}
@media (max-width: 640px) {
  .top-row {
    grid-template-columns: 1fr;
  }
}

.chart-card {
  background: #fff;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: 20px 24px;
  box-shadow: var(--shadow-card);
  margin-bottom: 16px;
}
.chart-title {
  font-size: 15px;
  font-weight: 500;
  color: var(--color-text);
  margin-bottom: 16px;
}
.chart {
  height: 280px;
}
.chart-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-bottom: 16px;
}
.chart-row .chart-card {
  margin-bottom: 0;
}
.chart-row:last-child {
  margin-bottom: 0;
}

.cat-bars {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: 280px;
  overflow-y: auto;
}
.cat-bar-row {
  display: grid;
  grid-template-columns: 110px 1fr 90px;
  align-items: center;
  gap: 12px;
  font-size: 13px;
}
.cat-bar-label {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--color-text);
}
.cat-bar-icon {
  font-size: 16px;
}
.cat-bar-track {
  background: #f0f1f2;
  height: 8px;
  border-radius: 4px;
  overflow: hidden;
}
.cat-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, #ff9d4d, #f56c2c);
  border-radius: 4px;
  transition: width 0.3s;
}
.cat-bar-fill.acc-fill {
  background: linear-gradient(90deg, #8ec5ff, #5b8ff9);
}
.cat-bar-amount {
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: var(--color-text-soft);
}
.empty-mini {
  text-align: center;
  color: #c0c4cc;
  padding: 30px 0;
  font-size: 13px;
}
</style>
