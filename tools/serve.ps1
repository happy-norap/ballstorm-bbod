param([int]$Port = 8765)
# Simple static HTTP server for development (no Python/Node needed).
# Usage: powershell -ExecutionPolicy Bypass -File tools\serve.ps1 -Port 8765
# Then open http://localhost:8765/ . Stop with Ctrl+C.
# Keep this file ASCII-only: Windows PowerShell 5.1 reads BOM-less files as ANSI.

$root = Split-Path -Parent $PSScriptRoot
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "Serving $root at http://localhost:$Port/"

$types = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'
  '.css' = 'text/css; charset=utf-8'; '.mp3' = 'audio/mpeg'; '.png' = 'image/png'
  '.json' = 'application/json'; '.md' = 'text/plain; charset=utf-8'
}

try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $path = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart('/')
    if ($path -eq '') { $path = 'index.html' }
    $file = [IO.Path]::GetFullPath((Join-Path $root $path))
    $res = $ctx.Response
    if ($file.StartsWith($root) -and (Test-Path -LiteralPath $file -PathType Leaf)) {
      $ext = [IO.Path]::GetExtension($file).ToLower()
      $res.ContentType = if ($types[$ext]) { $types[$ext] } else { 'application/octet-stream' }
      $res.Headers.Add('Cache-Control', 'no-store')
      $bytes = [IO.File]::ReadAllBytes($file)
      $res.ContentLength64 = $bytes.Length
      try { $res.OutputStream.Write($bytes, 0, $bytes.Length) } catch {}
    } else {
      $res.StatusCode = 404
    }
    $res.Close()
  }
} finally {
  if ($listener.IsListening) { $listener.Stop() }
}
