@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 小红书笔记发布工具

rem ------------------------------------------------------------
rem 解释器选择（重要）
rem PATH 里的 `python` 是 3.13.14，没装 Flask，直接用会闪退报
rem ModuleNotFoundError: No module named 'flask' → 网页打不开。
rem 已验证可用的解释器（含 Flask 3.1.3）：
rem   1) py -3.11
rem   2) C:\Users\Dancing\AppData\Local\Programs\Python\Python311\python.exe
rem ------------------------------------------------------------
set "PYEXE="

where py >nul 2>nul
if not errorlevel 1 (
    py -3.11 -c "import flask" >nul 2>nul
    if not errorlevel 1 set "PYEXE=py -3.11"
)

if not defined PYEXE (
    if exist "C:\Users\Dancing\AppData\Local\Programs\Python\Python311\python.exe" (
        "C:\Users\Dancing\AppData\Local\Programs\Python\Python311\python.exe" -c "import flask" >nul 2>nul
        if not errorlevel 1 set "PYEXE=C:\Users\Dancing\AppData\Local\Programs\Python\Python311\python.exe"
    )
)

if not defined PYEXE (
    echo.
    echo [错误] 没找到装了 Flask 的 Python。
    echo        请先执行:  py -3.11 -m pip install -r requirements.txt
    echo.
    pause
    exit /b 1
)

echo 使用解释器: %PYEXE%
echo ============================================
echo   小红书笔记发布工具  启动中...
echo   电脑端管理:  http://127.0.0.1:8800/app
echo   手机端发布:  http://127.0.0.1:8800/m
echo   默认密码:    888888 (登录后可改)
echo ============================================
echo.

%PYEXE% app.py
pause
