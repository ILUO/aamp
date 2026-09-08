import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

// Protect the destination before creating any temporary file containing secrets.
// The Bridge is independently runnable and cannot rely on Controller setup.
export async function protectPrivateJsonDirectory(directory: string): Promise<void> {
  const script = String.raw`
$ErrorActionPreference = 'Stop'

$currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$systemSid = New-Object System.Security.Principal.SecurityIdentifier('S-1-5-18')
$administratorsSid = New-Object System.Security.Principal.SecurityIdentifier('S-1-5-32-544')
$acl = Get-Acl -LiteralPath $env:AAMP_PRIVATE_JSON_DIRECTORY
$acl.SetAccessRuleProtection($true, $false)
$acl.SetOwner($currentSid)
foreach ($rule in @($acl.Access)) { [void]$acl.RemoveAccessRuleSpecific($rule) }
$inheritance = [System.Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
$propagation = [System.Security.AccessControl.PropagationFlags]::None
$allow = [System.Security.AccessControl.AccessControlType]::Allow
foreach ($sid in @($currentSid, $systemSid, $administratorsSid)) {
  $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
    $sid, [System.Security.AccessControl.FileSystemRights]::FullControl,
    $inheritance, $propagation, $allow
  )
  [void]$acl.AddAccessRule($rule)
}
Set-Acl -LiteralPath $env:AAMP_PRIVATE_JSON_DIRECTORY -AclObject $acl
$verified = Get-Acl -LiteralPath $env:AAMP_PRIVATE_JSON_DIRECTORY
if (-not $verified.AreAccessRulesProtected) { throw 'private directory still inherits access rules' }
$verifiedOwner = $verified.Owner
if ($verifiedOwner -ne $currentSid.Value -and $verifiedOwner -ne $currentSid.Translate([System.Security.Principal.NTAccount]).Value) {
  throw ('private directory owner is not the current user: ' + $verifiedOwner)
}
$allowedSids = @($currentSid.Value, $systemSid.Value, $administratorsSid.Value)
$hasCurrentUserFullControl = $false
foreach ($rule in $verified.Access) {
  $sid = $rule.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value
  if ($rule.AccessControlType -ne $allow -or $allowedSids -notcontains $sid) {
    throw ('private directory contains an unexpected access rule for ' + $sid)
  }
  if ($sid -eq $currentSid.Value -and (($rule.FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::FullControl) -eq [System.Security.AccessControl.FileSystemRights]::FullControl)) {
    $hasCurrentUserFullControl = $true
  }
}
if (-not $hasCurrentUserFullControl) { throw 'private directory lacks current user FullControl' }
@{ path = $env:AAMP_PRIVATE_JSON_DIRECTORY; ownerSid = $currentSid.Value } | ConvertTo-Json -Compress

`
  await execFileAsync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64'),
  ], { timeout: 15_000, windowsHide: true, env: { ...process.env, AAMP_PRIVATE_JSON_DIRECTORY: directory } })
}
