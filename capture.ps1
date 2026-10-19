<#
DSH Screenshot capture helper (Windows PowerShell 5.1+).

Captures the screen, a rectangle, or one window and writes a PNG.
Prints one machine-readable line:  DSH_SHOT:{...json...}

Modes:
  screen   full virtual desktop, or one monitor with -Monitor
  region   -Region "x,y,width,height" (px or percent with -RegionUnit percent)
  window   -Window "<title substring>" | active | self | process:<name> | pid:<n>
  restore  only re-show windows of -MaskPid (crash recovery; no capture)

Masking:
  -MaskPid <pid> / -MaskProcess <name> hide the DeepSeek Harness window(s)
  for the capture and restore them afterwards.
#>
[CmdletBinding()]
param(
  [string]$OutPath = '',
  [ValidateSet('screen', 'region', 'window', 'restore', 'list')]
  [string]$Mode = 'screen',
  [string]$Region = '',
  [ValidateSet('px', 'percent')]
  [string]$RegionUnit = 'px',
  [string]$Window = '',
  [string]$Monitor = 'all',
  [string]$MaskPid = '0',
  [string]$MaskProcess = '',
  [string]$MaskSelf = 'false',
  [int]$DelayMs = 150,
  [int]$MaskSettleMs = 320
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

Add-Type -AssemblyName System.Drawing | Out-Null
Add-Type -AssemblyName System.Windows.Forms | Out-Null

Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class DshShotNative {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [StructLayout(LayoutKind.Sequential)]
  public struct POINT { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential)]
  public struct WINDOWPLACEMENT {
    public int length; public int flags; public int showCmd;
    public POINT ptMinPosition; public POINT ptMaxPosition; public RECT rcNormalPosition;
  }

  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

  [DllImport("user32.dll", SetLastError = true)]
  public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  [DllImport("user32.dll")]
  public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")]
  public static extern int GetSystemMetrics(int nIndex);
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")]
  public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern bool IsZoomed(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")]
  public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")]
  public static extern bool GetWindowPlacement(IntPtr hWnd, ref WINDOWPLACEMENT lpwndpl);
  [DllImport("user32.dll")]
  public static extern bool SetWindowPlacement(IntPtr hWnd, ref WINDOWPLACEMENT lpwndpl);
  [DllImport("user32.dll")]
  public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint nFlags);
  [DllImport("user32.dll")]
  public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("dwmapi.dll")]
  public static extern int DwmGetWindowAttribute(IntPtr hwnd, int dwAttribute, out RECT pvAttribute, int cbAttribute);
}
"@

$dpiAware = [DshShotNative]::SetProcessDpiAwarenessContext([IntPtr](-4))
if (-not $dpiAware) {
  # Fallback for Windows versions without SetProcessDpiAwarenessContext.
  [void][DshShotNative]::SetProcessDPIAware()
}

$script:Marker = 'DSH_SHOT:'
$script:Started = [System.Diagnostics.Stopwatch]::StartNew()
$script:Hidden = New-Object System.Collections.ArrayList
$script:MaskPidValue = 0
[void][int]::TryParse($MaskPid, [ref]$script:MaskPidValue)
$script:MaskSelfValue = ($MaskSelf -match '^(1|true|yes|on)$')
$script:TargetInfo = @{}

function Write-Result([hashtable]$Payload) {
  $Payload['elapsedMs'] = [int]$script:Started.ElapsedMilliseconds
  $json = $Payload | ConvertTo-Json -Compress -Depth 6
  [Console]::Out.WriteLine($script:Marker + $json)
}

function Fail([string]$Code, [string]$Message, [object]$Extra = $null) {
  $payload = @{ ok = $false; code = $Code; error = $Message }
  if ($null -ne $Extra) { $payload['details'] = $Extra }
  Write-Result $payload
  exit 1
}

