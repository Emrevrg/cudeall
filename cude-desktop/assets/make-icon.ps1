Add-Type -AssemblyName System.Drawing
$bmp = New-Object Drawing.Bitmap(256, 256)
$g = [Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = "AntiAlias"
$g.Clear([Drawing.Color]::Transparent)
$brush = New-Object Drawing.SolidBrush([Drawing.Color]::FromArgb(226, 106, 58))
$rect = New-Object Drawing.Rectangle(8, 8, 240, 240)
$gp = New-Object Drawing.Drawing2D.GraphicsPath
$gp.AddArc($rect.X, $rect.Y, 64, 64, 180, 90)
$gp.AddArc($rect.Right - 64, $rect.Y, 64, 64, 270, 90)
$gp.AddArc($rect.Right - 64, $rect.Bottom - 64, 64, 64, 0, 90)
$gp.AddArc($rect.X, $rect.Bottom - 64, 64, 64, 90, 90)
$gp.CloseFigure()
$g.FillPath($brush, $gp)
$font = New-Object Drawing.Font("Segoe UI", 150, [Drawing.FontStyle]::Bold)
$sf = New-Object Drawing.StringFormat
$sf.Alignment = "Center"
$sf.LineAlignment = "Center"
$rf = New-Object Drawing.RectangleF(8, 8, 240, 240)
$g.DrawString("C", $font, [Drawing.Brushes]::White, $rf, $sf)
$bmp.Save("assets/icon.png")
$g.Dispose()
$bmp.Dispose()
"ICON-OK"
