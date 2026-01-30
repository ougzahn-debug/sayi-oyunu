@echo off
title Sayi Oyunu Sunucusu
color 0A

echo.
echo  ====================================
echo    SAYI OYUNU SUNUCUSU BASLATILIYOR
echo  ====================================
echo.

REM Node.js yuklu mu kontrol et
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [HATA] Node.js bulunamadi!
    echo Lutfen Node.js yukleyin: https://nodejs.org/
    pause
    exit /b 1
)

echo [OK] Node.js bulundu!
echo.

REM node_modules var mi kontrol et
if not exist "node_modules\" (
    echo [BILGI] node_modules bulunamadi, paketler kuruluyor...
    echo.
    call npm install
    if %errorlevel% neq 0 (
        echo.
        echo [HATA] Paketler kurulamadi!
        pause
        exit /b 1
    )
    echo.
    echo [OK] Paketler kuruldu!
    echo.
)

echo [BASLATILIYOR] Sunucu baslatiliyor...
echo.
echo ==========================================
echo  Sunucu calisiyor!
echo  Tarayicida http://localhost:3000 ac
echo  Kapatmak icin Ctrl+C bas
echo ==========================================
echo.

node server.js

pause