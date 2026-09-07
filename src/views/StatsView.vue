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

// v2026-09-07 range 扩展:支持 'today' / 'week' / '30d' 跟 HomeView 一致;
//   'custom' 改任意日期段(原先是单月),由 customDateRange 元组驱动
const range = ref<'today' | 'week' | 'month' | '30d' | 'year' | 'lastYear' | 'beforeLastYear' | 'custom'>('month')
const customDateRange = ref<[string, string] | null>(null)

/** 当前统计期间（起止时间戳，含起不含止） */
const period = computed(() => {
  const now = new Date()
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  let start: Date
  let end: Date
  switch (range.value) {
    case 'today':
      start = startOfDay
      end = new Date(startOfDay.getTime() + 86400000)
      break
    case 'week':
      start = new Date(now.getTime() - 6 * 86400000)
      end = new Date(startOfDay.getTime() + 86400000)
      break
    case 'month':
      start = new Date(now.getFullYear(), now.getMonth(), 1)
      end = new Date(now.getFullYear(), now.getMonth() + 1, 1)
      break
    case '30d':
      start = new Date(now.getTime() - 29 * 86400000)
      end = new Date(startOfDay.getTime() + 86400000)
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
      // daterange 给的 YYYY-MM-DD 是本地 00:00:00,
      // 这里把 end +1 day 让"含当天"语义清晰
      if (!customDateRange.value) {
        start = new Date(now.getFullYear(), now.getMonth(), 1)
        end = new Date(now.getFullYear(), now.getMonth() + 1, 1)
      } else {
        start = new Date(customDateRange.value[0])
        end = new Date(new Date(customDateRange.value[1]).getTime() + 86400000)
      }
      break
    }
  }
  return { start: start.getTime(), end: end.getTime() }
})

/** 期间显示文案 */
const periodLabel = computed(() => {
  switch (range.value) {
    case 'today':
      return '今日'
    case 'week':
      return '本周'
    case 'month':
      return '本月'
    case '30d':
      return '近 30 天'
    case 'year':
      return '今年'
    case 'lastYear':
      return '去年'
    case 'beforeLastYear':
      return '前年'
    case 'custom': {
      if (!customDateRange.value) return '自定义'
      return customDateRange.value.join(' ~ ')
    }
  }
})

/** 是否落在当前统计期间内 */
function inPeriod(e: { spent_at: string }) {
  const t = new Date(e.spent_at).getTime()
  return t >= period.value.start && t < period.value.end
}

/** daterange 快速选择:本月/上月/最近 7/30/90 天 */
const dateRangeShortcuts = [
  {
    text: '本月',
    value: () => {
      const now = new Date()
      return [new Date(now.getFullYear(), now.getMonth(), 1), now]
    }
  },
  {
    text: '上月',
    value: () => {
      const now = new Date()
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      const end = new Date(now.getFullYear(), now.getMonth(), 0)
      return [start, end]
    }
  },
  {
    text: '最近 7 天',
    value: () => {
      const now = new Date()
      return [new Date(now.getTime() - 6 * 86400000), now]
    }
  },
  {
    text: '最近 30 天',
    value: () => {
      const now = new Date()
      return [new Date(now.getTime() - 29 * 86400000), now]
    }
  },
  {
    text: '最近 90 天',
    value: () => {
      const now = new Date()
      return [new Date(now.getTime() - 89 * 86400000), now]
    }
  }
]

