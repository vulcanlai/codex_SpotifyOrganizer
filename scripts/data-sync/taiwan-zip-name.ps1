# Windows 10/11: Taipei Standard Time is the Windows ID for Asia/Taipei.
# Explicit Gregorian calendar and invariant ASCII digits; no CurrentCulture defaults.
function Get-SpotifyHandoffFileName {
  param([DateTimeOffset]$Instant = [DateTimeOffset]::UtcNow)
  $taipeiZone = [TimeZoneInfo]::FindSystemTimeZoneById('Taipei Standard Time')
  $taipeiTime = [TimeZoneInfo]::ConvertTime($Instant, $taipeiZone)
  $culture = [Globalization.CultureInfo]::InvariantCulture.Clone()
  $culture.DateTimeFormat.Calendar = New-Object Globalization.GregorianCalendar
  $stamp = $taipeiTime.ToString('yyyyMMdd-HHmmss', $culture)
  return "spotify-handoff-$stamp.zip"
}
