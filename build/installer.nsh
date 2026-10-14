; Remove the launch-at-login entry (registered by the app as "AutoPilot") on uninstall.
!macro customUnInstall
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "AutoPilot"
!macroend
