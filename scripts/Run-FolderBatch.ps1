$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Windows.Forms

function Pick-Folder($description) {
  $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
  $dialog.Description = $description
  $dialog.ShowNewFolderButton = $false
  if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) {
    throw "Folder selection cancelled."
  }
  return $dialog.SelectedPath
}

function Pick-File($title, $filter) {
  $dialog = New-Object System.Windows.Forms.OpenFileDialog
  $dialog.Title = $title
  $dialog.Filter = $filter
  if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) {
    throw "File selection cancelled."
  }
  return $dialog.FileName
}

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$imagesFolder = Pick-Folder "Choose the folder that contains your images"
$titlesFile = Pick-File "Choose the titles text file" "Text Files (*.txt)|*.txt"

$variants = Read-Host "Variants per image (default 1)"
if ([string]::IsNullOrWhiteSpace($variants)) { $variants = "1" }

$format = Read-Host "Format: jpg/png/webp (default jpg)"
if ([string]::IsNullOrWhiteSpace($format)) { $format = "jpg" }

$template = Read-Host "Template: auto or a template id (default auto)"
if ([string]::IsNullOrWhiteSpace($template)) { $template = "auto" }

$scriptPath = Join-Path $root "scripts\batchRender.js"

Write-Host ""
Write-Host "Starting folder batch render..." -ForegroundColor Cyan
Write-Host "Images: $imagesFolder"
Write-Host "Titles: $titlesFile"
Write-Host ""

node $scriptPath --folder $imagesFolder --titles $titlesFile --variants $variants --format $format --template $template

Write-Host ""
Read-Host "Done. Press Enter to close"
