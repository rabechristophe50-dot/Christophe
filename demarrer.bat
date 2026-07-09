@echo off
title Robot TradingView vers MT5
color 0A
echo ============================================
echo    ROBOT TradingView  -^>  MT5  (RUGA)
echo ============================================
echo.

set "TV=C:\Program Files\WindowsApps\TradingView.Desktop_3.3.0.7992_x64__n534cwy3pjxzj\TradingView.exe"
set "PROJ=C:\Users\Biloka\Christophe"

REM --- 1. Fermer TradingView existant ---
echo [1/3] Fermeture de l'ancien TradingView...
taskkill /F /IM TradingView.exe >nul 2>&1
timeout /t 2 /nobreak >nul

REM --- 2. Lancer TradingView en mode debogage (independant) ---
echo [2/3] Lancement de TradingView (mode debogage)...
if not exist "%TV%" (
  echo    ATTENTION: TradingView introuvable a ce chemin.
  echo    %TV%
  echo    Le numero de version a peut-etre change apres une mise a jour.
  pause
)
start "" "%TV%" --remote-debugging-port=9222

REM --- 3. Attendre que la connexion soit prete (max ~60s) ---
echo [3/3] Attente de la connexion TradingView...
set /a tries=0
:wait
timeout /t 3 /nobreak >nul
set /a tries+=1
curl -s http://localhost:9222/json/version >nul 2>&1
if not errorlevel 1 goto ready
if %tries% GEQ 20 (
  echo    Toujours pas connecte apres 60s, on lance quand meme (le pont reessaiera).
  goto ready
)
echo    ... TradingView demarre encore (%tries%/20)...
goto wait

:ready
echo.
echo    *** TradingView pret ! Ouvre ton graphique XAUUSD + RUGA ***
echo.

REM --- Lancer le pont ---
cd /d "%PROJ%"
call npm run bridge

echo.
echo Le pont s'est arrete. Appuie sur une touche pour fermer.
pause >nul
