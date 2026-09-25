$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing

$projectRoot = Split-Path -Parent $PSScriptRoot
$outputDirectory = Join-Path $projectRoot "store-assets"
$outputPath = Join-Path $outputDirectory "chrome-web-store-screenshot-1280x800.png"
$iconPath = Join-Path $projectRoot "extension\assets\icon128.png"

New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null

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

function Fill-RoundedRectangle {
  param(
    [System.Drawing.Graphics] $Graphics,
    [System.Drawing.Brush] $Brush,
    [System.Drawing.RectangleF] $Rectangle,
    [float] $Radius
  )

  $path = New-RoundedRectanglePath $Rectangle $Radius
  $Graphics.FillPath($Brush, $path)
  $path.Dispose()
}

function Draw-RoundedRectangle {
  param(
    [System.Drawing.Graphics] $Graphics,
    [System.Drawing.Pen] $Pen,
    [System.Drawing.RectangleF] $Rectangle,
    [float] $Radius
  )

  $path = New-RoundedRectanglePath $Rectangle $Radius
  $Graphics.DrawPath($Pen, $path)
  $path.Dispose()
}

function New-Font {
  param(
    [float] $Size,
    [System.Drawing.FontStyle] $Style = [System.Drawing.FontStyle]::Regular
  )

  return [System.Drawing.Font]::new(
    "Segoe UI",
    $Size,
    $Style,
    [System.Drawing.GraphicsUnit]::Pixel
  )
}

$bitmap = [System.Drawing.Bitmap]::new(
  1280,
  800,
  [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit
$graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
$graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$graphics.Clear([System.Drawing.ColorTranslator]::FromHtml("#eef1ed"))

$gridPen = [System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml("#dce2dc"), 1)
for ($x = 0; $x -le 1280; $x += 64) {
  $graphics.DrawLine($gridPen, $x, 0, $x, 800)
}
for ($y = 0; $y -le 800; $y += 64) {
  $graphics.DrawLine($gridPen, 0, $y, 1280, $y)
}

$darkBrush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml("#202721"))
$greenBrush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml("#2f6f5e"))
$mintBrush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml("#83bfa9"))
$lightMintBrush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml("#dcebe4"))
$whiteBrush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml("#fffdf8"))
$mutedBrush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml("#667068"))
$panelBrush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml("#f8faf7"))
$borderPen = [System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml("#c7cec8"), 1.5)
$darkBorderPen = [System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml("#536259"), 1.5)

$brandFont = New-Font 27 ([System.Drawing.FontStyle]::Bold)
$badgeFont = New-Font 14 ([System.Drawing.FontStyle]::Bold)
$titleFont = New-Font 58 ([System.Drawing.FontStyle]::Bold)
$leadFont = New-Font 23
$featureFont = New-Font 18 ([System.Drawing.FontStyle]::Bold)
$bodyFont = New-Font 15
$popupTitleFont = New-Font 25 ([System.Drawing.FontStyle]::Bold)
$popupSubtitleFont = New-Font 13
$statusFont = New-Font 16 ([System.Drawing.FontStyle]::Bold)
$statusDetailFont = New-Font 13
$buttonFont = New-Font 15 ([System.Drawing.FontStyle]::Bold)
$smallFont = New-Font 12
$tinyFont = New-Font 11

$icon = [System.Drawing.Image]::FromFile($iconPath)
$graphics.DrawImage($icon, 68, 58, 72, 72)
$graphics.DrawString("School++", $brandFont, $darkBrush, 147, 78)

$badgeRectangle = [System.Drawing.RectangleF]::new(68, 170, 260, 38)
Fill-RoundedRectangle $graphics $lightMintBrush $badgeRectangle 19
$badgeFormat = [System.Drawing.StringFormat]::new()
$badgeFormat.Alignment = [System.Drawing.StringAlignment]::Center
$badgeFormat.LineAlignment = [System.Drawing.StringAlignment]::Center
$graphics.DrawString("РАСШИРЕНИЕ ДЛЯ БРАУЗЕРА", $badgeFont, $greenBrush, $badgeRectangle, $badgeFormat)

$titleRectangle = [System.Drawing.RectangleF]::new(68, 241, 610, 156)
$graphics.DrawString("Данные дневника`nв удобном виде", $titleFont, $darkBrush, $titleRectangle)
$leadRectangle = [System.Drawing.RectangleF]::new(70, 418, 580, 92)
$graphics.DrawString(
  "Расписание, задания и отметки из e.school.by`nсинхронизируются в School++.",
  $leadFont,
  $mutedBrush,
  $leadRectangle
)

$features = @(
  @{ Y = 555; Title = "Одна кнопка"; Text = "Данные переносятся автоматически" },
  @{ Y = 623; Title = "Без передачи пароля"; Text = "Расширение использует открытую сессию дневника" }
)
foreach ($feature in $features) {
  $circleRectangle = [System.Drawing.RectangleF]::new(70, $feature.Y, 42, 42)
  Fill-RoundedRectangle $graphics $greenBrush $circleRectangle 21
  $checkPen = [System.Drawing.Pen]::new([System.Drawing.Color]::White, 3)
  $checkPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $checkPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $graphics.DrawLines(
    $checkPen,
    [System.Drawing.PointF[]] @(
      [System.Drawing.PointF]::new(81, $feature.Y + 21),
      [System.Drawing.PointF]::new(88, $feature.Y + 28),
      [System.Drawing.PointF]::new(101, $feature.Y + 14)
    )
  )
  $checkPen.Dispose()
  $graphics.DrawString($feature.Title, $featureFont, $darkBrush, 128, $feature.Y - 1)
  $graphics.DrawString($feature.Text, $bodyFont, $mutedBrush, 128, $feature.Y + 25)
}
$graphics.DrawString("schoolpp.com", $featureFont, $greenBrush, 70, 718)

