@echo off
chcp 65001 >nul
title 小红书笔记发布工具 (服务 + 隧道)
cd /d "%~dp0"

echo ============================================
echo   小红书笔记发布工具  一键启动
echo   电脑端管理: https://xhs.zhuanlu.xyz/app
echo   手机端访问: https://xhs.zhuanlu.xyz/m
echo   默认密码:   888888
echo ============================================
echo.

rem 1. 启动工具服务 (新窗口)
start "XHS-Server" cmd /k "cd /d %~dp0 && python app.py"

rem 2. 启动 cloudflare 隧道 xhs-tunnel (新窗口)
rem 注意: 必须用 xhs-tunnel(27da88b4)，别用旧的 transcribe-bot 隧道(会抢 VPS 隧道导致 502)。
rem 需 cd 到 ~/.cloudflared 目录让 cloudflared 自动加载 config.yml。
start "XHS-Tunnel" cmd /k "cd /d C:\Users\Dancing\.cloudflared && cloudflared tunnel run xhs-tunnel"

echo 已启动两个窗口：XHS-Server 和 XHS-Tunnel。
echo 关闭它们即停止服务。本窗口可关闭。
echo.
pause