@echo off
title Recorder
start /B "" node "%~dp0recorder-server.js"
timeout /t 1 /nobreak > nul
start "" "http://localhost:3131"