function Get-VirtualBounds {
  $x = [DshShotNative]::GetSystemMetrics(76) # SM_XVIRTUALSCREEN
  $y = [DshShotNative]::GetSystemMetrics(77) # SM_YVIRTUALSCREEN
  $w = [DshShotNative]::GetSystemMetrics(78) # SM_CXVIRTUALSCREEN
  $h = [DshShotNative]::GetSystemMetrics(79) # SM_CYVIRTUALSCREEN
  if ($w -le 0 -or $h -le 0) {
    $w = [DshShotNative]::GetSystemMetrics(0)
    $h = [DshShotNative]::GetSystemMetrics(1)
    $x = 0; $y = 0
  }
  return [pscustomobject]@{ Left = $x; Top = $y; Right = $x + $w; Bottom = $y + $h; Width = $w; Height = $h }
}

function Get-Monitors {
  $screens = @([System.Windows.Forms.Screen]::AllScreens)
  $screens = $screens | Sort-Object @{ Expression = { $_.Bounds.X } }, @{ Expression = { $_.Bounds.Y } }
  $rows = @()
  for ($i = 0; $i -lt $screens.Count; $i++) {
    $b = $screens[$i].Bounds
    $rows += [pscustomobject]@{ Index = $i + 1; Left = $b.X; Top = $b.Y; Right = $b.Right; Bottom = $b.Bottom; Width = $b.Width; Height = $b.Height; Primary = $screens[$i].Primary; Device = $screens[$i].DeviceName }
  }
  return $rows
}

function Get-SelectedBounds {
  $virtual = Get-VirtualBounds
  if ([string]::IsNullOrWhiteSpace($Monitor) -or $Monitor -eq 'all') { return $virtual }
  if ($Monitor -eq 'primary') {
    return [pscustomobject]@{ Left = 0; Top = 0; Right = [DshShotNative]::GetSystemMetrics(0); Bottom = [DshShotNative]::GetSystemMetrics(1); Width = [DshShotNative]::GetSystemMetrics(0); Height = [DshShotNative]::GetSystemMetrics(1) }
  }
  $index = 0
  if (-not [int]::TryParse($Monitor, [ref]$index)) { Fail 'BAD_MONITOR' "Unknown monitor '$Monitor'. Use all, primary, or a 1-based index." }
  $monitors = @(Get-Monitors)
  if ($index -lt 1 -or $index -gt $monitors.Count) { Fail 'BAD_MONITOR' "Monitor $index does not exist; this system has $($monitors.Count) monitor(s)." }
  $m = $monitors[$index - 1]
  return [pscustomobject]@{ Left = $m.Left; Top = $m.Top; Right = $m.Right; Bottom = $m.Bottom; Width = $m.Width; Height = $m.Height }
}

function Get-TopLevelWindows {
  param([switch]$IncludeHidden)
  $rows = New-Object System.Collections.ArrayList
  $callback = [DshShotNative+EnumWindowsProc]{
    param([IntPtr]$hWnd, [IntPtr]$lParam)
    if (-not $IncludeHidden -and -not [DshShotNative]::IsWindowVisible($hWnd)) { return $true }
    $length = [DshShotNative]::GetWindowTextLength($hWnd)
    if ($length -le 0) { return $true }
    $builder = New-Object System.Text.StringBuilder ($length + 2)
    [void][DshShotNative]::GetWindowText($hWnd, $builder, $builder.Capacity)
    $procId = [uint32]0
    [void][DshShotNative]::GetWindowThreadProcessId($hWnd, [ref]$procId)
    $rect = New-Object DshShotNative+RECT
    [void][DshShotNative]::GetWindowRect($hWnd, [ref]$rect)
    [void]$rows.Add([pscustomobject]@{
      Hwnd = $hWnd
      Pid = [int]$procId
      Title = $builder.ToString()
      Left = $rect.Left; Top = $rect.Top; Right = $rect.Right; Bottom = $rect.Bottom
      Width = $rect.Right - $rect.Left; Height = $rect.Bottom - $rect.Top
      ProcessName = ''
    })
    return $true
  }
  [void][DshShotNative]::EnumWindows($callback, [IntPtr]::Zero)

  # Resolve process names in one pass; failures are normal for protected processes.
  $names = @{}
  try {
    foreach ($proc in @(Get-Process -ErrorAction SilentlyContinue)) {
      $names[[int]$proc.Id] = $proc.ProcessName
    }
  } catch { }
  foreach ($row in $rows) {
    if ($names.ContainsKey($row.Pid)) { $row.ProcessName = [string]$names[$row.Pid] }
  }
  return $rows
}