/** 切到"自定义"但还没选过时，给一个默认(本月初到今天) */
function onRangeChange(v: string | number | boolean | undefined) {
  if (v === 'custom' && !customDateRange.value) {
    const now = new Date()
    const start = new Date(now.getFullYear(), now.getMonth(), 1)
    const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    customDateRange.value = [fmt(start), fmt(now)]
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

// v2026-09-07 自由标签维度:跟 categoryData 一样的"占比"形态
// 一笔账可能有多个 tag,会被多个 tag 各算一份(所以"tag 维度总和"可能大于实际支出,这是 by-design)
// 没 tag 的账不计入 tag 维度
const tagData = computed(() => {
  const map = new Map<string, number>()
  store.items.forEach((e) => {
    if (!inPeriod(e)) return
    const tags = (e as { tags?: string[] }).tags || []
    for (const t of tags) {
      map.set(t, (map.get(t) || 0) + Number(e.amount))
    }
  })
  return Array.from(map.entries())
    .map(([name, value]) => ({ name: '#' + name, value, raw: name }))
    .sort((a, b) => b.value - a.value)
})

// v2026-09-07 饼图下方"分类/标签"维度切换
const dimType = ref<'category' | 'tag'>('category')
const pieData = computed(() => (dimType.value === 'tag' ? tagData.value : categoryData.value))
const pieTotal = computed(() => pieData.value.reduce((s, d) => s + d.value, 0))
const pieTopName = computed(() => pieData.value[0]?.name || '—')
const pieTopValue = computed(() => pieData.value[0]?.value || 0)

// 饼图通用调色板(分类 + 账户都用同一组,保证视觉一致)
const piePalette = [
  '#f56c2c', '#4f7cff', '#2fb55f', '#8a63f4', '#f5a623',
  '#00b8a9', '#e05a9c', '#5b8ff9', '#ff9d4d', '#269a99'
]

/** 饼图+明细条的"分母" —— 各自统计期间内的总金额(用于算占比) */
const categoryTotal = computed(() => categoryData.value.reduce((s, d) => s + d.value, 0))
const accountTotal = computed(() => accountData.value.reduce((s, d) => s + d.value, 0))

/**
 * 中心显示用:总金额 + 占比最多项摘要
 * 放在 graphic 里画(比 pie series label 更自由)
 */
function buildCenterGraphic(total: number, topLabel: string, topValue: number) {
  return {
    type: 'group',
    left: 'center',
    top: '40%',
    children: [
      {
        type: 'text',
        left: 'center',
        top: -4,
        style: {
          text: '总支出',
          fill: '#909399',
          fontSize: 12,
          fontWeight: 500,
          textAlign: 'center',
          textVerticalAlign: 'bottom'
        }
      },
      {
        type: 'text',
        left: 'center',
        top: 12,
        style: {
          text: '¥ ' + Number(total || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
          fill: '#1f2329',
          fontSize: 20,
          fontWeight: 700,
          fontFamily: 'ui-monospace, Cascadia Code, Consolas, monospace',
          textAlign: 'center',
          textVerticalAlign: 'middle'
        }
      },
      {
        type: 'text',
        left: 'center',
        top: 42,
        style: {
          text: `最高: ${topLabel} ¥${Number(topValue || 0).toFixed(2)}`,
          fill: '#f56c2c',
          fontSize: 11,
          fontWeight: 500,
          textAlign: 'center',
          textVerticalAlign: 'top'
        }
      }
    ]
  }
}

const categoryPieCenter = computed(() => {
  return buildCenterGraphic(pieTotal.value, pieTopName.value, pieTopValue.value)
})

const accountPieCenter = computed(() => {
  const total = accountData.value.reduce((s, d) => s + d.value, 0)
  const top = accountData.value[0]
  return buildCenterGraphic(total, top?.name || '—', top?.value || 0)
})

const pieOption = computed(() => ({
  tooltip: {
    trigger: 'item',
    backgroundColor: 'rgba(20, 21, 32, 0.95)',
    borderColor: 'transparent',
    textStyle: { color: '#fff', fontSize: 12 },
    padding: [10, 14],
    extraCssText: 'border-radius: 10px; box-shadow: 0 8px 24px rgba(0,0,0,0.25);',
    formatter: (p: any) => {
      const v = Number(p.value || 0).toFixed(2)
      return `<div style="line-height:1.5">
        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.color};margin-right:6px;vertical-align:middle"></span>
        <b>${p.name}</b>
        <div style="margin-top:4px;color:#ffcfb0">¥ ${v} · ${p.percent}%</div>
      </div>`
    }
  },
  graphic: [categoryPieCenter.value],
  series: [
    {
      name: '分类占比',
      type: 'pie',
      radius: ['52%', '74%'],
      center: ['50%', '42%'],
      avoidLabelOverlap: true,
      padAngle: 2,
      itemStyle: {
        borderRadius: 8,
        borderColor: '#fff',
        borderWidth: 3,
        shadowBlur: 12,
        shadowColor: 'rgba(245, 108, 44, 0.18)'
      },
      label: {
        show: true,
        position: 'outside',
        formatter: (p: any) => `${p.name}\n${p.percent}%`,
        color: '#4a5160',
        fontSize: 11,
        fontWeight: 500,
        lineHeight: 14
      },
      labelLine: {
        show: true,
        length: 8,
        length2: 10,
        lineStyle: { color: '#d4d7dc', width: 1 }
      },
      emphasis: {
        scale: true,
        scaleSize: 8,
        itemStyle: {
          shadowBlur: 20,
          shadowColor: 'rgba(0, 0, 0, 0.25)'
        },
        label: { fontSize: 12, fontWeight: 700, color: '#1f2329' }
      },
      data: pieData.value
    }
  ],
  color: piePalette
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
    backgroundColor: 'rgba(20, 21, 32, 0.95)',
    borderColor: 'transparent',
    textStyle: { color: '#fff', fontSize: 12 },
    padding: [10, 14],
    extraCssText: 'border-radius: 10px; box-shadow: 0 8px 24px rgba(0,0,0,0.25);',
    formatter: (p: any) => {
      const v = Number(p.value || 0).toFixed(2)
      return `<div style="line-height:1.5">
        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.color};margin-right:6px;vertical-align:middle"></span>
        <b>${p.name}</b>
        <div style="margin-top:4px;color:#a3c0ff">¥ ${v} · ${p.percent}%</div>
      </div>`
    }
  },
  graphic: [accountPieCenter.value],
  series: [
    {
      name: '支付账户占比',
      type: 'pie',
      radius: ['52%', '74%'],
      center: ['50%', '42%'],
      avoidLabelOverlap: true,
      padAngle: 2,
      itemStyle: {
        borderRadius: 8,
        borderColor: '#fff',
        borderWidth: 3,
        shadowBlur: 12,
        shadowColor: 'rgba(79, 124, 255, 0.18)'
      },
      label: {
        show: true,
        position: 'outside',
        formatter: (p: any) => `${p.name}\n${p.percent}%`,
        color: '#4a5160',
        fontSize: 11,
        fontWeight: 500,
        lineHeight: 14
      },
      labelLine: {
        show: true,
        length: 8,
        length2: 10,
        lineStyle: { color: '#d4d7dc', width: 1 }
      },
      emphasis: {
        scale: true,
        scaleSize: 8,
        itemStyle: {
          shadowBlur: 20,
          shadowColor: 'rgba(0, 0, 0, 0.25)'
        },
        label: { fontSize: 12, fontWeight: 700, color: '#1f2329' }
      },
      data: accountData.value.map((d) => ({ name: d.name, value: d.value }))
    }
  ],
  color: piePalette
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
// v2026-09-07:任意区间都下沉到 SQL,不再"month 走 SQL / 其他全量 + 前端过滤"
function loadForStats() {
  const opts: { customStart?: string | null; customEnd?: string | null } = {}
  if (range.value === 'custom' && customDateRange.value) {
    opts.customStart = customDateRange.value[0]
    opts.customEnd = customDateRange.value[1]
  }
  void store.loadForStats(range.value, opts)
}

onMounted(() => {
  // v2026-09-07 仅 mount 时单向同步 HomeView 的筛选区间到 StatsView 本地 state。
  // 设计意图:用户从 HomeView 跳过来时,统计页"接续"当前选中的区间,不要用户重新选一次;
  // 进了 StatsView 之后再调 range 不影响 HomeView(没反向同步,避免两边打架)。
  //
  // range 映射:HomeView filter 有 'all' / 'yesterday' / 'month' / '30d' / 'today' / 'week' / 'custom',
  // StatsView 本地只有 'today' / 'week' / 'month' / '30d' / 'year' / 'lastYear' / 'beforeLastYear' / 'custom'
  // 没交集的('all' / 'yesterday')fallback 默认 'month',让统计页"以月为单位"展示
  const f = store.filter
  if (f.range === 'custom' && f.customStart && f.customEnd) {
    range.value = 'custom'
    customDateRange.value = [f.customStart, f.customEnd]
  } else if (f.range === 'today' || f.range === 'week' || f.range === 'month' || f.range === '30d') {
    range.value = f.range
  } else if (f.range === 'year') {
    range.value = 'year'
  } else if (f.range === 'all' || f.range === 'yesterday') {
    // 不支持 → fallback 默认 month(本地 default 已经是 'month',不动)
  }
  loadForStats()
})

// 切顶部 range 时重新拉
watch(range, () => {
  loadForStats()
})
// 改 daterange 时也重新拉(custom 模式才生效,其他模式这条会被 onMounted 触发一次)
watch(customDateRange, () => {
  if (range.value === 'custom') loadForStats()
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
          <el-radio-button value="today">今日</el-radio-button>
          <el-radio-button value="week">本周</el-radio-button>
          <el-radio-button value="month">本月</el-radio-button>
          <el-radio-button value="30d">近 30 天</el-radio-button>
          <el-radio-button value="year">本年</el-radio-button>
          <el-radio-button value="lastYear">去年</el-radio-button>
          <el-radio-button value="beforeLastYear">前年</el-radio-button>
          <el-radio-button value="custom">自定义</el-radio-button>
        </el-radio-group>
        <el-date-picker
          v-if="range === 'custom'"
          v-model="customDateRange"
          type="daterange"
          range-separator="至"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
          format="YYYY-MM-DD"
          value-format="YYYY-MM-DD"
          unlink-panels
          :clearable="false"
          :shortcuts="dateRangeShortcuts"
          size="default"
          class="custom-range-picker"
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
        class="chart-card pie-card"
        v-loading="store.loading"
        element-loading-text="数据加载中…"
      >
        <div class="chart-title">
          <!-- v2026-09-07 分类/标签 维度切换:核心场景是看"旅游/出差/可报销"这类跨分类聚合 -->
          <el-segmented
            v-model="dimType"
            :options="[
              { label: '按分类', value: 'category' },
              { label: '按标签', value: 'tag' }
            ]"
            size="small"
            class="dim-toggle"
          />
          <span class="chart-meta" v-if="pieData.length > 0">
            共 <b>{{ pieData.length }}</b> 个{{ dimType === 'tag' ? '标签' : '分类' }}
          </span>
        </div>
        <v-chart class="chart pie-chart" :option="pieOption" autoresize />
      </div>
      <div
        class="chart-card"
        v-loading="store.loading"
        element-loading-text="数据加载中…"
      >
        <div class="chart-title">
          {{ dimType === 'tag' ? '标签支出明细' : '分类支出明细' }}
        </div>
        <div class="cat-bars">
          <div v-for="(c, i) in pieData" :key="c.name" class="cat-bar-row">
            <div class="cat-bar-label">
              <span
                v-if="dimType === 'category'"
                class="cat-bar-icon"
                :style="{ background: piePalette[i % piePalette.length] + '22', color: piePalette[i % piePalette.length] }"
              >{{ (c as any).icon }}</span>
              <span v-else class="cat-bar-icon tag-icon"
                :style="{ background: piePalette[i % piePalette.length] + '22', color: piePalette[i % piePalette.length] }"
              >#</span>
              <span>{{ c.name }}</span>
            </div>
            <div class="cat-bar-track">
              <div
                class="cat-bar-fill"
                :style="{
                  width: pieData[0] ? (c.value / pieData[0].value) * 100 + '%' : '0%',
                  background: `linear-gradient(90deg, ${piePalette[i % piePalette.length]}, ${piePalette[(i + 1) % piePalette.length]})`,
                  boxShadow: `0 0 8px ${piePalette[i % piePalette.length]}66`
                }"
              />
            </div>
            <div class="cat-bar-amount">
              <span class="bar-amount-value">{{ fmt(c.value) }}</span>
              <span class="bar-amount-pct">{{ pieTotal ? ((c.value / pieTotal) * 100).toFixed(1) : 0 }}%</span>
            </div>
          </div>
          <div v-if="pieData.length === 0" class="empty-mini">暂无数据</div>
        </div>
      </div>
    </div>

    <div class="chart-row">
      <div
        class="chart-card pie-card"
        v-loading="store.loading"
        element-loading-text="数据加载中…"
      >
        <div class="chart-title">
          支付账户占比
          <span class="chart-meta" v-if="accountData.length > 0">
            共 <b>{{ accountData.length }}</b> 个账户
          </span>
        </div>
        <v-chart class="chart pie-chart" :option="accountPieOption" autoresize />
      </div>
      <div
        class="chart-card"
        v-loading="store.loading"
        element-loading-text="数据加载中…"
      >
        <div class="chart-title">支付账户明细</div>
        <div class="cat-bars">
          <div v-for="(a, i) in accountData" :key="a.id" class="cat-bar-row">
            <div class="cat-bar-label">
              <span
                class="cat-bar-icon"
                :style="{ background: piePalette[i % piePalette.length] + '22', color: piePalette[i % piePalette.length] }"
              >{{ a.icon }}</span>
              <span>{{ a.name }}</span>
            </div>
            <div class="cat-bar-track">
              <div
                class="cat-bar-fill"
                :style="{
                  width: accountData[0] ? (a.value / accountData[0].value) * 100 + '%' : '0%',
                  background: `linear-gradient(90deg, ${piePalette[i % piePalette.length]}, ${piePalette[(i + 1) % piePalette.length]})`,
                  boxShadow: `0 0 8px ${piePalette[i % piePalette.length]}66`
                }"
              />
            </div>
            <div class="cat-bar-amount">
              <span class="bar-amount-value">{{ fmt(a.value) }}</span>
              <span class="bar-amount-pct">{{ accountTotal ? ((a.value / accountTotal) * 100).toFixed(1) : 0 }}%</span>
            </div>
          </div>
          <div v-if="accountData.length === 0" class="empty-mini">暂无数据</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* v2026-09-03 质感升级 */
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
  margin-bottom: 24px;
}
.page-title {
  font-size: 26px;
  font-weight: 700;
  margin: 0 0 4px;
  letter-spacing: -0.3px;
  background: linear-gradient(135deg, #1f2329 0%, #4a5160 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.page-sub {
  color: var(--color-text-soft);
  font-size: 13px;
  margin: 0;
}
.range-pills {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.range-pills .month-picker { flex-shrink: 0; }
.range-pills .custom-range-picker { flex-shrink: 0; width: 280px; margin-left: 8px; }

/* v2026-09-07 饼图"按分类 / 按标签"切换 */
.chart-title .dim-toggle {
  margin-right: auto;
}
.chart-title .dim-toggle :deep(.el-segmented__item) {
  font-size: 12px;
}
.cat-bar-icon.tag-icon {
  font-weight: 700;
  font-size: 13px;
}
.range-pills :deep(.el-radio-group) {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0;
}
.range-pills :deep(.el-radio-button) { margin: 0; padding: 0; flex-shrink: 0; }
.range-pills :deep(.el-radio-button + .el-radio-button) { margin-left: 0; }
.range-pills :deep(.el-radio-button__inner) {
  border: none !important;
  background: transparent !important;
  border-radius: 10px !important;
  padding: 8px 16px !important;
  box-shadow: none !important;
  color: var(--color-text-soft) !important;
  font-weight: 500 !important;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1) !important;
}
.range-pills :deep(.el-radio-button__inner:hover) {
  color: var(--color-primary) !important;
  background: rgba(245, 108, 44, 0.06) !important;
}
.range-pills :deep(.el-radio-button__original-radio:checked + .el-radio-button__inner) {
  background: linear-gradient(135deg, var(--color-primary-soft) 0%, #ffe2d0 100%) !important;
  color: var(--color-primary) !important;
  font-weight: 600 !important;
  box-shadow: inset 0 0 0 1px rgba(245, 108, 44, 0.2) !important;
}

.top-row {
  display: grid;
  grid-template-columns: 1.3fr 1fr 1fr;
  gap: 16px;
  margin-bottom: 24px;
}
.big-stat,
.top3 {
  position: relative;
  background: #fff;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: 26px 28px;
  box-shadow: 0 1px 2px rgba(16, 24, 40, 0.04), 0 6px 18px rgba(16, 24, 40, 0.05);
  transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  overflow: hidden;
}
.big-stat::before {
  content: '';
  position: absolute;
  top: -50%;
  right: -30%;
  width: 240px;
  height: 240px;
  border-radius: 50%;
  background: radial-gradient(circle, var(--color-primary) 0%, transparent 70%);
  filter: blur(40px);
  opacity: 0.15;
  pointer-events: none;
  transition: opacity 0.3s;
}
.big-stat:hover::before { opacity: 0.28; }
.big-stat {
  display: flex;
  align-items: center;
  gap: 14px;
}
.big-stat:hover,
.top3:hover {
  transform: translateY(-3px);
  box-shadow: 0 1px 2px rgba(16, 24, 40, 0.04), 0 14px 32px rgba(16, 24, 40, 0.08), 0 0 0 1px rgba(245, 108, 44, 0.18);
}
.big-stat.highlight {
  background: linear-gradient(135deg, #ff8f4d 0%, #f56c2c 100%);
  border: none;
  color: #fff;
  box-shadow: 0 12px 32px -6px rgba(245, 108, 44, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.25);
}
.big-stat.highlight::before { display: none; }
.big-stat.highlight:hover {
  box-shadow: 0 16px 40px -6px rgba(245, 108, 44, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.3);
  transform: translateY(-3px);
}
.big-stat-icon {
  width: 52px;
  height: 52px;
  border-radius: 14px;
  background: var(--color-primary-soft);
  color: var(--color-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  flex-shrink: 0;
  position: relative;
  z-index: 1;
  box-shadow: 0 6px 16px -4px rgba(245, 108, 44, 0.35);
  transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.big-stat:hover .big-stat-icon {
  transform: scale(1.08) rotate(-4deg);
}
.big-stat.highlight .big-stat-icon {
  background: rgba(255, 255, 255, 0.22);
  color: #fff;
  box-shadow: none;
}
.big-stat-label {
  color: var(--color-text-soft);
  font-size: 13px;
  margin-bottom: 8px;
  font-weight: 500;
  position: relative;
  z-index: 1;
}
.big-stat.highlight .big-stat-label { color: rgba(255, 255, 255, 0.88); }
.big-stat-value {
  font-size: 36px;
  font-weight: 700;
  color: var(--color-primary);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.3px;
  position: relative;
  z-index: 1;
  background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-yellow) 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.big-stat.highlight .big-stat-value { color: #fff; }
.top3-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text);
  margin-bottom: 16px;
  display: flex;
  align-items: baseline;
  gap: 6px;
}
.top3-title::before {
  content: '';
  display: inline-block;
  width: 3px;
  height: 14px;
  border-radius: 2px;
  background: linear-gradient(180deg, var(--color-primary), var(--color-yellow));
  margin-right: 4px;
  align-self: center;
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
  border-bottom: 1px dashed transparent;
  transition: background 0.2s;
}
.top3-row:hover {
  background: linear-gradient(90deg, rgba(245, 108, 44, 0.04) 0%, transparent 100%);
  border-radius: 6px;
  padding-left: 6px;
  padding-right: 6px;
}
.rank {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
  color: #fff;
  background: #c0c4cc;
  flex-shrink: 0;
}
.rank-1 { background: linear-gradient(135deg, #f5a623, #ff8a3d); box-shadow: 0 0 12px rgba(245, 166, 35, 0.5); }
.rank-2 { background: linear-gradient(135deg, #b8bcc4, #8a909a); }
.rank-3 { background: linear-gradient(135deg, #d4985f, #a06b3a); }
.top3-name {
  flex: 1;
  font-size: 14px;
  color: var(--color-text);
  font-weight: 500;
}
.top3-amount {
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--color-text);
}
@media (max-width: 1100px) {
  .top-row { grid-template-columns: 1fr 1fr; }
  .big-stat { grid-column: 1 / -1; }
}
@media (max-width: 640px) {
  .top-row { grid-template-columns: 1fr; }
}

.chart-card {
  position: relative;
  background: #fff;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: 24px 28px;
  box-shadow: 0 1px 2px rgba(16, 24, 40, 0.04), 0 6px 18px rgba(16, 24, 40, 0.05);
  margin-bottom: 16px;
  transition: box-shadow 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  overflow: hidden;
}
.chart-card:hover {
  box-shadow: 0 1px 2px rgba(16, 24, 40, 0.04), 0 14px 32px rgba(16, 24, 40, 0.08), 0 0 0 1px rgba(245, 108, 44, 0.18);
}
.chart-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--color-text);
  margin-bottom: 18px;
  display: flex;
  align-items: center;
  gap: 8px;
  letter-spacing: 0.2px;
}
.chart-title::before {
  content: '';
  display: inline-block;
  width: 3px;
  height: 14px;
  border-radius: 2px;
  background: linear-gradient(180deg, var(--color-primary), var(--color-yellow));
}
.chart-title .chart-meta {
  margin-left: auto;
  font-size: 12px;
  font-weight: 400;
  color: var(--color-text-soft);
  background: var(--color-primary-soft);
  padding: 3px 10px;
  border-radius: 999px;
  border: 1px solid rgba(245, 108, 44, 0.12);
}
.chart-title .chart-meta b {
  color: var(--color-primary);
  font-weight: 700;
  margin: 0 2px;
  font-variant-numeric: tabular-nums;
}
.chart {
  height: 320px;
}
/* 饼图 card 更高,容纳中心数字 + 外侧 label */
.pie-card {
  position: relative;
  overflow: hidden;
}
.pie-card::after {
  content: '';
  position: absolute;
  top: -40px;
  right: -40px;
  width: 200px;
  height: 200px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(245, 108, 44, 0.06) 0%, transparent 70%);
  filter: blur(30px);
  pointer-events: none;
}
.pie-chart {
  height: 360px;
}
.chart-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-bottom: 16px;
}
.chart-row .chart-card { margin-bottom: 0; }
.chart-row:last-child { margin-bottom: 0; }

.cat-bars {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 320px;
  overflow-y: auto;
  padding: 4px 4px 4px 0;
}
.cat-bar-row {
  display: grid;
  grid-template-columns: 120px 1fr 90px;
  align-items: center;
  gap: 12px;
  font-size: 13px;
  padding: 4px 0;
  transition: background 0.2s;
  border-radius: 6px;
  padding-left: 4px;
  padding-right: 4px;
}
.cat-bar-row:hover {
  background: rgba(245, 108, 44, 0.04);
}
.cat-bar-label {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--color-text);
  font-weight: 500;
}
.cat-bar-icon {
  font-size: 16px;
  width: 26px;
  height: 26px;
  border-radius: 7px;
  background: var(--color-primary-soft);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.cat-bar-track {
  background: linear-gradient(90deg, #f4f5f7 0%, #eceef1 100%);
  height: 8px;
  border-radius: 999px;
  overflow: hidden;
  border: 1px solid var(--color-border);
}
.cat-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, #ff9d4d, #f56c2c);
  border-radius: 999px;
  transition: width 0.6s cubic-bezier(0.16, 1, 0.3, 1);
  box-shadow: 0 0 8px rgba(245, 108, 44, 0.4);
  position: relative;
}
.cat-bar-fill::after {
  content: '';
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  width: 20%;
  background: linear-gradient(90deg, transparent 0%, rgba(255, 255, 255, 0.35) 100%);
  border-radius: 999px;
}
.cat-bar-fill.acc-fill {
  background: linear-gradient(90deg, #8ec5ff, #5b8ff9);
  box-shadow: 0 0 8px rgba(79, 124, 255, 0.4);
}
.cat-bar-amount {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.cat-bar-amount .bar-amount-value {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text);
  line-height: 1.2;
}
.cat-bar-amount .bar-amount-pct {
  font-size: 10px;
  font-weight: 700;
  color: var(--color-primary);
  background: var(--color-primary-soft);
  padding: 1px 6px;
  border-radius: 999px;
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
}
.empty-mini {
  text-align: center;
  color: #c0c4cc;
  padding: 50px 0;
  font-size: 13px;
}

/* 可访问性:关闭所有动画 */
@media (prefers-reduced-motion: reduce) {
  .big-stat,
  .big-stat::before,
  .big-stat-icon,
  .top3,
  .top3-row,
  .chart-card,
  .cat-bar-fill,
  .cat-bar-row {
    animation: none !important;
    transition: none !important;
  }
  .big-stat:hover,
  .big-stat:hover .big-stat-icon,
  .top3:hover,
  .cat-bar-fill::after {
    transform: none;
  }
}
</style>
