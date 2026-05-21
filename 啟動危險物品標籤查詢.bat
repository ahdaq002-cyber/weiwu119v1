@echo off
chcp 65001 > nul
set "NODE_EXE=C:\Users\USER\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
set "APP_DIR=%~dp0"
if not exist "%NODE_EXE%" (
  echo 找不到內建 Node.js，請先確認 Codex runtime 是否已安裝。
  pause
  exit /b 1
)
start "危險物品標籤查詢服務" cmd /k ""%NODE_EXE%" "%APP_DIR%危險物品標籤查詢服務.js""
timeout /t 2 > nul
start "" "http://127.0.0.1:8787/危險物品標籤初判.html"