function Test-OnScreen([object]$Rect, [object]$Virtual) {
  if ($Rect.Width -le 0 -or $Rect.Height -le 0) { return $false }
  # A minimized window reports -32000 coordinates but can still be restored and
  # captured when it is explicitly selected.
  if ([DshShotNative]::IsIconic($Rect.Hwnd)) { return $true }
  if ($Rect.Left -le -30000 -or $Rect.Top -le -30000) { return $false }
  return ($Rect.Right -gt $Virtual.Left -and $Rect.Bottom -gt $Virtual.Top -and $Rect.Left -lt $Virtual.Right -and $Rect.Top -lt $Virtual.Bottom)
}

function Get-WindowFrame([IntPtr]$Hwnd) {
  $windowRect = New-Object DshShotNative+RECT
  [void][DshShotNative]::GetWindowRect($Hwnd, [ref]$windowRect)
  $frameRect = New-Object DshShotNative+RECT
  $hr = [DshShotNative]::DwmGetWindowAttribute($Hwnd, 9, [ref]$frameRect, 16) # DWMWA_EXTENDED_FRAME_BOUNDS
  $useFrame = ($hr -eq 0 -and ($frameRect.Right - $frameRect.Left) -gt 0 -and ($frameRect.Bottom - $frameRect.Top) -gt 0)
  if (-not $useFrame) { $frameRect = $windowRect }
  return [pscustomobject]@{
    Hwnd = $Hwnd
    WindowLeft = $windowRect.Left; WindowTop = $windowRect.Top; WindowRight = $windowRect.Right; WindowBottom = $windowRect.Bottom
    Left = $frameRect.Left; Top = $frameRect.Top; Right = $frameRect.Right; Bottom = $frameRect.Bottom
    Width = $frameRect.Right - $frameRect.Left; Height = $frameRect.Bottom - $frameRect.Top
  }
}

