' ---------------------------------------------------------------------------
'  Starts the notification service with no window at all.
'
'  Windows has no way to launch a .cmd invisibly on its own: a scheduled task
'  running one flashes a console up at log on, and if it is set to stay hidden
'  the window still exists and can be closed by accident, which would stop
'  notifications with nothing to show why. Running it through wscript with a
'  window style of 0 is the ordinary way round that.
'
'  The path is derived from where this file sits, so moving or renaming the
'  project folder does not break it.
' ---------------------------------------------------------------------------

Dim fso, shell, root, target

Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

root = fso.GetParentFolderName(WScript.ScriptFullName)
target = fso.BuildPath(root, "notification-service.cmd")

If Not fso.FileExists(target) Then
  ' Silent everywhere else, but this one is worth saying out loud: it means the
  ' project has been moved or half-deleted, and nothing will be delivered.
  MsgBox "WeeklyClass notifications cannot start." & vbCrLf & vbCrLf & _
         "Missing: " & target, vbExclamation, "WeeklyClass LMS"
  WScript.Quit 1
End If

' 0 = no window. False = do not wait for it; the service runs for as long as
' the person is logged in.
shell.Run """" & target & """", 0, False
