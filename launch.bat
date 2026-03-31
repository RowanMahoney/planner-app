@echo off
:: Launch Planner in Chrome with File System Access API enabled on file:// URLs
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --unsafely-treat-insecure-origin-as-secure="file:///" --allow-file-access-from-files "%~dp0index.html"