function Resolve-TargetWindow([object]$Windows) {
  $selector = $Window
  if ([string]::IsNullOrWhiteSpace($selector)) { $selector = 'active' }

  $candidates = @()
  if ($selector -match '^(active|foreground)$') {
    $foreground = [DshShotNative]::GetForegroundWindow()
    $candidates = @($Windows | Where-Object { $_.Hwnd -eq $foreground })
    if ($candidates.Count -eq 0) {
      $frame = Get-WindowFrame $foreground
      $candidates = @([pscustomobject]@{ Hwnd = $foreground; Pid = 0; Title = '(foreground window)'; ProcessName = ''; Left = $frame.Left; Top = $frame.Top; Right = $frame.Right; Bottom = $frame.Bottom; Width = $frame.Width; Height = $frame.Height })
    }
  } elseif ($selector -eq 'self' -or $selector -eq 'harness') {
    if ($script:MaskPidValue -le 0) { Fail 'NO_SELF_PID' 'Cannot identify the DeepSeek Harness window: no host PID was provided.' }
    $candidates = @($Windows | Where-Object { $_.Pid -eq $script:MaskPidValue })
    if ($candidates.Count -eq 0) { $candidates = @($Windows | Where-Object { $_.ProcessName -like '*DeepSeek*' }) }
  } elseif ($selector -match '^hwnd:(\d+)$') {
    $wanted = [int64]$Matches[1]
    $candidates = @($Windows | Where-Object { $_.Hwnd.ToInt64() -eq $wanted })
  } elseif ($selector -match '^pid:(\d+)$') {
    $wanted = [int]$Matches[1]
    $candidates = @($Windows | Where-Object { $_.Pid -eq $wanted })
  } elseif ($selector -match '^process:(.+)$') {
    $wanted = $Matches[1].Trim()
    $candidates = @($Windows | Where-Object { $_.ProcessName -like "*$wanted*" })
  } else {
    $candidates = @($Windows | Where-Object { $_.Title -like "*$selector*" })
    if ($candidates.Count -eq 0) {
      $candidates = @($Windows | Where-Object { $_.ProcessName -like "*$selector*" })
    }
  }

  $virtual = Get-VirtualBounds
  # Keep minimized windows as candidates: the caller may explicitly target them
  # and Show-TargetWindow restores them for capture.
  $candidates = @($candidates | Where-Object { Test-OnScreen $_ $virtual })
  if ($candidates.Count -eq 0) {
    $titles = @()
    foreach ($candidate in @($Windows | Select-Object -First 16)) {
      $procLabel = ''
      if ($candidate.ProcessName) { $procLabel = ' [process:' + $candidate.ProcessName + ']' }
      $stateLabel = ''
      if ([DshShotNative]::IsIconic($candidate.Hwnd)) { $stateLabel = ' (minimized)' }
      $titles += ('[' + $candidate.Title + ']' + $procLabel + $stateLabel)
    }
    Fail 'WINDOW_NOT_FOUND' "No window matched '$selector'." @{ windows = $titles; hint = 'Pass part of the window title, process:<name>, pid:<n>, active, or self. To capture an obscured window, try mask_self=true.' }
  }

  $foreground = [DshShotNative]::GetForegroundWindow()
  $best = $candidates | Where-Object { $_.Hwnd -eq $foreground } | Select-Object -First 1
  if ($null -eq $best) {
    $best = $candidates | Where-Object { -not [DshShotNative]::IsIconic($_.Hwnd) } | Sort-Object @{ Expression = { $_.Width * $_.Height } } -Descending | Select-Object -First 1
  }
  if ($null -eq $best) {
    $best = $candidates | Sort-Object @{ Expression = { $_.Width * $_.Height } } -Descending | Select-Object -First 1
  }
  return $best
}

function Get-MaskWindows {
  param([switch]$IncludeHidden)
  $windows = @(Get-TopLevelWindows -IncludeHidden:$IncludeHidden)
  $rows = @()
  if ($script:MaskPidValue -gt 0) {
    $rows = @($windows | Where-Object { $_.Pid -eq $script:MaskPidValue })
  }
  if ($rows.Count -eq 0 -and -not [string]::IsNullOrWhiteSpace($MaskProcess)) {
    $rows = @($windows | Where-Object { $_.ProcessName -like "*$MaskProcess*" })
  }
  if ($rows.Count -eq 0) {
    $rows = @($windows | Where-Object { $_.ProcessName -eq 'DeepSeek Harness' })
  }
  if ($IncludeHidden) { return $rows }
  $virtual = Get-VirtualBounds
  return @($rows | Where-Object { (Test-OnScreen $_ $virtual) -and (-not [DshShotNative]::IsIconic($_.Hwnd)) })
}

function Hide-MaskWindows {
  if (-not $script:MaskSelfValue) { return }
  # Never hide the window that is being captured.
  $targetHwnd = $null
  if ($script:TargetInfo.ContainsKey('TargetHwnd')) { $targetHwnd = $script:TargetInfo['TargetHwnd'] }
  if ($script:TargetInfo.ContainsKey('TargetPid') -and $script:TargetInfo['TargetPid'] -eq $script:MaskPidValue) { return }
  $rows = @(Get-MaskWindows | Where-Object { $null -eq $targetHwnd -or $_.Hwnd -ne $targetHwnd })
  foreach ($row in $rows) {
    $foreground = ([DshShotNative]::GetForegroundWindow() -eq $row.Hwnd)
    $zoomed = [DshShotNative]::IsZoomed($row.Hwnd)
    $placement = New-Object DshShotNative+WINDOWPLACEMENT
    $placement.length = [System.Runtime.InteropServices.Marshal]::SizeOf($placement)
    $placed = [DshShotNative]::GetWindowPlacement($row.Hwnd, [ref]$placement)
    [void][DshShotNative]::ShowWindow($row.Hwnd, 0) # SW_HIDE
    [void]$script:Hidden.Add([pscustomobject]@{
      Hwnd = $row.Hwnd; Zoomed = $zoomed; Foreground = $foreground; Title = $row.Title; Pid = $row.Pid
      Placement = $(if ($placed) { $placement } else { $null })
    })
  }
  if ($rows.Count -gt 0 -and $MaskSettleMs -gt 0) { Start-Sleep -Milliseconds $MaskSettleMs }
}

