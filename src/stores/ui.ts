import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useUiStore = defineStore('ui', () => {
  const globalLoading = ref(false)

  function showLoading() {
    globalLoading.value = true
  }
  function hideLoading() {
    globalLoading.value = false
  }

  return { globalLoading, showLoading, hideLoading }
})
