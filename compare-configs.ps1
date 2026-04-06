$ErrorActionPreference = 'Continue'

function Run-Backtest($label, $marginType, $stopLossBaseline, $wideEvents) {
  $body = @{
    trading_pair                  = "BTC/USDC"
    start_date                    = "2025-12-31T23:00:00Z"
    end_date                      = "2026-04-03T16:01:13Z"
    price_entry                   = "1"
    price_scale                   = "1"
    amount_scale                  = "1.25"
    number_of_orders              = 11
    amount_per_trade              = "1"
    margin_type                   = $marginType
    multiplier                    = 1
    take_profit_distance_percent  = "0.5"
    account_balance               = "1000"
    monthly_addition              = "250"
    exit_on_last_order            = $false
    enable_wide_events            = $wideEvents
    stop_loss_enabled             = $true
    stop_loss_percent             = "2"
    stop_loss_baseline            = $stopLossBaseline
    stop_loss_timeout_minutes     = 30
  } | ConvertTo-Json -Compress

  Write-Host "`n>>> $label"

  # Submit
  $sw = [Diagnostics.Stopwatch]::StartNew()
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:4000/backtests" -Method POST `
      -ContentType "application/json" -Body $body -UseBasicParsing -TimeoutSec 30
    $submit = $r.Content | ConvertFrom-Json
    $id = $submit.backtestId
    if (-not $id) { Write-Host "  ERROR: no backtestId in response"; Write-Host $r.Content; return }
    Write-Host "  Submitted ID: $id"
  } catch {
    Write-Host "  SUBMIT ERROR: $_"; return
  }

  # Poll until done
  $done = $false
  for ($i = 0; $i -lt 120; $i++) {
    Start-Sleep -Seconds 2
    try {
      $poll = Invoke-WebRequest -Uri "http://127.0.0.1:4000/backtests/$id/status" -UseBasicParsing -TimeoutSec 10
      $status = ($poll.Content | ConvertFrom-Json).status
      if ($status -eq 'completed' -or $status -eq 'failed') { $done = $true; break }
    } catch {}
  }
  $sw.Stop()

  if (-not $done) { Write-Host "  TIMED OUT after $($sw.ElapsedMilliseconds)ms"; return }

  # Fetch full result
  try {
    $full = (Invoke-WebRequest -Uri "http://127.0.0.1:4000/backtests/$id" -UseBasicParsing -TimeoutSec 10).Content | ConvertFrom-Json
    $pnl  = $full.pnlSummary
    Write-Host "  ROI:              $($pnl.roi)"
    Write-Host "  Max drawdown:     $($pnl.maxDrawdown)"
    Write-Host "  Total fees:       $($pnl.totalFees)"
    Write-Host "  Exec time:        $($sw.ElapsedMilliseconds)ms wall / $($full.executionTimeMs)ms engine"
    Write-Host "  ID:               $id"
    Write-Host "  Wide events:      $wideEvents"
  } catch {
    Write-Host "  FETCH ERROR: $_"
  }
}

Run-Backtest "SCENARIO A: SWEEP config        (average_entries + cross    + no wide events)" "cross"    "average_entries" $false
Run-Backtest "SCENARIO B: USER config         (first_entry    + isolated  + no wide events)" "isolated" "first_entry"     $false
Run-Backtest "SCENARIO C: USER config + WIDE  (first_entry    + isolated  + wide events)"    "isolated" "first_entry"     $true