function Restore-MaskWindows {
  if ($script:Hidden.Count -eq 0) { return }
  foreach ($state in $script:Hidden) {
    if (-not [DshShotNative]::IsWindow($state.Hwnd)) { continue }
    $restoredByPlacement = $false
    if ($null -ne $state.Placement) {
      $placement = $state.Placement
      $placement.length = [System.Runtime.InteropServices.Marshal]::SizeOf($placement)
      $restoredByPlacement = [DshShotNative]::SetWindowPlacement($state.Hwnd, [ref]$placement)
    }
    if (-not $restoredByPlacement) {
      [void][DshShotNative]::ShowWindow($state.Hwnd, 5) # SW_SHOW
    }
    if ($state.Zoomed) { [void][DshShotNative]::ShowWindow($state.Hwnd, 3) } # SW_MAXIMIZE
  }
  Start-Sleep -Milliseconds 80
  foreach ($state in $script:Hidden) {
    if ($state.Foreground -and [DshShotNative]::IsWindow($state.Hwnd)) {
      [void][DshShotNative]::SetForegroundWindow($state.Hwnd)
    }
  }
  $script:Hidden.Clear()
}

function Show-TargetWindow($Target) {
  if ([DshShotNative]::IsIconic($Target.Hwnd)) {
    [void][DshShotNative]::ShowWindow($Target.Hwnd, 9) # SW_RESTORE
    Start-Sleep -Milliseconds 300
  }
  $foreground = [DshShotNative]::GetForegroundWindow()
  if ($foreground -eq $Target.Hwnd) { return $foreground }
  $foregroundPid = [uint32]0
  $targetPid = [uint32]0
  $foregroundThread = [DshShotNative]::GetWindowThreadProcessId($foreground, [ref]$foregroundPid)
  $targetThread = [DshShotNative]::GetWindowThreadProcessId($Target.Hwnd, [ref]$targetPid)
  $attached = $false
  if ($foregroundThread -ne 0 -and $targetThread -ne 0 -and $foregroundThread -ne $targetThread) {
    $attached = [DshShotNative]::AttachThreadInput($foregroundThread, $targetThread, $true)
  }
  try {
    [void][DshShotNative]::BringWindowToTop($Target.Hwnd)
    [void][DshShotNative]::SetForegroundWindow($Target.Hwnd)
  } finally {
    if ($attached) { [void][DshShotNative]::AttachThreadInput($foregroundThread, $targetThread, $false) }
  }
  return $foreground
}

function Wait-WindowReady([IntPtr]$Hwnd, [int]$TimeoutMs = 3000) {
  $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMs)
  $lastWidth = -1
  $lastHeight = -1
  $stable = 0
  while ([DateTime]::UtcNow -lt $deadline) {
    if (-not [DshShotNative]::IsIconic($Hwnd)) {
      $frame = Get-WindowFrame $Hwnd
      if ($frame.Width -gt 0 -and $frame.Height -gt 0) {
        if ($frame.Width -eq $lastWidth -and $frame.Height -eq $lastHeight) {
          $stable++
          if ($stable -ge 2) { return $frame }
        } else {
          $stable = 0
          $lastWidth = $frame.Width
          $lastHeight = $frame.Height
        }
      }
    }
    Start-Sleep -Milliseconds 80
  }
  return Get-WindowFrame $Hwnd
}

