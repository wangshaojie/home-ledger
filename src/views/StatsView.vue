<script setup lang="ts">
import { computed, ref } from 'vue'
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

const range = ref<'month' | 'year'>('month')

const dailySeries = computed(() => {
  const days = range.value === 'month' ? 30 : 365
  const arr: { date: string; amount: number }[] = []
  const now = new Date()
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86400000)
    const key = `${d.getMonth() + 1}/${d.getDate()}`
    arr.push({ date: key, amount: 0 })
  }
  store.items.forEach((e) => {
    const ed = new Date(e.spent_at)
    const diff = Math.floor((now.getTime() - ed.getTime()) / 86400000)
    if (diff >= 0 && diff < days) {
      const idx = days - 1 - diff
      arr[idx].amount += Number(e.amount)
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
      interval: range.value === 'year' ? 29 : 4
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
    '#f56c2c','#5b8ff9','#5ad8a6','#f6bd16','#e86452',
    '#6dc8ec','#9270ca','#ff9d4d','#269a99','#ff99c3'
  ]
}))

const accountData = computed(() => {
  const map = new Map<string, number>()
  store.items.forEach((e) => {
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
    '#5b8ff9','#5ad8a6','#f56c2c','#f6bd16','#9270ca',
    '#6dc8ec','#e86452','#ff9d4d','#269a99','#ff99c3'
  ]
}))

const memberRanking = computed(() => {
  const map = new Map<string, number>()
  store.items.forEach((e) => {
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

const totalInRange = computed(() => {
  return range.value === 'month' ? store.monthTotal : store.yearTotal
})

function fmt(n: number) {
  return '¥ ' + Number(n).toFixed(2)
}
</script>

<template>
  <div class="stats">
    <div class="page-header">
      <h2 class="page-title">家庭支出统计</h2>
      <el-radio-group v-model="range">
        <el-radio-button value="month">本月</el-radio-button>
        <el-radio-button value="year">本年</el-radio-button>
      </el-radio-group>
    </div>

    <div class="top-row">
      <div class="big-stat">
        <div class="big-stat-label">{{ range === 'month' ? '本月总支出' : '本年总支出' }}</div>
        <div class="big-stat-value">{{ fmt(totalInRange) }}</div>
      </div>
      <div class="top3">
        <div class="top3-title">支出排行 TOP 3</div>
        <div v-for="(m, i) in memberRanking.slice(0, 3)" :key="m.id" class="top3-row">
          <span class="rank" :class="`rank-${i + 1}`">{{ i + 1 }}</span>
          <span class="top3-name">{{ m.name }}</span>
          <span class="top3-amount">{{ fmt(m.total) }}</span>
        </div>
        <div v-if="memberRanking.length === 0" class="empty-mini">暂无数据</div>
      </div>
    </div>

    <div class="chart-card">
      <div class="chart-title">每日支出趋势</div>
      <v-chart class="chart" :option="lineOption" autoresize />
    </div>

    <div class="chart-row">
      <div class="chart-card">
        <div class="chart-title">分类支出占比</div>
        <v-chart class="chart" :option="pieOption" autoresize />
      </div>
      <div class="chart-card">
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
      <div class="chart-card">
        <div class="chart-title">支付账户占比</div>
        <v-chart class="chart" :option="accountPieOption" autoresize />
      </div>
      <div class="chart-card">
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
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}
.page-title {
  font-size: 24px;
  margin: 0;
}

.top-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-bottom: 20px;
}
.big-stat,
.top3 {
  background: #fff;
  border-radius: 12px;
  padding: 24px;
  box-shadow: var(--shadow-card);
}
.big-stat-label {
  color: var(--color-text-soft);
  font-size: 13px;
  margin-bottom: 8px;
}
.big-stat-value {
  font-size: 36px;
  font-weight: 600;
  color: var(--color-primary);
  font-variant-numeric: tabular-nums;
}
.top3-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text);
  margin-bottom: 16px;
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
.rank-1 { background: #f6bd16; }
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

.chart-card {
  background: #fff;
  border-radius: 12px;
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
}
.chart-row .chart-card {
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
