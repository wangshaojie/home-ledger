; 家庭记账 - NSIS 安装器美化脚本
; 用短字符串 + 不用嵌套引号

; 欢迎页
!define MUI_WELCOMEPAGE_TITLE "欢迎使用家庭记账"
!define MUI_WELCOMEPAGE_TEXT "本程序将引导您完成家庭记账的安装。$\r$\n$\r$\n家庭记账是一款专为Windows桌面设计的极简家庭支出记账工具，支持邮箱登录、家庭群组、多账户、统计图表，数据云端存储。$\r$\n$\r$\n点击下一步继续。"

; 安装目录页
!define MUI_DIRECTORYPAGE_TEXT_TOP "程序将安装到下面的文件夹。如需安装到不同文件夹，请点击浏览选择。"

; 正在安装页
!define MUI_INSTALLINGPAGE_TEXT_TOP "正在安装家庭记账，请稍候..."

; 安装完成页
!define MUI_FINISHPAGE_TITLE "安装完成"
!define MUI_FINISHPAGE_TEXT "家庭记账已成功安装到您的电脑。$\r$\n$\r$\n点击完成关闭安装程序。"
!define MUI_FINISHPAGE_BUTTON "完成"
!define MUI_FINISHPAGE_RUN_TEXT "立即启动家庭记账"
!define MUI_FINISHPAGE_SHOWREADME_TEXT "查看使用说明"

; 卸载确认页
!define MUI_UNINSTALLER_CONFIRM_TITLE "卸载家庭记账"
!define MUI_UNINSTALLER_CONFIRM_TEXT "确定要从您的电脑中卸载家庭记账吗？$\r$\n$\r$\n本机缓存（包括登录会话、显示名、最近使用分类等）会被一并清除。$\r$\n$\r$\n您的记账数据存储在云端，卸载不会删除账本数据。"

; 卸载完成页
!define MUI_UNINSTALLED_SUCCESS_TITLE "卸载完成"
!define MUI_UNINSTALLED_SUCCESS_TEXT "家庭记账已卸载。$\r$\n$\r$\n本机缓存已清除。您的账本数据已安全保存在云端。$\r$\n$\r$\n感谢您使用家庭记账！"
