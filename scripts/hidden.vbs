' Runs a .cmd with no visible window.
' Used by the sm-fixed scheduled tasks so the console and tunnel have no window
' a stray click can close -- the failure that took the site down twice.
Set sh = CreateObject("WScript.Shell")
If WScript.Arguments.Count = 0 Then WScript.Quit 1
sh.Run """" & WScript.Arguments(0) & """", 0, False