for ($offset = 18; $offset -ge 4; $offset -= 4) {
  $shadowColor = [System.Drawing.Color]::FromArgb(5, 32, 39, 33)
  $shadowBrush = [System.Drawing.SolidBrush]::new($shadowColor)
  Fill-RoundedRectangle $graphics $shadowBrush ([System.Drawing.RectangleF]::new(728, 42 + $offset, 484, 716)) 28
  $shadowBrush.Dispose()
}

$browserRectangle = [System.Drawing.RectangleF]::new(728, 42, 484, 716)
Fill-RoundedRectangle $graphics $darkBrush $browserRectangle 28

$graphics.FillEllipse([System.Drawing.Brushes]::IndianRed, 754, 69, 12, 12)
$graphics.FillEllipse([System.Drawing.Brushes]::Goldenrod, 775, 69, 12, 12)
$graphics.FillEllipse($mintBrush, 796, 69, 12, 12)
$graphics.DrawString("School++", $smallFont, $whiteBrush, 832, 66)
$graphics.DrawString("Синхронизация данных", $tinyFont, $mintBrush, 832, 84)

$popupRectangle = [System.Drawing.RectangleF]::new(744, 112, 452, 630)
Fill-RoundedRectangle $graphics $panelBrush $popupRectangle 20

$graphics.DrawString("School++", $popupTitleFont, $darkBrush, 772, 142)
$graphics.DrawString("Синхронизация данных", $popupSubtitleFont, $mutedBrush, 773, 176)

$settingsRectangle = [System.Drawing.RectangleF]::new(1118, 137, 44, 44)
Fill-RoundedRectangle $graphics $whiteBrush $settingsRectangle 11
Draw-RoundedRectangle $graphics $borderPen $settingsRectangle 11
$graphics.DrawEllipse($darkBorderPen, 1133, 152, 14, 14)
$graphics.FillEllipse($darkBrush, 1138, 157, 4, 4)

$graphics.FillEllipse($greenBrush, 775, 229, 12, 12)
$graphics.DrawString("Данные готовы", $statusFont, $darkBrush, 800, 220)
$graphics.DrawString("Следующая проверка через 28 минут.", $statusDetailFont, $mutedBrush, 800, 247)

$syncRectangle = [System.Drawing.RectangleF]::new(772, 292, 352, 58)
Fill-RoundedRectangle $graphics $greenBrush $syncRectangle 13
$graphics.DrawString("Синхронизировать снова", $buttonFont, $whiteBrush, 792, 310)

$dataRectangle = [System.Drawing.RectangleF]::new(772, 370, 352, 50)
Fill-RoundedRectangle $graphics $whiteBrush $dataRectangle 11
Draw-RoundedRectangle $graphics $borderPen $dataRectangle 11
$graphics.DrawString("Данные", $bodyFont, $mutedBrush, 791, 385)
$graphics.DrawString("9", $bodyFont, $darkBrush, 858, 385)
$arrowPen = [System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml("#667068"), 2)
$graphics.DrawLines(
  $arrowPen,
  [System.Drawing.PointF[]] @(
    [System.Drawing.PointF]::new(1084, 391),
    [System.Drawing.PointF]::new(1092, 399),
    [System.Drawing.PointF]::new(1100, 391)
  )
)

$openRectangle = [System.Drawing.RectangleF]::new(772, 440, 352, 50)
Fill-RoundedRectangle $graphics $whiteBrush $openRectangle 11
Draw-RoundedRectangle $graphics $borderPen $openRectangle 11
$openFormat = [System.Drawing.StringFormat]::new()
$openFormat.Alignment = [System.Drawing.StringAlignment]::Center
$openFormat.LineAlignment = [System.Drawing.StringAlignment]::Center
$graphics.DrawString("Открыть School++", $buttonFont, $greenBrush, $openRectangle, $openFormat)

$dividerPen = [System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml("#d6dcd6"), 1)
$graphics.DrawLine($dividerPen, 772, 539, 1124, 539)
$helpRectangle = [System.Drawing.RectangleF]::new(772, 560, 352, 34)
$graphics.DrawString("Справка", $smallFont, $greenBrush, $helpRectangle, $openFormat)

$lockPen = [System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml("#667068"), 1.7)
$graphics.DrawRectangle($lockPen, 839, 620, 16, 14)
$graphics.DrawArc($lockPen, 842, 611, 10, 15, 180, 180)
$graphics.DrawString("Логины и пароли не сохраняются", $smallFont, $mutedBrush, 866, 616)

$bitmap.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)

$icon.Dispose()
$gridPen.Dispose()
$darkBrush.Dispose()
$greenBrush.Dispose()
$mintBrush.Dispose()
$lightMintBrush.Dispose()
$whiteBrush.Dispose()
$mutedBrush.Dispose()
$panelBrush.Dispose()
$borderPen.Dispose()
$darkBorderPen.Dispose()
$arrowPen.Dispose()
$dividerPen.Dispose()
$lockPen.Dispose()
$brandFont.Dispose()
$badgeFont.Dispose()
$titleFont.Dispose()
$leadFont.Dispose()
$featureFont.Dispose()
$bodyFont.Dispose()
$popupTitleFont.Dispose()
$popupSubtitleFont.Dispose()
$statusFont.Dispose()
$statusDetailFont.Dispose()
$buttonFont.Dispose()
$smallFont.Dispose()
$tinyFont.Dispose()
$badgeFormat.Dispose()
$openFormat.Dispose()
$graphics.Dispose()
$bitmap.Dispose()

Write-Host "Chrome Web Store screenshot generated: $outputPath"

