import { contextBridge } from 'electron'

// 原型阶段只暴露一个版本号和平台信息，方便前端调试
contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  version: process.versions.electron
})