function Save-Capture([int]$Left, [int]$Top, [int]$Width, [int]$Height, [string]$Path) {
  if ($Width -le 0 -or $Height -le 0) { throw "Invalid capture rectangle ${Width}x${Height}." }
  $bitmap = New-Object System.Drawing.Bitmap($Width, $Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  try {
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
      $size = New-Object System.Drawing.Size($Width, $Height)
      $graphics.CopyFromScreen($Left, $Top, 0, 0, $size, [System.Drawing.CopyPixelOperation]::SourceCopy)
    } finally { $graphics.Dispose() }
    $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally { $bitmap.Dispose() }
}

function Test-BlankBitmap([System.Drawing.Bitmap]$Bitmap) {
  $stepX = [Math]::Max(1, [int]($Bitmap.Width / 8))
  $stepY = [Math]::Max(1, [int]($Bitmap.Height / 8))
  $minR = 255; $maxR = 0
  $minG = 255; $maxG = 0
  $minB = 255; $maxB = 0
  $samples = 0
  for ($x = 0; $x -lt $Bitmap.Width; $x += $stepX) {
    for ($y = 0; $y -lt $Bitmap.Height; $y += $stepY) {
      $c = $Bitmap.GetPixel($x, $y)
      $samples++
      if ($c.R -lt $minR) { $minR = $c.R }
      if ($c.R -gt $maxR) { $maxR = $c.R }
      if ($c.G -lt $minG) { $minG = $c.G }
      if ($c.G -gt $maxG) { $maxG = $c.G }
      if ($c.B -lt $minB) { $minB = $c.B }
      if ($c.B -gt $maxB) { $maxB = $c.B }
    }
  }
  if ($samples -eq 0) { return $true }
  # A single flat color means PrintWindow drew nothing useful (plain white,
  # black, or the magenta fill). Fall back to a real screen capture.
  $spread = ($maxR - $minR) + ($maxG - $minG) + ($maxB - $minB)
  if ($spread -lt 6) { return $true }
  return $false
}

function Save-WindowViaPrintWindow($Target, [string]$Path) {
  $frame = Get-WindowFrame $Target.Hwnd
  $windowWidth = $frame.WindowRight - $frame.WindowLeft
  $windowHeight = $frame.WindowBottom - $frame.WindowTop
  if ($windowWidth -le 0 -or $windowHeight -le 0) { return $false }
  $bitmap = New-Object System.Drawing.Bitmap($windowWidth, $windowHeight, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  try {
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $printed = $false
    try {
      foreach ($flag in @(2, 1, 0)) {
        $graphics.Clear([System.Drawing.Color]::Magenta)
        $hdc = $graphics.GetHdc()
        try { $printed = [DshShotNative]::PrintWindow($Target.Hwnd, $hdc, [uint32]$flag) }
        finally { $graphics.ReleaseHdc($hdc) }
        if ($printed) { break }
      }
    } finally { $graphics.Dispose() }
    if (-not $printed) { return $false }
    if (Test-BlankBitmap $bitmap) { return $false }

    $offsetX = $frame.Left - $frame.WindowLeft
    $offsetY = $frame.Top - $frame.WindowTop
    $crop = New-Object System.Drawing.Rectangle($offsetX, $offsetY, $frame.Width, $frame.Height)
    $cropped = $null
    if ($crop.Width -gt 0 -and $crop.Height -gt 0 -and $crop.Right -le $bitmap.Width -and $crop.Bottom -le $bitmap.Height) {
      $cropped = $bitmap.Clone($crop, $bitmap.PixelFormat)
      $cropped.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
      $cropped.Dispose()
    } else {
      $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
    }
    return $true
  } finally { $bitmap.Dispose() }
}

# ---------------------------------------------------------------------------

if ([string]::IsNullOrWhiteSpace($OutPath) -and $Mode -ne 'restore' -and $Mode -ne 'list') {
  Fail 'BAD_OUTPUT' 'OutPath is required.'
}

if ($Mode -eq 'list') {
  $virtual = Get-VirtualBounds
  $windows = @(Get-TopLevelWindows)
  $rows = @()
  foreach ($candidate in $windows) {
    if ([string]::IsNullOrWhiteSpace($candidate.Title)) { continue }
    if ($candidate.ProcessName -eq 'TextInputHost') { continue }
    if ($candidate.Title -eq 'Program Manager' -or $candidate.Title -eq 'MSCTFIME UI' -or $candidate.Title -eq 'Default IME') { continue }
    if ($candidate.Width -le 0 -or $candidate.Height -le 0) { continue }
    $rows += [pscustomobject]@{
      hwnd = $candidate.Hwnd.ToInt64()
      pid = [int]$candidate.Pid
      title = $candidate.Title
      process = [string]$candidate.ProcessName
      iconic = [DshShotNative]::IsIconic($candidate.Hwnd)
      width = [int]$candidate.Width
      height = [int]$candidate.Height
    }
  }
  $rows = @($rows | Sort-Object @{ Expression = { if ($_.iconic) { 0 } else { $_.width * $_.height } } } -Descending | Select-Object -First 24)
  Write-Result @{ ok = $true; mode = 'list'; windows = $rows }
  exit 0
}

if ($Mode -eq 'restore') {
  $script:MaskSelfValue = $true
  $rows = @(Get-MaskWindows -IncludeHidden)
  $restored = 0
  foreach ($row in $rows) {
    if (-not [DshShotNative]::IsWindow($row.Hwnd)) { continue }
    # Only recover windows that are actually hidden; leave minimized windows
    # alone so crash recovery never un-minimizes a window the user minimized.
    if ([DshShotNative]::IsWindowVisible($row.Hwnd)) { continue }
    if ([DshShotNative]::IsIconic($row.Hwnd)) {
      [void][DshShotNative]::ShowWindow($row.Hwnd, 9) # SW_RESTORE
    } else {
      [void][DshShotNative]::ShowWindow($row.Hwnd, 5) # SW_SHOW
      if ([DshShotNative]::IsZoomed($row.Hwnd)) { [void][DshShotNative]::ShowWindow($row.Hwnd, 3) }
    }
    $restored++
  }
  Write-Result @{ ok = $true; mode = 'restore'; restored = $restored }
  exit 0
}

$virtual = Get-VirtualBounds
$windows = @(Get-TopLevelWindows)

try {
  if ($Mode -eq 'window') {
    $target = Resolve-TargetWindow $windows
    $script:TargetInfo['TargetPid'] = [int]$target.Pid
    $script:TargetInfo['TargetHwnd'] = $target.Hwnd
    Hide-MaskWindows
    $path_used = $OutPath
    $previousForeground = $null
    $wasIconic = [DshShotNative]::IsIconic($target.Hwnd)
    if ($wasIconic) {
      # A minimized window would otherwise print as a tiny taskbar-sized image.
      $previousForeground = Show-TargetWindow $target
      [void](Wait-WindowReady $target.Hwnd 3000)
      if ($DelayMs -gt 0) { Start-Sleep -Milliseconds $DelayMs }
    }
    $printed = $false
    try { $printed = Save-WindowViaPrintWindow $target $path_used } catch { $printed = $false }

    if (-not $printed) {
      if ($null -eq $previousForeground) { $previousForeground = Show-TargetWindow $target }
      if ($DelayMs -gt 0) { Start-Sleep -Milliseconds $DelayMs }
      $frame = Wait-WindowReady $target.Hwnd 2500
      $left = [Math]::Max($frame.Left, $virtual.Left)
      $top = [Math]::Max($frame.Top, $virtual.Top)
      $right = [Math]::Min($frame.Right, $virtual.Right)
      $bottom = [Math]::Min($frame.Bottom, $virtual.Bottom)
      if ($right -le $left -or $bottom -le $top) { throw "Window '$($target.Title)' is outside the visible desktop." }
      Save-Capture $left $top ($right - $left) ($bottom - $top) $path_used
      if ($previousForeground -ne $null -and $previousForeground -ne [IntPtr]::Zero -and $previousForeground -ne $target.Hwnd -and [DshShotNative]::IsWindow($previousForeground)) {
        [void][DshShotNative]::SetForegroundWindow($previousForeground)
      }
      $frame = [pscustomobject]@{ Left = $left; Top = $top; Width = $right - $left; Height = $bottom - $top }
    } else {
      $frame = Get-WindowFrame $target.Hwnd
    }

    Write-Result @{
      ok = $true; mode = 'window'; path = (Resolve-Path $path_used).Path
      width = [int]$frame.Width; height = [int]$frame.Height
      bounds = @{ x = [int]$frame.Left; y = [int]$frame.Top; width = [int]$frame.Width; height = [int]$frame.Height }
      window = @{ title = $target.Title; process = $target.ProcessName; pid = [int]$target.Pid; hwnd = $target.Hwnd.ToInt64() }
      printWindow = $printed
      masked = ($script:Hidden.Count -gt 0)
    }
    Restore-MaskWindows
    exit 0
  }

  # screen or region
  $bounds = Get-SelectedBounds
  if ($Mode -eq 'region') {
    if ([string]::IsNullOrWhiteSpace($Region)) { Fail 'BAD_REGION' 'Region mode requires -Region "x,y,width,height".' }
    $parts = @($Region -split ',')
    if ($parts.Count -ne 4) { Fail 'BAD_REGION' "Region must be 'x,y,width,height' (got '$Region')." }
    $values = @()
    foreach ($part in $parts) {
      $number = 0.0
      if (-not [double]::TryParse($part.Trim(), [ref]$number)) { Fail 'BAD_REGION' "Region value '$part' is not a number." }
      $values += $number
    }
    if ($RegionUnit -eq 'percent') {
      if ($values[0] -lt 0 -or $values[1] -lt 0 -or $values[2] -le 0 -or $values[3] -le 0 -or $values[0] -gt 100 -or $values[1] -gt 100 -or $values[2] -gt 100 -or $values[3] -gt 100) {
        Fail 'BAD_REGION' 'Percent region values must be within 0..100 with positive width and height.'
      }
      $left = $bounds.Left + [int][Math]::Round($bounds.Width * $values[0] / 100.0)
      $top = $bounds.Top + [int][Math]::Round($bounds.Height * $values[1] / 100.0)
      $width = [int][Math]::Round($bounds.Width * $values[2] / 100.0)
      $height = [int][Math]::Round($bounds.Height * $values[3] / 100.0)
    } else {
      $left = [int][Math]::Round($values[0])
      $top = [int][Math]::Round($values[1])
      $width = [int][Math]::Round($values[2])
      $height = [int][Math]::Round($values[3])
    }
    $right = $left + $width
    $bottom = $top + $height
  } else {
    $left = $bounds.Left; $top = $bounds.Top
    $right = $bounds.Right; $bottom = $bounds.Bottom
  }

  $left = [Math]::Max($left, $virtual.Left)
  $top = [Math]::Max($top, $virtual.Top)
  $right = [Math]::Min($right, $virtual.Right)
  $bottom = [Math]::Min($bottom, $virtual.Bottom)
  if ($right -le $left -or $bottom -le $top) { Fail 'BAD_REGION' 'The capture rectangle is outside the visible desktop.' }

  Hide-MaskWindows
  if ($DelayMs -gt 0) { Start-Sleep -Milliseconds $DelayMs }
  Save-Capture $left $top ($right - $left) ($bottom - $top) $OutPath

  Write-Result @{
    ok = $true; mode = $Mode; path = (Resolve-Path $OutPath).Path
    width = [int]($right - $left); height = [int]($bottom - $top)
    bounds = @{ x = [int]$left; y = [int]$top; width = [int]($right - $left); height = [int]($bottom - $top) }
    monitor = $Monitor
    masked = ($script:Hidden.Count -gt 0)
  }
  Restore-MaskWindows
  exit 0
} catch {
  Fail 'CAPTURE_FAILED' $_.Exception.Message
} finally {
  Restore-MaskWindows
}
