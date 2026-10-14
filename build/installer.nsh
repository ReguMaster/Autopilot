; Remove the launch-at-login entry (registered by Electron under the app user model id) on uninstall.
!macro customUnInstall
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "com.autopilot.desktop"
!macroend
