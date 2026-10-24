' Launcher: hidden file pick (phase 1), then visible CMD (phase 2).
Option Explicit

Dim mode, sh, fso, resultFile, pickScript, exitCode, phase2Bat, cmdLine
Dim vbsDir, projectRoot, traceFile, pickModeArg, skipInitial, formalTraceFile

Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

If WScript.Arguments.Count < 1 Then
  WScript.Quit 1
End If

Call ResolveLauncherPaths

If WScript.Arguments(0) = "__syntax_check__" Then
  WScript.Quit 0
End If

If WScript.Arguments(0) = "__path_check__" Then
  If Not VerifyLauncherFiles() Then
    WScript.Quit 1
  End If
  WScript.Quit 0
End If

If WScript.Arguments(0) = "__trace_probe__" Then
  If WScript.Arguments.Count < 2 Then
    WScript.Quit 1
  End If
  pickModeArg = LCase(WScript.Arguments(1))
  skipInitial = TraceSkipInitialFromArgs(2)
  Call RunTraceProbe(pickModeArg, skipInitial)
End If

If WScript.Arguments(0) = "__trace__" Then
  If WScript.Arguments.Count < 2 Then
    WScript.Quit 1
  End If
  pickModeArg = LCase(WScript.Arguments(1))
  skipInitial = TraceSkipInitialFromArgs(2)
  Call RunTraceFullPick(pickModeArg, skipInitial)
End If

mode = LCase(WScript.Arguments(0))

resultFile = sh.ExpandEnvironmentStrings("%TEMP%") & "\so-gui-pick-" & _
  Replace(Replace(Replace(CStr(Now), " ", "-"), ":", ""), "/", "") & ".json"

If Not VerifyLauncherFiles() Then
  WScript.Quit 1
End If

sh.CurrentDirectory = projectRoot

