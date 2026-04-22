Add-Type -AssemblyName System.Drawing

$iconsDir = "e:\web\chrome extentions\youtube comments\icons"
$files = @("icon-white.jpg", "icon-blue.jpg")
$sizes = @(16, 48, 128)

foreach ($file in $files) {
    $sourcePath = Join-Path $iconsDir $file
    if (Test-Path $sourcePath) {
        Write-Host "Processing $file..."
        $img = [System.Drawing.Image]::FromFile($sourcePath)
        $baseName = [System.IO.Path]::GetFileNameWithoutExtension($file)
        
        foreach ($size in $sizes) {
            $newName = "$baseName-$size.png"
            $newPath = Join-Path $iconsDir $newName
            
            # Create resized bitmap
            $bmp = New-Object System.Drawing.Bitmap($img, $size, $size)
            
            # Save as PNG
            $bmp.Save($newPath, [System.Drawing.Imaging.ImageFormat]::Png)
            $bmp.Dispose()
            
            Write-Host "Created $newName ($size x $size)"
        }
        $img.Dispose()
    }
    else {
        Write-Host "File not found: $sourcePath"
    }
}

Write-Host "Done!"
