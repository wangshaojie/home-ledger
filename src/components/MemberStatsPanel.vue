<!--
  v1.1 成员支出统计
  - 双维度：creator（谁付的）vs member（钱算谁的）
  - 单成员家庭：退化为一个总支出图
  - 月/全部 tab 切换
  - 点击柱子 → 跳列表并预填 memberIds
-->
<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick } from 'vue'
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

use([CanvasRenderer, BarChart, GridComponent, TooltipComponent, TitleComponent, LegendComponent])
provide(THEME_KEY, 'light')

const expenseStore = useExpenseStore()
const familyStore = useFamilyStore()

// 跟 HomeView 列表共用同一个时间筛选（store.filter.range）
// 这样用户在顶部切"今日/本周/..."时,柱状图也同步
const range = computed({
  get: () => expenseStore.filter.range,
  set: (v) => (expenseStore.filter.range = v)
})
const startDate = computed(() => {
  const r = expenseStore.filter.range
  const now = new Date()
  if (r === 'today') {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    return start.toISOString()
  }
  if (r === 'yesterday') {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    return new Date(start.getTime() - 86400000).toISOString()
  }
  if (r === 'week') {
    return new Date(now.getTime() - 7 * 86400000).toISOString()
  }
  if (r === 'month') {
    return new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  }
  if (r === '30d') {
    return new Date(now.getTime() - 30 * 86400000).toISOString()
  }
  // 'all' 或其它:不限时间
  return null
})

// 聚合数据
interface MemberAgg { memberId: string; total: number; name: string }

const byCreator = ref<MemberAgg[]>([])
const byMember = ref<MemberAgg[]>([])

async function loadStats() {
  // 兜底：确保 familyStore.members 已加载（App.vue onMounted 后也再拉一次）
  if (familyStore.members.length === 0) {
    await familyStore.load()
  }
  // 跟 HomeView 列表筛选保持一致:把 categoryIds/memberIds/amount 一起传给 aggregate
  const f = expenseStore.filter
  const extraFilter = {
    categoryIds: f.categoryIds,
    memberIds: f.memberIds,
    minAmount: f.minAmount,
    maxAmount: f.maxAmount
  }
  const [creator, member] = await Promise.all([
    expenseStore.aggregateByCreator(startDate.value, extraFilter),
    expenseStore.aggregateByMember(startDate.value, extraFilter)
  ])
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

onMounted(loadStats)
// 监听:时间范围、成员变化、列表筛选(分类/成员/金额)任意变化都重新聚合
watch(
  [
    range,
    () => familyStore.members.length,
    () => expenseStore.filter.categoryIds.slice(),
    () => expenseStore.filter.memberIds.slice(),
    () => expenseStore.filter.minAmount,
    () => expenseStore.filter.maxAmount
  ],
  loadStats
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

// 横向 bar 配置
function buildOption(rows: MemberAgg[], total: number, title: string) {
  // 按金额降序
  const sorted = [...rows].sort((a, b) => b.total - a.total)
  return {
    grid: { left: 40, right: 30, top: 30, bottom: 30, containLabel: true },
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
          memberId: r.memberId
        })),
        itemStyle: { color: '#409EFF', borderRadius: [0, 4, 4, 0] },
        label: {
          show: true,
          position: 'right',
          formatter: (p: any) => '¥' + (p.value as number).toFixed(0)
        }
      }
    ]
  }
}

const creatorOption = computed(() => buildOption(byCreator.value, creatorTotal.value, '按付款人'))
const memberOption = computed(() => buildOption(byMember.value, memberTotal.value, '按消费归属'))
const singleOption = computed(() => buildOption(byMember.value, singleTotal.value, '总支出'))
</script>

<template>
  <div class="member-stats-panel">
    <div class="panel-head">
      <h3>成员支出统计</h3>
      <el-radio-group v-model="range" size="small">
        <el-radio-button value="all">全部</el-radio-button>
        <el-radio-button value="today">今日</el-radio-button>
        <el-radio-button value="week">本周</el-radio-button>
        <el-radio-button value="month">本月</el-radio-button>
        <el-radio-button value="30d">近 30 天</el-radio-button>
      </el-radio-group>
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
        <div class="value">¥{{ singleTotal.toFixed(2) }}</div>
      </div>
    </div>

    <div v-else class="dual-chart">
      <div class="chart-cell">
        <div class="chart-title">
          <span>按付款人（我付的）</span>
          <span class="total">¥{{ creatorTotal.toFixed(2) }}</span>
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
          <span>按消费归属（钱算谁的）</span>
          <span class="total">¥{{ memberTotal.toFixed(2) }}</span>
        </div>
        <v-chart
          v-if="byMember.length > 0"
          class="chart"
          :option="memberOption"
          :init-options="{ renderer: 'canvas' }"
          @click="(p: any) => onBarClick(p.data?.memberId)"
        />
        <div v-else class="empty-tip">本月还没有支出数据</div>
        <div class="hint">点击柱子查看该成员的账单</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.member-stats-panel {
  background: white;
  border-radius: 8px;
  padding: 20px;
  margin-bottom: 16px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
}
.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}
.panel-head h3 {
  margin: 0;
  font-size: 16px;
  color: #303133;
  font-weight: 600;
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
  color: #606266;
  margin-bottom: 8px;
  padding: 0 4px;
}
.chart-title .total {
  font-weight: 600;
  color: #303133;
  font-size: 15px;
}
.chart {
  height: 280px;
  width: 100%;
  cursor: pointer;
}
.hint {
  font-size: 12px;
  color: #909399;
  margin-top: 4px;
  text-align: center;
}
.empty-tip {
  height: 280px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #909399;
  background: #fafafa;
  border-radius: 4px;
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
  color: #909399;
}
.single-total .value {
  font-size: 22px;
  font-weight: 600;
  color: #303133;
  margin-top: 4px;
}
@media (max-width: 768px) {
  .dual-chart {
    grid-template-columns: 1fr;
  }
}
</style>
