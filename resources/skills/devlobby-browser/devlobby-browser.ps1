<#
.SYNOPSIS
  Ask the running DevLobby for the comments somebody is about to write on a page.

.DESCRIPTION
  Arms the element picker in DevLobby's last active browser pane, then waits for
  the user to mark the page up and press send. Prints the comments and exits.

  DevLobby publishes a loopback port and a token in bridge.json under its user
  data directory as it starts, and removes the file as it quits — so the file
  existing is also the check that DevLobby is running. Nothing here needs to know
  where DevLobby is installed.

.PARAMETER TimeoutSeconds
  How long to wait for the send. Default 15 minutes, capped by DevLobby at 30.

.PARAMETER NoPicker
  Skip arming the picker and just wait. For when the comments are already
  written and you only want to collect them.
#>
[CmdletBinding()]
param(
  [int] $TimeoutSeconds = 900,
  [switch] $NoPicker
)

$ErrorActionPreference = 'Stop'

# One plain line on standard error rather than PowerShell's block, because the
# reader of this is a Claude session and the stack trace is noise to it.
function Fail($message) {
  [Console]::Error.WriteLine("devlobby-browser: $message")
  exit 1
}

$manifestPath = Join-Path $env:APPDATA 'DevLobby\bridge.json'
if (-not (Test-Path $manifestPath)) {
  Fail "DevLobby does not appear to be running (no $manifestPath). Start DevLobby and open a browser pane first."
}

try {
  $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
} catch {
  Fail "DevLobby's bridge.json could not be read: $($_.Exception.Message)"
}

if (-not $manifest.port -or -not $manifest.token) {
  Fail "DevLobby's bridge.json is incomplete. Restart DevLobby."
}

# A manifest left behind by a crash points at a port that may now belong to
# something else, so the process it names is checked before it is trusted.
if ($manifest.pid -and -not (Get-Process -Id $manifest.pid -ErrorAction SilentlyContinue)) {
  Fail "DevLobby is not running (bridge.json names process $($manifest.pid), which is gone). Start DevLobby and open a browser pane."
}

$base = "http://127.0.0.1:$($manifest.port)"
$headers = @{ Authorization = "Bearer $($manifest.token)" }

function Invoke-DevLobby($method, $path, $body, $timeoutSec) {
  $args = @{
    Method      = $method
    Uri         = "$base$path"
    Headers     = $headers
    ContentType = 'application/json'
    TimeoutSec  = $timeoutSec
  }
  if ($body) { $args.Body = ($body | ConvertTo-Json -Compress) }
  return Invoke-RestMethod @args
}

if (-not $NoPicker) {
  try {
    Invoke-DevLobby 'POST' '/v1/select' $null 15 | Out-Null
  } catch {
    $status = $_.Exception.Response.StatusCode.value__
    if ($status -eq 409) {
      Fail 'No browser pane is open in DevLobby. Open one (the + Browser button, or Ctrl+Alt+G) and run this again.'
    }
    Fail "DevLobby refused the request: $($_.Exception.Message)"
  }
  Write-Host 'DevLobby: element picker armed. Point at things, write comments, then press Send in the pane.' -ForegroundColor Cyan
} else {
  Write-Host 'DevLobby: waiting for you to press Send in the browser pane.' -ForegroundColor Cyan
}

try {
  # Held open until the send. DevLobby caps the wait itself.
  $batch = Invoke-DevLobby 'GET' "/v1/comments?timeout=$TimeoutSeconds" $null ($TimeoutSeconds + 30)
} catch {
  $status = $_.Exception.Response.StatusCode.value__
  if ($status -eq 408) { Fail 'Timed out waiting for comments. Nothing was sent.' }
  if ($status -eq 409) { Fail 'Another Claude session is already waiting for comments from DevLobby.' }
  Fail "Waiting for comments failed: $($_.Exception.Message)"
}

if (-not $batch.comments -or $batch.comments.Count -eq 0) {
  Fail 'DevLobby sent an empty batch; nothing to work on.'
}

# DevLobby writes the batch out itself, stripping the control characters that a
# page's own markup can carry. Fall back to the raw shape only if an older
# DevLobby sent none.
if ($batch.text) {
  Write-Output $batch.text
} else {
  Write-Output ($batch | ConvertTo-Json -Depth 12)
}

# Telling DevLobby they arrived is what clears them from the pane, so it happens
# only once they are on their way to standard output.

try {
  Invoke-DevLobby 'POST' '/v1/ack' @{ batch = $batch.batch } 15 | Out-Null
} catch {
  Write-Warning "The comments were received but DevLobby was not told, so they are still in the pane: $($_.Exception.Message)"
}
