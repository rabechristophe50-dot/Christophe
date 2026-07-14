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
echo    *** TradingView est pret ! ***
echo.
echo    AVANT DE LANCER LE PONT, prepare TradingView :
echo      1) Graphique sur XAUUSD, timeframe M15, indicateur RUGA visible
echo      2) Ouvre le panneau ALERTES (icone cloche a droite)
echo         puis l'onglet JOURNAL, et LAISSE-LE OUVERT
echo      3) Verifie que tes 2 alertes RUGA sont ACTIVES
echo      4) MetaTrader 5 ouvert : EA sur XAUUSD + bouton "Algo Trading" VERT
echo.
echo    (L'ordre est important : le pont ignore les tirs deja affiches au
echo     demarrage, donc ouvre le JOURNAL AVANT d'appuyer sur une touche.)
echo.
echo    Quand TOUT est pret, appuie sur une touche pour DEMARRER LE PONT...
pause >nul

REM --- Lancer le pont ---
cd /d "%PROJ%"
call npm run bridge

echo.
echo Le pont s'est arrete. Appuie sur une touche pour fermer.
pause >nul
