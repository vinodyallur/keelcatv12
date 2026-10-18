$ErrorActionPreference = "Stop"
$token = (gh auth token).Trim()
$body = @{ token = $token; repo = "apisteward-demo" } | ConvertTo-Json
try {
  $r = Invoke-RestMethod -Uri "http://localhost:8787/api/github/autodemo" -Method Post -ContentType "application/json" -Body $body
  $out = [ordered]@{
    created   = $r.created
    repo      = $r.repo
    repoUrl   = $r.repoUrl
    scanned   = $r.scannedFiles
    changes   = $r.changeRecords.Count
    edits     = $r.edits.Count
    prUrl     = $r.pr.url
    prNumber  = $r.pr.number
  }
  $out | ConvertTo-Json | Out-File -FilePath "demo-result.json" -Encoding utf8
} catch {
  @{ error = $_.Exception.Message; detail = $_.ErrorDetails.Message } | ConvertTo-Json | Out-File -FilePath "demo-result.json" -Encoding utf8
}
