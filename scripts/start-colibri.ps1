# Start an ALREADY INSTALLED Colibri checkout and model. No install/download steps.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$CheckoutPath,
    [Parameter(Mandatory = $true)][string]$ModelPath,
    [ValidateRange(1024, 65535)][int]$Port = 8000,
    [switch]$PrintCommand
)
$ErrorActionPreference = 'Stop'
$checkout = (Resolve-Path -LiteralPath $CheckoutPath).Path
$model = (Resolve-Path -LiteralPath $ModelPath).Path
if (!(Test-Path -LiteralPath $model -PathType Container)) { throw 'ModelPath must be a prepared Colibri model directory, not a raw GGUF file.' }
$launcher = Join-Path $checkout 'c/coli'
if (!(Test-Path -LiteralPath $launcher -PathType Leaf)) { $launcher = Join-Path $checkout 'coli' }
if (!(Test-Path -LiteralPath $launcher -PathType Leaf)) { throw 'No Colibri launcher found. Select the JustVugg/colibri checkout or release directory.' }
if ($PrintCommand) {
    # Machine-readable and safe for automated tests; never print COLI_API_KEY.
    @{ launcher = $launcher; model = $model; host = '127.0.0.1'; port = $Port } | ConvertTo-Json -Compress
    exit 0
}
$python = Get-Command py -ErrorAction SilentlyContinue
$prefix = @('-3')
if (!$python) { $python = Get-Command python -ErrorAction SilentlyContinue; $prefix = @() }
if (!$python) { throw 'Python 3 is required by Colibri. Install it separately before running this script.' }
Write-Host "Colibri will listen only on http://127.0.0.1:$Port/v1. Keep this terminal open; Ctrl+C stops it."
# Argument arrays avoid shell interpolation, including spaces and metacharacters in paths.
& $python.Source @prefix $launcher serve --model $model --host 127.0.0.1 --port $Port
if ($LASTEXITCODE -ne 0) { throw "Colibri exited with code $LASTEXITCODE. Check its local output above." }
