import net from 'node:net'
import {randomUUID} from 'node:crypto'
import {gzipSync} from 'node:zlib'
import {execFile} from 'node:child_process'
import {WINDOWS_RECOVERY_SCRIPTS} from './windows-platform.mjs'

// One UAC consent opens one bounded session. Only fixed scan/verified-stop
// operations run elevated. No user-writable script or result file is executed/written.
export async function openWindowsRecoverySession({sid,signal,timeoutMs=60000,execute=execFile}={}) {
  if(!/^S-1-\d+(?:-\d+)+$/.test(sid || ''))throw new Error('Invalid recovery user SID')
  const pipe='aamp-stale-recovery-'+randomUUID(),token=randomUUID()
  const pending=new Map();let socket,serial=0,closed=false,launcher
  let readyResolve,readyReject
  const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject})
  ready.catch(()=>{})
  const fail=error=>{
    readyReject(error)
    for(const request of pending.values())request.reject(error)
    pending.clear()
  }
  const server=net.createServer(connection=>{
    let buffer='',authenticated=false
    connection.setEncoding('utf8')
    connection.on('data',chunk=>{
      buffer+=chunk
      if(Buffer.byteLength(buffer)>4*1024*1024){connection.destroy();fail(new Error('Recovery response too large'));return}
      let newline
      while((newline=buffer.indexOf('\n'))>=0) {
        const line=buffer.slice(0,newline);buffer=buffer.slice(newline+1)
        let message
        try {message=JSON.parse(line)} catch {connection.destroy();fail(new Error('Invalid recovery response'));return}
        if(!authenticated) {
          if(message.token!==token || socket){connection.destroy();return}
          authenticated=true;socket=connection;readyResolve();continue
        }
        const request=pending.get(message.id)
        if(!request)continue
        pending.delete(message.id)
        if(message.ok)request.resolve(message.value)
        else request.reject(new Error('Elevated Windows recovery failed: '+message.error))
      }
    })
    connection.on('error',error=>{if(authenticated)fail(error)})
    connection.on('close',()=>{if(authenticated && !closed)fail(new Error('Recovery helper disconnected'))})
  })
  const dispose=()=>{
    if(closed)return
    closed=true;clearTimeout(timer);signal?.removeEventListener('abort',abort)
    socket?.end();server.close();launcher?.kill()
    fail(new Error('Recovery session closed'))
  }
  const abort=()=>{fail(signal.reason || new Error('Recovery cancelled'));dispose()}
  const timer=setTimeout(()=>{fail(new Error('Windows recovery authorization timed out'));dispose()},timeoutMs)
  signal?.addEventListener('abort',abort,{once:true})
  try {
    signal?.throwIfAborted()
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen('\\\\.\\pipe\\'+pipe,resolve)})
    const scripts=Object.entries(WINDOWS_RECOVERY_SCRIPTS).map(([name,source])=>`'${name}'='${source.replaceAll("'","''")}'`).join(';')
    const helper=String.raw`
$ErrorActionPreference='Stop'
if ([System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value -ne '${sid}') { throw 'Recovery must run as the original Windows user' }
$scripts=@{${scripts}}
$p=[System.IO.Pipes.NamedPipeClientStream]::new('.','${pipe}',[System.IO.Pipes.PipeDirection]::InOut)
try {
 $p.Connect(30000)
 $reader=[System.IO.StreamReader]::new($p,[Text.Encoding]::UTF8)
 $writer=[System.IO.StreamWriter]::new($p,[Text.UTF8Encoding]::new($false));$writer.AutoFlush=$true
 $writer.WriteLine((@{token='${token}'}|ConvertTo-Json -Compress))
 while($null -ne ($line=$reader.ReadLine())) {
  $request=$line|ConvertFrom-Json
  try {
   if ($request.operation -notin @('scan','stop')) { throw 'Unsupported recovery operation' }
   $payload=@{sid='${sid}';identity=$request.identity}
   if($request.operation -eq 'scan'){$payload.recorded=$request.identity}
   $env:AAMP_WINDOWS_PLATFORM_INPUT_BASE64=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($payload|ConvertTo-Json -Depth 8 -Compress)))
   $result=& ([scriptblock]::Create($scripts[$request.operation]))
   $value=($result -join "\n")|ConvertFrom-Json
   $writer.WriteLine((@{id=$request.id;ok=$true;value=$value}|ConvertTo-Json -Depth 12 -Compress))
  } catch { $writer.WriteLine((@{id=$request.id;ok=$false;error=$_.Exception.Message}|ConvertTo-Json -Compress)) }
 }
} finally {$p.Dispose()}
`
    const compressed=gzipSync(Buffer.from(helper,'utf8')).toString('base64')
    const bootstrap=`$m=[IO.MemoryStream]::new([Convert]::FromBase64String('${compressed}'));$g=[IO.Compression.GzipStream]::new($m,[IO.Compression.CompressionMode]::Decompress);$r=[IO.StreamReader]::new($g);& ([scriptblock]::Create($r.ReadToEnd()))`
    const encoded=Buffer.from(bootstrap,'utf16le').toString('base64')
    const launch=`$ErrorActionPreference='Stop';$p=Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\\WindowsPowerShell\\v1.0\\powershell.exe') -Verb RunAs -WindowStyle Hidden -ArgumentList '-NoProfile -NonInteractive -EncodedCommand ${encoded}' -PassThru;$null=$p.Handle;$p.WaitForExit();exit $p.ExitCode`
    launcher=execute('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',launch],{windowsHide:true,encoding:'utf8',timeout:timeoutMs},error=>{
      if(!closed)fail(error || new Error('Recovery helper exited'))
    })
    await ready
    return {
      async request(operation,identity) {
        signal?.throwIfAborted()
        if(closed)throw new Error('Recovery session closed')
        const id=++serial
        return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});socket.write(JSON.stringify({id,operation,identity})+'\n')})
      },
      dispose,
    }
  } catch(error) {dispose();throw error}
}
