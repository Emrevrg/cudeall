@echo off
REM CudeAll eklenti tek-tik kurulum — klasor yolunu panoya kopyalar,
REM Chrome eklenti sayfasini acar, 3 adimi gosterir. (Chrome kurali:
REM "Paketlenmemis oge yukle" tikini insan basar, gerisi hazir.)
cd /d "%~dp0"
set EXT=%CD%\chrome-extension
echo %EXT% | clip
echo Eklenti klasoru panoya kopyalandi:
echo %EXT%
echo.
start chrome "chrome://extensions"
powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show(\"1) Sag ustte GELISTIRICI MODU'nu ac`n2) 'Paketlenmemis oge yukle' tikla`n3) Panodaki klasoru yapistir, Sec`n`nKlasor:`n%EXT%\", 'CudeAll eklenti kurulumu (1 dk)', 'OK', 'Information')"
echo Bitti. opencode'da dene: cude_browser(action=status) — "bagli" gormelisin.
pause
