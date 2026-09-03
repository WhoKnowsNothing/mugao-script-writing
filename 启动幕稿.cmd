@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo 需要先安装 Node.js 22.13 或更新版本。
  pause
  exit /b 1
)
if not exist "node_modules" (
  echo 首次运行，正在安装依赖...
  call npm.cmd ci
  if errorlevel 1 (
    echo 安装失败，请查看上面的提示。
    pause
    exit /b 1
  )
)
echo.
echo 幕稿启动后，请打开 http://localhost:3000/
echo 请保持本窗口打开。按 Ctrl+C 停止服务。
echo 文案保存在浏览器中，建议定期导出 JSON 备份。
echo.
call npm.cmd run dev
pause
