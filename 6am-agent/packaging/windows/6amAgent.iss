; 6AM Agent - per-user Windows installer (Inno Setup 6.3+).
; Built by build-installer.ps1, which passes:
;   /DPayloadDir=<abs path to dist\win-x64|win-arm64>  /DAppVersion=<x.y.z>  /DAppArch=<x64|arm64>
;   optional: /DSignEnabled=1 /Ssigntool6am=<signtool command>
; Payload layout (H18 build contract): runtime\node.exe, app\agent.cjs, app\build-config.json, VERSION.
; No admin rights: installs to {localappdata}\Programs\6amAgent, no HKLM, no {pf}/{commonappdata}.

#ifndef PayloadDir
  #error PayloadDir is not defined. Build with build-installer.ps1 or pass /DPayloadDir=...
#endif
#ifndef AppVersion
  #error AppVersion is not defined. Build with build-installer.ps1 or pass /DAppVersion=...
#endif
#ifndef AppArch
  #error AppArch is not defined. Build with build-installer.ps1 or pass /DAppArch=x64|arm64
#endif

#if AppArch == "x64"
  #define ArchAllowed "x64compatible"
#elif AppArch == "arm64"
  #define ArchAllowed "arm64"
#else
  #error AppArch must be x64 or arm64
#endif

[Setup]
AppId={{351FAFE8-7B9A-4BE0-8171-4A5928F0A631}
AppName=6AM Agent
AppVersion={#AppVersion}
AppPublisher=6AM Technologies
UninstallDisplayName=6AM Agent
DefaultDirName={localappdata}\Programs\6amAgent
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed={#ArchAllowed}
ArchitecturesInstallIn64BitMode={#ArchAllowed}
; conhost.exe --headless (the task's hidden console host) needs Windows 10 1809+.
MinVersion=10.0.17763
OutputDir=Output
OutputBaseFilename=6amAgent-{#AppVersion}-{#AppArch}
WizardStyle=modern
SetupLogging=yes
Compression=lzma2
SolidCompression=yes
; Backstop for upgrades: Restart Manager force-closes an agent node.exe still holding {app} files.
; install-service restarts the agent afterwards, so Restart Manager must not.
CloseApplications=force
RestartApplications=no
#ifdef SignEnabled
SignTool=signtool6am
SignedUninstaller=yes
#endif

[Files]
Source: "{#PayloadDir}\runtime\*"; DestDir: "{app}\runtime"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#PayloadDir}\app\*"; DestDir: "{app}\app"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#PayloadDir}\VERSION"; DestDir: "{app}"; Flags: ignoreversion skipifsourcedoesntexist

; Post-install steps (install-service, then pair) run from [Code] CurStepChanged so a failed
; install-service is reported instead of ignored, which [Run] entries cannot do.

[UninstallRun]
; Ends and deletes the Scheduled Task and deregisters the device (best-effort).
Filename: "{app}\runtime\node.exe"; Parameters: """{app}\app\agent.cjs"" uninstall-service"; WorkingDir: "{app}"; Flags: runhidden waituntilterminated; RunOnceId: "UninstallService"

[UninstallDelete]
; Remove agent state and credentials; keep {localappdata}\6amAgent\logs.
Type: files; Name: "{localappdata}\6amAgent\state.db*"
Type: filesandordirs; Name: "{localappdata}\6amAgent\cred"
Type: filesandordirs; Name: "{localappdata}\6amAgent\agent.lock"
Type: filesandordirs; Name: "{localappdata}\6amAgent\sync-request"
Type: filesandordirs; Name: "{app}"

[Code]
function IsPaired: Boolean;
begin
  Result := FileExists(ExpandConstant('{localappdata}\6amAgent\cred\device_token.bin'));
end;

function AgentArgs(Command: String): String;
begin
  Result := '"' + ExpandConstant('{app}\app\agent.cjs') + '" ' + Command;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  ResultCode: Integer;
begin
  if CurStep <> ssPostInstall then
    Exit;

  { 1. Register the per-user Scheduled Task "6amAgent" and start it. }
  WizardForm.StatusLabel.Caption := 'Registering the 6AM Agent background task...';
  if not Exec(ExpandConstant('{app}\runtime\node.exe'), AgentArgs('install-service'),
    ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, ResultCode) or (ResultCode <> 0) then
  begin
    Log(Format('install-service failed with code %d', [ResultCode]));
    SuppressibleMsgBox('6AM Agent was installed, but its background task could not be registered ' +
      '(code ' + IntToStr(ResultCode) + '). Please send the setup log from %TEMP% ' +
      '("Setup Log *.txt") to IT.', mbError, MB_OK, IDOK);
    Exit;
  end;

  { 2. Open the pairing page (loopback server + browser) unless already paired. Do not wait. }
  if not IsPaired then
  begin
    WizardForm.StatusLabel.Caption := 'Opening the 6AM Agent pairing page...';
    Exec(ExpandConstant('{app}\runtime\node.exe'), AgentArgs('pair'), ExpandConstant('{app}'),
      SW_HIDE, ewNoWait, ResultCode);
  end;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  { Stop a running agent before files are replaced on upgrade. Failure (no task yet) is ignored. }
  Exec(ExpandConstant('{sys}\schtasks.exe'), '/End /TN 6amAgent', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Sleep(1500);
  Result := '';
end;
