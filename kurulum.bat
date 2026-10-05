@echo off
REM CudeAll tek tik kurulum — provider anahtari gerekmez; indirme adimi secimlidir.
cd /d "%~dp0"
echo === CudeAll kurulum (cude.new ailesi: butun kod araclari tek cati) ===
echo [1/6] node kontrol...
node --version || (echo Node.js yok: https://nodejs.org indir, sonra tekrar calistir. & pause & exit /b 1)
echo [2/6] MCP baslatma kontrolu (14 arac)...
echo {"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}} | node mcp-cudeall\server.mjs | findstr "cude_setup" >nul && echo MCP OK || (echo MCP HATASI & pause & exit /b 1)
echo [3/6] Ortam durumu...
echo {"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"cude_setup","arguments":{"action":"status"}}} | node mcp-cudeall\server.mjs
echo [4/6] Istege bagli tarayici motoru (Chromium ~170MB)...
set /p BROWSER="Playwright/Chromium simdi indirilsin mi? (E/H, H dersen statik web modu kullanilir): "
if /i "%BROWSER%"=="E" echo {"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"cude_setup","arguments":{"action":"install_browser"}}} | node mcp-cudeall\server.mjs
echo [5/6] Global kurulum (opencode Desktop dahil her yerde)...
node "%~dp0global-install.cjs" || echo Global kurulum atlandi, proje seviyesinde calisir.
echo [6/6] Chrome eklentisi (tek tik)...
call "%~dp0eklenti-kur.bat"
echo.
echo Bitti. opencode'u BU klasorde ac; yazma ve bilgisayar araclari OpenCode onayi ister.
echo Ilk komut: cude_setup(action=status) — sonra: cude_history(action=continue) ile yarim isi devral.
pause