formalTraceFile = Trim(sh.Environment("Process")("SO_GUI_PICK_TRACE"))
If formalTraceFile <> "" Then
  traceFile = formalTraceFile
  Call AppendVbsTrace(traceFile, "vbs_formal_start", """mode"":""" & mode & """,""host"":""" & LCase(WScript.FullName) & """")
End If

cmdLine = "node.exe " & Q(pickScript) & " " & Q(mode) & " " & Q(resultFile)
exitCode = sh.Run(cmdLine, 0, True)

If formalTraceFile <> "" Then
  Call AppendVbsTrace(traceFile, "vbs_formal_after_node", """exit"":" & CStr(exitCode))
  If VerifyTraceLogOk(traceFile) Then Call WriteTracePointer(traceFile)
End If

If exitCode = 2 Then
  WScript.Quit 0
End If

If exitCode <> 0 Then
  Dim errMsg
  errMsg = ReadPickError(resultFile)
  If errMsg = "" Then
    errMsg = ChrW(27284) & ChrW(26696) & ChrW(36984) & ChrW(25799) & ChrW(22833) & ChrW(25943) & _
      " (exit " & CStr(exitCode) & ")"
  End If
  MsgBox errMsg, vbExclamation, "SpotifyOrganizer"
  SafeDelete resultFile
  WScript.Quit exitCode
End If

If Not fso.FileExists(resultFile) Then
  MsgBox ChrW(26410) & ChrW(21462) & ChrW(24471) & ChrW(36984) & ChrW(26696) & ChrW(36335) & ChrW(24465) & ".", vbExclamation, "SpotifyOrganizer"
  WScript.Quit 1
End If

cmdLine = "cmd /k " & Q(phase2Bat & " " & mode & " " & resultFile)
sh.Run cmdLine, 1, False

WScript.Quit 0

Sub ResolveLauncherPaths()
  vbsDir = fso.GetParentFolderName(WScript.ScriptFullName)
  projectRoot = fso.GetParentFolderName(fso.GetParentFolderName(vbsDir))
  pickScript = fso.BuildPath(vbsDir, "gui-pick-only.js")
  phase2Bat = fso.BuildPath(vbsDir, "run-gui-phase2.bat")
End Sub

Function VerifyLauncherFiles()
  VerifyLauncherFiles = False
  If Not fso.FileExists(pickScript) Then
    MsgBox ChrW(25214) & ChrW(19981) & ChrW(21040) & " gui-pick-only.js" & vbCrLf & pickScript, vbCritical, "SpotifyOrganizer"
    Exit Function
  End If
  If Not fso.FileExists(phase2Bat) Then
    MsgBox ChrW(25214) & ChrW(19981) & ChrW(21040) & " run-gui-phase2.bat" & vbCrLf & phase2Bat, vbCritical, "SpotifyOrganizer"
    Exit Function
  End If
  VerifyLauncherFiles = True
End Function

Function Q(s)
  Q = Chr(34) & s & Chr(34)
End Function

Function ReadPickError(jsonPath)
  On Error Resume Next
  ReadPickError = ""
  Dim f, text, pos, key, p2, p3, q
  q = Chr(34)
  key = q & "reason_zh" & q
  If Not fso.FileExists(jsonPath) Then Exit Function
  Set f = fso.OpenTextFile(jsonPath, 1, False, -1)
  text = f.ReadAll
  f.Close
  pos = InStr(text, key)
  If pos > 0 Then
    p2 = InStr(pos, text, ":")
    p3 = InStr(p2, text, q)
    If p3 > 0 Then
      p3 = p3 + 1
      ReadPickError = Mid(text, p3, InStr(p3, text, q) - p3)
    End If
  End If
End Function

Sub SafeDelete(p)
  On Error Resume Next
  If fso.FileExists(p) Then fso.DeleteFile p, True
End Sub

Function TraceSkipInitialFromArgs(startIdx)
  TraceSkipInitialFromArgs = False
  If WScript.Arguments.Count <= startIdx Then Exit Function
  If LCase(WScript.Arguments(startIdx)) = "skip-initial-dir" Then
    TraceSkipInitialFromArgs = True
  End If
End Function

Function BuildAsciiTimestamp()
  BuildAsciiTimestamp = CStr(Year(Now)) & Right("0" & Month(Now), 2) & Right("0" & Day(Now), 2) & _
    "-" & Right("0" & Hour(Now), 2) & Right("0" & Minute(Now), 2) & Right("0" & Second(Now), 2)
End Function

Function BuildTraceFilePath()
  BuildTraceFilePath = sh.ExpandEnvironmentStrings("%TEMP%") & "\so-gui-pick-trace-" & _
    BuildAsciiTimestamp() & ".log"
End Function

Sub WriteTracePointer(p)
  On Error Resume Next
  Dim pf
  pf = sh.ExpandEnvironmentStrings("%TEMP%") & "\so-gui-pick-trace-latest.txt"
  Dim tf
  Set tf = fso.CreateTextFile(pf, True, False)
  tf.Write p
  tf.Close
End Sub

Sub AppendVbsTrace(p, phase, extraJson)
  On Error Resume Next
  Dim f, line
  line = "{""t"":""" & Iso8601Local() & """,""layer"":""vbs"",""phase"":""" & phase & """"
  If extraJson <> "" Then line = line & "," & extraJson
  line = line & "}" & vbCrLf
  Set f = fso.OpenTextFile(p, 8, True, -1)
  f.Write line
  f.Close
End Sub

Function Iso8601Local()
  Iso8601Local = Year(Now) & "-" & Right("0" & Month(Now), 2) & "-" & Right("0" & Day(Now), 2) & _
    "T" & Right("0" & Hour(Now), 2) & ":" & Right("0" & Minute(Now), 2) & ":" & Right("0" & Second(Now), 2)
End Function

Sub SetupTraceEnv(p, skipInit)
  sh.Environment("Process")("SO_GUI_PICK_TRACE") = p
  If skipInit Then
    sh.Environment("Process")("SO_GUI_PICK_SKIP_INITIAL_DIR") = "1"
  Else
    sh.Environment("Process")("SO_GUI_PICK_SKIP_INITIAL_DIR") = ""
  End If
End Sub

Function VerifyTraceLogOk(logPath)
  VerifyTraceLogOk = False
  On Error Resume Next
  If Not fso.FileExists(logPath) Then Exit Function
  Dim f, body
  Set f = fso.OpenTextFile(logPath, 1, False, 0)
  body = f.ReadAll
  f.Close
  If Len(body) > 0 Then VerifyTraceLogOk = True
End Function

Sub RunTraceProbe(pickMode, skipInit)
  If Not VerifyLauncherFiles() Then
    WScript.Quit 1
  End If
  traceFile = BuildTraceFilePath()
  Call SetupTraceEnv(traceFile, skipInit)
  sh.CurrentDirectory = projectRoot
  resultFile = sh.ExpandEnvironmentStrings("%TEMP%") & "\so-gui-pick-probe-result.json"
  Call AppendVbsTrace(traceFile, "vbs_trace_probe_start", """mode"":""" & pickMode & """,""skip_initial"":" & LCase(CStr(skipInit)))
  cmdLine = "node.exe " & Q(pickScript) & " __pick_probe__ " & pickMode & " " & Q(resultFile)
  exitCode = sh.Run(cmdLine, 0, True)
  Call AppendVbsTrace(traceFile, "vbs_trace_probe_end", """exit"":" & CStr(exitCode))
  SafeDelete resultFile
  If exitCode <> 0 Or Not VerifyTraceLogOk(traceFile) Then
    MsgBox "PROBE FAILED" & vbCrLf & "node=" & CStr(exitCode) & vbCrLf & traceFile, vbCritical, "SpotifyOrganizer"
    WScript.Quit 1
  End If
  Call WriteTracePointer(traceFile)
  MsgBox "PROBE OK" & vbCrLf & traceFile, vbInformation, "SpotifyOrganizer"
  WScript.Quit 0
End Sub

Sub RunTraceFullPick(pickMode, skipInit)
  If Not VerifyLauncherFiles() Then
    WScript.Quit 1
  End If
  traceFile = BuildTraceFilePath()
  Call SetupTraceEnv(traceFile, skipInit)
  sh.CurrentDirectory = projectRoot
  resultFile = sh.ExpandEnvironmentStrings("%TEMP%") & "\so-gui-pick-trace-full-" & _
    BuildAsciiTimestamp() & ".json"
  Call AppendVbsTrace(traceFile, "vbs_trace_full_start", """mode"":""" & pickMode & """,""skip_initial"":" & LCase(CStr(skipInit)))
  cmdLine = "node.exe " & Q(pickScript) & " " & pickMode & " " & Q(resultFile)
  exitCode = sh.Run(cmdLine, 0, True)
  Call AppendVbsTrace(traceFile, "vbs_trace_full_end", """exit"":" & CStr(exitCode))
  If exitCode = 2 Then
    If VerifyTraceLogOk(traceFile) Then Call WriteTracePointer(traceFile)
    MsgBox "TRACE CANCELLED" & vbCrLf & traceFile, vbInformation, "SpotifyOrganizer"
    SafeDelete resultFile
    If VerifyTraceLogOk(traceFile) Then
      WScript.Quit 0
    End If
    WScript.Quit 1
  End If
  If exitCode <> 0 Then
    MsgBox "TRACE FAILED" & vbCrLf & "node=" & CStr(exitCode) & vbCrLf & traceFile, vbExclamation, "SpotifyOrganizer"
    SafeDelete resultFile
    WScript.Quit exitCode
  End If
  SafeDelete resultFile
  If Not VerifyTraceLogOk(traceFile) Then
    MsgBox "TRACE FAILED log missing" & vbCrLf & traceFile, vbCritical, "SpotifyOrganizer"
    WScript.Quit 1
  End If
  Call WriteTracePointer(traceFile)
  MsgBox "TRACE OK" & vbCrLf & traceFile, vbInformation, "SpotifyOrganizer"
  WScript.Quit 0
End Sub
