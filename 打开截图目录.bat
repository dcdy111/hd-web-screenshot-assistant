@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist "output\hd-screenshots" mkdir "output\hd-screenshots"
start "" "%~dp0output\hd-screenshots"
