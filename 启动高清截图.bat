@echo off
chcp 65001 >nul
title 通用高清网页截图助手
cd /d "%~dp0"
echo.
echo ======================================
echo       通用高清网页截图助手 v2.1
echo ======================================
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未检测到 Node.js，请先安装 Node.js 20 或更高版本。
  echo 下载地址：https://nodejs.org/
  echo 安装后关闭此窗口，双击本文件即可。
  pause
  exit /b 1
)
if not exist "node_modules\playwright\package.json" (
  echo [首次使用] 正在安装依赖，可能需要数分钟...
  where npm >nul 2>nul
  if errorlevel 1 (
    echo [错误] 未找到 npm，请重新安装 Node.js。
    pause
    exit /b 1
  )
  call npm ci --no-audit --no-fund
  if errorlevel 1 (
    echo [错误] 依赖安装失败，请检查网络后重试。
    pause
    exit /b 1
  )
)
echo.
echo 提示：直接回车默认进入瞳序，也可以输入任意其他网址。
echo 页面右上角提供 高清PNG、框选、整页、PDF 功能。
echo.
node "%~dp0hd-screenshot-assistant.js" %*
set "app_exit_code=%errorlevel%"
if not "%app_exit_code%"=="0" echo [提示] 程序异常退出，检查上面的报错。
echo.
echo 程序已结束，按任意键关闭窗口。
pause >nul
exit /b %app_exit_code%
