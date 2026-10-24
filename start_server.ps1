# Minimal localhost HTTP server for the offline terrain editor
$root = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'dist'
if (-not (Test-Path -LiteralPath (Join-Path $root 'index.html'))) {
  throw 'Build missing. Run npm install and npm run build in the terrain_editor folder.'
}
$root = [System.IO.Path]::GetFullPath($root)
$port = 8080
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
$listener.Start()
Write-Host "Server: http://localhost:$port/terrain_editor.html  (Ctrl+C to stop)"
Start-Process "http://localhost:$port/terrain_editor.html"
$types = @{ ".html"="text/html; charset=utf-8"; ".js"="text/javascript; charset=utf-8"; ".css"="text/css; charset=utf-8"; ".json"="application/json"; ".map"="application/json"; ".png"="image/png"; ".txt"="text/plain; charset=utf-8" }
while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $path = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath.TrimStart('/'))
  if ($path -eq "") { $path = "terrain_editor.html" }
  $file = [System.IO.Path]::GetFullPath((Join-Path $root $path))
  if ($file.StartsWith($root + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $file -PathType Leaf)) {
    $ext = [System.IO.Path]::GetExtension($file).ToLower()
    $ctx.Response.ContentType = $(if ($types.ContainsKey($ext)) { $types[$ext] } else { "application/octet-stream" })
    $bytes = [System.IO.File]::ReadAllBytes($file)
    $ctx.Response.ContentLength64 = $bytes.Length
    $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  } else { $ctx.Response.StatusCode = 404 }
  $ctx.Response.Close()
}
