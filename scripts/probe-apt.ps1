$mirrors = @(
  'https://mirrors.aliyun.com/debian/',
  'https://mirrors.tuna.tsinghua.edu.cn/debian/',
  'https://mirrors.ustc.edu.cn/debian/',
  'https://mirrors.cloud.tencent.com/debian/',
  'https://mirrors.huaweicloud.com/debian/',
  'https://deb.debian.org/debian/'
)
foreach ($m in $mirrors) {
  $u = $m + 'dists/bookworm/Release'
  try {
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $r = Invoke-WebRequest -Uri $u -Method Head -TimeoutSec 12 -UseBasicParsing -ErrorAction Stop
    Write-Output ($m + ' -> HTTP ' + $r.StatusCode + ' in ' + $sw.ElapsedMilliseconds + 'ms')
  } catch {
    $code = $_.Exception.Response.StatusCode.value__
    if ($code) { Write-Output ($m + ' -> HTTP ' + $code) } else { Write-Output ($m + ' -> UNREACHABLE') }
  }
}