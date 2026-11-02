/** 固定台灣時區、西元曆及 ASCII 數字，不依賴主機 Locale。 */
const formatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Taipei', calendar: 'gregory', numberingSystem: 'latn',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

function timestamp(instant) {
  if (instant == null || typeof instant === 'boolean' || instant === '') return NaN;
  return new Date(instant).getTime();
}

export function format_taiwan_datetime(instant, { minute_only = false } = {}) {
  const date = new Date(timestamp(instant));
  if (!Number.isFinite(date.getTime())) return '未知（無有效截止時間）';
  const parts = Object.fromEntries(formatter.formatToParts(date).map(p => [p.type, p.value]));
  return `${parts.year}/${parts.month}/${parts.day} ${parts.hour}:${parts.minute}` +
    (minute_only ? '' : `:${parts.second}`) + '（台灣時間）';
}

/** ceil 保留已在整分鐘的截止時間；毫秒非零也必須進位。 */
export function format_taiwan_retry_time(deadline, { minute_only = true } = {}) {
  const ms = timestamp(deadline);
  return format_taiwan_datetime(Math.ceil(ms / 60000) * 60000, { minute_only });
}
