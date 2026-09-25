$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing

$projectRoot = Split-Path -Parent $PSScriptRoot
$assetsPath = Join-Path $projectRoot "extension\assets"

function New-RoundedRectanglePath {
  param(
    [System.Drawing.RectangleF] $Rectangle,
    [float] $Radius
  )

  $diameter = $Radius * 2
  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $path.AddArc($Rectangle.X, $Rectangle.Y, $diameter, $diameter, 180, 90)
  $path.AddArc($Rectangle.Right - $diameter, $Rectangle.Y, $diameter, $diameter, 270, 90)
  $path.AddArc($Rectangle.Right - $diameter, $Rectangle.Bottom - $diameter, $diameter, $diameter, 0, 90)
  $path.AddArc($Rectangle.X, $Rectangle.Bottom - $diameter, $diameter, $diameter, 90, 90)
  $path.CloseFigure()
  return $path
}

function Convert-Point {
  param(
    [float] $X,
    [float] $Y,
    [float] $Origin,
    [float] $Unit
  )

  return [System.Drawing.PointF]::new($Origin + ($X * $Unit), $Origin + ($Y * $Unit))
}

function New-ExtensionIcon {
  param(
    [int] $Size,
    [float] $Padding
  )

  $bitmap = [System.Drawing.Bitmap]::new(
    $Size,
    $Size,
    [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
  )
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.Clear([System.Drawing.Color]::Transparent)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

  $artSize = $Size - (2 * $Padding)
  $border = [Math]::Max(1, $artSize * 0.03125)
  $outerBounds = [System.Drawing.RectangleF]::new($Padding, $Padding, $artSize, $artSize)
  $innerBounds = [System.Drawing.RectangleF]::new(
    $Padding + $border,
    $Padding + $border,
    $artSize - (2 * $border),
    $artSize - (2 * $border)
  )

  $outerPath = New-RoundedRectanglePath $outerBounds ($artSize * 0.177)
  $innerPath = New-RoundedRectanglePath $innerBounds (($artSize * 0.177) - $border)
  $mintBrush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml("#83bfa9"))
  $darkBrush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml("#202721"))
  $whiteBrush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml("#fffdf8"))
  $lightMintBrush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml("#a9d7c4"))

  $graphics.FillPath($mintBrush, $outerPath)
  $graphics.FillPath($darkBrush, $innerPath)

  $unit = $artSize / 64
  $font = [System.Drawing.Font]::new(
    "Segoe UI",
    $artSize * 0.5,
    [System.Drawing.FontStyle]::Bold,
    [System.Drawing.GraphicsUnit]::Pixel
  )
  $graphics.DrawString(
    "S",
    $font,
    $whiteBrush,
    $Padding + ($artSize * 0.07),
    $Padding + ($artSize * 0.15)
  )

  $firstPlus = @(
    (Convert-Point 38 24 $Padding $unit),
    (Convert-Point 42 24 $Padding $unit),
    (Convert-Point 42 30 $Padding $unit),
    (Convert-Point 47 30 $Padding $unit),
    (Convert-Point 47 35 $Padding $unit),
    (Convert-Point 42 35 $Padding $unit),
    (Convert-Point 42 41 $Padding $unit),
    (Convert-Point 38 41 $Padding $unit),
    (Convert-Point 38 35 $Padding $unit),
    (Convert-Point 33 35 $Padding $unit),
    (Convert-Point 33 30 $Padding $unit),
    (Convert-Point 38 30 $Padding $unit)
  )
  $graphics.FillPolygon($mintBrush, $firstPlus)

  $secondPlus = @(
    (Convert-Point 52 24 $Padding $unit),
    (Convert-Point 56 24 $Padding $unit),
    (Convert-Point 56 30 $Padding $unit),
    (Convert-Point 61 30 $Padding $unit),
    (Convert-Point 61 35 $Padding $unit),
    (Convert-Point 56 35 $Padding $unit),
    (Convert-Point 56 41 $Padding $unit),
    (Convert-Point 52 41 $Padding $unit),
    (Convert-Point 52 35 $Padding $unit),
    (Convert-Point 47 35 $Padding $unit),
    (Convert-Point 47 30 $Padding $unit),
    (Convert-Point 52 30 $Padding $unit)
  )
  $graphics.FillPolygon($lightMintBrush, $secondPlus)

  $outputPath = Join-Path $assetsPath "icon$Size.png"
  $bitmap.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)

  $outerPath.Dispose()
  $innerPath.Dispose()
  $mintBrush.Dispose()
  $darkBrush.Dispose()
  $whiteBrush.Dispose()
  $lightMintBrush.Dispose()
  $font.Dispose()
  $graphics.Dispose()
  $bitmap.Dispose()
}

New-ExtensionIcon -Size 128 -Padding 16
New-ExtensionIcon -Size 48 -Padding 2
New-ExtensionIcon -Size 32 -Padding 1.5
New-ExtensionIcon -Size 16 -Padding 0.75

Write-Host "Extension icons generated in extension/assets"
