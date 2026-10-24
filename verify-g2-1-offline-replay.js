/**
 * G2.1 離線重播（不呼叫 MusicBrainz）
 * npm run verify:g2-1-offline-replay
 */
import { build_g2_1_offline_replay_report } from './lib/enrichment/external/g2_1_offline_replay.js';
import { G2_1_OFFLINE_REPLAY_FILE } from './lib/enrichment/external/g2_1_offline_replay.js';

const report = build_g2_1_offline_replay_report({ write: true });
console.log('\n========== G2.1 離線重播 ==========');
console.log('曲目數:', report.summary.track_count);
console.log('重算後狀態改變:', report.summary.rescored_status_changed);
console.log('fallback 查詢字串將改變（需線上才驗證）:', report.summary.fallback_query_would_change);
console.log('需重新搜尋才可能改善:', report.summary.requires_new_network_search);
console.log('寫入:', G2_1_OFFLINE_REPLAY_FILE);
console.log('====================================\n');
