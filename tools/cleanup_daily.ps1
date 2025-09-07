# Optional cleanup for legacy Daily artifacts. Review before running.
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$web  = Split-Path -Parent $root

# Files that are safe to remove
$dailyBlog = Get-ChildItem -Path "$web/blog" -Filter "*-ai-daily-*.html" -ErrorAction SilentlyContinue
$dailyOg   = Get-ChildItem -Path "$web/assets/og" -Filter "*-ai-daily-*.*" -ErrorAction SilentlyContinue
$dataDir   = Join-Path $web "data/ai/blog"
$dataFiles = @("index.json","sections.json","rss.xml") | ForEach-Object { Join-Path $dataDir $_ }

Write-Host "Daily blog posts:" ($dailyBlog.Count)
Write-Host "Daily OG images:"  ($dailyOg.Count)
Write-Host "Daily data files:" ($dataFiles -join ", ")
Write-Host "Review and uncomment the Remove-Item lines to delete."

# Remove-Item -LiteralPath $dataFiles -Force -ErrorAction SilentlyContinue
# Remove-Item -Path $dailyBlog.FullName -Force -ErrorAction SilentlyContinue
# Remove-Item -Path $dailyOg.FullName -Force -ErrorAction SilentlyContinue
