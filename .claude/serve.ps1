$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:8777/")
$listener.Start()
$root = Split-Path -Parent $PSScriptRoot
while ($listener.IsListening) {
  try {
    $ctx = $listener.GetContext()
    $path = $ctx.Request.Url.AbsolutePath.TrimStart('/')
    if ([string]::IsNullOrEmpty($path)) { $path = 'hub.html' }
    $file = Join-Path $root $path
    if (Test-Path $file -PathType Leaf) {
      $bytes = [System.IO.File]::ReadAllBytes($file)
      if ($file -match '\.html?$') { $ctx.Response.ContentType = 'text/html; charset=utf-8' }
      elseif ($file -match '\.js$') { $ctx.Response.ContentType = 'application/javascript' }
      $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $ctx.Response.StatusCode = 404
    }
    $ctx.Response.Close()
  } catch { }
}
