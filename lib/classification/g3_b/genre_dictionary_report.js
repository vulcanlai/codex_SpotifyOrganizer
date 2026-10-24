/**
 * G3-B.5 分類字典品質分析（建議 only，不改字典）
 */
import { MAIN_GENRES, SUBGENRES_BY_CODE, subgenres_for_main } from '../genre_taxonomy.js';

/**
 * G3-B.4 曾失敗案例與字典對應說明
 */
export function build_genre_dictionary_quality_report() {
  const cases = [
    {
      incident: 'g3_b4_batch_01',
      track_id: '07BLMnpZYg6RT0H1elobry',
      ai_mistake: { primary_genre: 'rock', subgenres: ['folk_rock'] },
      correction: { primary_genre: 'folk', secondary_genres: ['rock'], subgenres: ['folk_rock'] },
      root_cause_zh:
        'folk_rock 在字典中 parent=folk；AI 選 rock 為 primary 導致 validate 拒絕，非驗證放寬。',
    },
    {
      incident: 'g3_b4_batch_04',
      track_id: '1Ehdm1PDlKrdfyBsjwEvd1',
      ai_mistake: { primary_genre: 'pop', subgenres: ['pop_rock'] },
      correction: { primary_genre: 'rock', secondary_genres: ['pop'], subgenres: ['pop_rock'] },
      root_cause_zh:
        'pop_rock 在字典中 parent=rock；應 primary=rock 或改選 pop_ballad 等 pop 子類，而非 pop+pop_rock。',
    },
  ];

  const main_sub_map = {};
  for (let i = 0; i < MAIN_GENRES.length; i += 1) {
    const code = MAIN_GENRES[i].code;
    main_sub_map[code] = subgenres_for_main(code).map(function (r) {
      return r.code;
    });
  }

  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    dictionary_unchanged: true,
    validation_rule_zh: 'subgenres[].main 必須等於 genre_profile.primary_genre（primary=unknown 除外）',
    g3_b4_incidents: cases,
    main_to_allowed_subgenres: main_sub_map,
    recommendations_zh: [
      'AI 匯入 markdown／JSON 輸入應附 main_to_allowed_subgenres，減少 AI 組合非法子曲風。',
      '跨曲風（民謠搖滾、流行搖滾）優先：正確 primary + 對應 subgenre，必要時用 secondary_genres 表達副主曲風，勿為通過驗證硬改 primary。',
      '可選：匯入前 lint 提示「建議 primary=X」而非自動改寫使用者／AI 草稿。',
      'folk_rock／pop_rock 等「合成標籤」在 Spotify 語境常雙向；字典以單一 parent 為準，AI prompt 需明確寫出。',
    ],
    ai_input_gap_zh:
      '現行 cursor-g3b-input 僅列 12 主曲風代碼，未列各主曲風可用 40 子曲風；建議 G3-B.6 匯出時附加 subgenres_for_main 表。',
    did_validation_distort_genre_zh:
      '否。G3-B.4 兩首最終以修正草稿 primary 匯入，未在 import 程式內 silently 改寫曲風。',
  };
}
