import { load_enrichment_status, format_enrichment_status } from './lib/enrichment/status.js';

try {
  console.log(format_enrichment_status(load_enrichment_status()));
} catch (err) {
  console.error(`無法查詢歌曲補全狀態：${err.message}`);
  process.exitCode = 1;
}
