# Generates build/icon.ico (multi-size, PNG-compressed): a 3x3 mini board.
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $root 'build'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$sizes = 16, 24, 32, 48, 64, 128, 256
$pngs = @()

function New-RoundedPath([single]$x, [single]$y, [single]$w, [single]$h, [single]$r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = [single]($r * 2)
  $p.AddArc($x, $y, $d, $d, 180, 90)
  $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}

foreach ($s in $sizes) {
  $bmp = New-Object System.Drawing.Bitmap $s, $s
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)

  $pad = [single][Math]::Max(0.5, $s * 0.04)
  $rad = [single]($s * 0.22)
  $body = New-RoundedPath $pad $pad ($s - 2 * $pad) ($s - 2 * $pad) $rad
  $blend = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.RectangleF 0, 0, $s, $s),
    [System.Drawing.Color]::FromArgb(255, 22, 30, 52),
    [System.Drawing.Color]::FromArgb(255, 7, 10, 18),
    90)
  $g.FillPath($blend, $body)
  $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 236, 186, 82)), ([single][Math]::Max(0.8, $s * 0.022))
  $g.DrawPath($pen, $body)

  # 3x3 board
  $inset = [single]($s * 0.19)
  $area = [single]($s - 2 * $inset)
  $gap = [single]($s * 0.035)
  $tw = [single](($area - 2 * $gap) / 3)
  $tr = [single][Math]::Max(0.6, $s * 0.045)

  $cream = [System.Drawing.Color]::FromArgb(255, 240, 224, 194)
  $creamDim = [System.Drawing.Color]::FromArgb(255, 214, 189, 145)
  $gold = [System.Drawing.Color]::FromArgb(255, 236, 186, 82)
  $red = [System.Drawing.Color]::FromArgb(255, 217, 74, 61)
  $blue = [System.Drawing.Color]::FromArgb(255, 52, 120, 207)

  $colors = @(
    $creamDim, $cream, $cream,
    $cream, $gold, $cream,
    $red, $cream, $blue
  )

  for ($i = 0; $i -lt 9; $i++) {
    $col = $i % 3
    $row = [Math]::Floor($i / 3)
    $x = [single]($inset + $col * ($tw + $gap))
    $y = [single]($inset + $row * ($tw + $gap))
    $tile = New-RoundedPath $x $y $tw $tw $tr
    $brush = New-Object System.Drawing.SolidBrush $colors[$i]
    $g.FillPath($brush, $tile)
    $brush.Dispose(); $tile.Dispose()
  }

  $g.Dispose()
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $pngs += , @{ size = $s; bytes = $ms.ToArray() }
  $ms.Dispose(); $bmp.Dispose()
  $pen.Dispose(); $body.Dispose(); $blend.Dispose()
}

$ms = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter $ms
$bw.Write([UInt16]0); $bw.Write([UInt16]1); $bw.Write([UInt16]$pngs.Count)
$offset = 6 + 16 * $pngs.Count
foreach ($p in $pngs) {
  $dim = if ($p.size -ge 256) { 0 } else { $p.size }
  $bw.Write([Byte]$dim); $bw.Write([Byte]$dim)
  $bw.Write([Byte]0); $bw.Write([Byte]0)
  $bw.Write([UInt16]1); $bw.Write([UInt16]32)
  $bw.Write([UInt32]$p.bytes.Length); $bw.Write([UInt32]$offset)
  $offset += $p.bytes.Length
}
foreach ($p in $pngs) { $bw.Write($p.bytes) }
$bw.Flush()
[System.IO.File]::WriteAllBytes((Join-Path $outDir 'icon.ico'), $ms.ToArray())
$bw.Dispose(); $ms.Dispose()
[System.IO.File]::WriteAllBytes((Join-Path $outDir 'icon.png'), ($pngs | Where-Object { $_.size -eq 256 }).bytes)

Write-Output ("icon.ico written: " + (Get-Item (Join-Path $outDir 'icon.ico')).Length + " bytes")
