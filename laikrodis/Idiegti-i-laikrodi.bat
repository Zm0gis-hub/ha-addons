@echo off
chcp 65001 >nul
setlocal
title Pirkiniai - diegimas i laikrodi
set "DIR=%TEMP%\pirkiniai-laikrodis"
if not exist "%DIR%" mkdir "%DIR%"
cd /d "%DIR%"

echo.
echo  === Programėlės „Pirkiniai“ diegimas į laikrodį ===
echo.
echo  Prieš pradedant laikrodyje turi būti:
echo   - įjungtos Kūrėjo parinktys (Nustatymai - Apie laikrodį - 7 kartus bakstelėti „Versijos numeris“)
echo   - Kūrėjo parinktyse įjungta „ADB derinimas“ ir „Belaidis derinimas“
echo   - laikrodis prijungtas prie to paties Wi-Fi kaip šis kompiuteris
echo.
pause

if not exist "%DIR%\platform-tools\adb.exe" (
  echo.
  echo  Atsisiunčiamas diegimo įrankis ^(adb^)...
  curl.exe -L -o platform-tools.zip https://dl.google.com/android/repository/platform-tools-latest-windows.zip
  if errorlevel 1 goto klaida_siuntimas
  tar.exe -xf platform-tools.zip
  if not exist "%DIR%\platform-tools\adb.exe" goto klaida_siuntimas
)
set "ADB=%DIR%\platform-tools\adb.exe"

echo.
echo  Atsisiunčiama programėlė...
curl.exe -L -f -o pirkiniai-laikrodis.apk https://github.com/Zm0gis-hub/ha-addons/releases/download/laikrodis/pirkiniai-laikrodis.apk
if errorlevel 1 goto klaida_siuntimas

echo.
echo  1 ŽINGSNIS. Laikrodyje: Kūrėjo parinktys - Belaidis derinimas - „Susieti naują įrenginį“.
echo  Laikrodis parodys kodą ir adresą su prievadu, pvz. 192.168.1.50:37123
echo.
set /p "PAIR= Įveskite adresą su prievadu iš SUSIEJIMO lango: "
set /p "CODE= Įveskite 6 skaitmenų susiejimo kodą: "
"%ADB%" pair %PAIR% %CODE%
if errorlevel 1 goto klaida_pair

echo.
echo  2 ŽINGSNIS. Laikrodyje grįžkite atgal į langą „Belaidis derinimas“.
echo  Ten rodomas „IP adresas ir prievadas“ ^(prievadas KITOKS nei susiejimo lange^).
echo.
set /p "CONN= Įveskite tą adresą su prievadu: "
"%ADB%" connect %CONN%
timeout /t 2 >nul

echo.
echo  Diegiama į laikrodį...
"%ADB%" -s %CONN% install -r pirkiniai-laikrodis.apk
if errorlevel 1 goto klaida_install

"%ADB%" disconnect >nul 2>&1
"%ADB%" kill-server >nul 2>&1
echo.
echo  PAVYKO. Laikrodžio programų sąraše atsirado „Pirkiniai“.
echo  Dabar laikrodyje galite išjungti „Belaidis derinimas“ ^(taupo bateriją^).
echo.
pause
exit /b 0

:klaida_siuntimas
echo.
echo  NEPAVYKO atsisiųsti. Patikrinkite interneto ryšį ir paleiskite iš naujo.
pause
exit /b 1

:klaida_pair
echo.
echo  NEPAVYKO susieti. Patikrinkite adresą ir kodą ^(kodas keičiasi kaskart atidarius langą^) ir paleiskite iš naujo.
"%ADB%" kill-server >nul 2>&1
pause
exit /b 1

:klaida_install
echo.
echo  NEPAVYKO įdiegti. Patikrinkite, ar 2 žingsnyje įvestas adresas iš lango „Belaidis derinimas“, ir paleiskite iš naujo.
"%ADB%" kill-server >nul 2>&1
pause
exit /b 1
