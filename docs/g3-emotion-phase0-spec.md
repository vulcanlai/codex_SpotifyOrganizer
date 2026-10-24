# G3 情緒分類 Phase 0 規格

> 曲風（G3-F）與情緒雙軌；本規格不修改 `genre_profile`、`g3-f-adopt-registry` 或 `classification-index`。

## 1. 情緒詞表（Taxonomy）

| code | 繁中標籤 |
|------|----------|
| `melancholy_sad` | 悲傷・傷感 |
| `relaxed_comfort` | 輕鬆・舒服 |
| `upbeat_joy` | 輕快・愉悅 |
| `energetic_passion` | 熱血・動感 |
| `romantic_tender` | 浪漫・深情 |
| `late_night_calm` | 深夜・沉靜 |

程式：`lib/classification/g3_emotion/emotion_taxonomy.js`（`EMOTION_TAXONOMY_VERSION = 1`）。

儲存維度代碼：`emotion`（**不同於** legacy AI 的 `moods`→`context` 情境）。

## 2. 候選／Staged Inference Schema

- `schema_version`: `1`（`EMOTION_CANDIDATE_SCHEMA_VERSION`）
- `track_id`: string（必填）
- `emotion_labels`: array（**可為空**；證據不足時允許零標籤）
- `genre_reference_readonly`: optional（唯讀 G3-F 曲風快照，**不可寫回** registry）

### 2.1 單一 `emotion_labels[]` 元素

| 欄位 | 說明 |
|------|------|
| `code` | 六類 code 之一 |
| `confidence` | Agent 僅允許 `inferred` \| `unknown`（禁止 `confirmed`） |
| `review_status` | `pending` \| `accepted` \| `modified` \| `rejected`（試驗期預設 `pending`） |
| `evidence_axes` | `sonic` / `lyrical` / `rhythmic` 三軸 |
| `evidence_used` | 字串陣列（欄位路徑）；弱線索須明示 |
| `unverified_fields` | 未確認欄位列表 |
| `reason_zh` | 繁中摘要（推論聲明，非 confirmed 事實） |

### 2.2 證據軸 `evidence_axes.*`

| 欄位 | 說明 |
|------|------|
| `summary_zh` | 該軸文字摘要；無證據可留空 |
| `confidence` | `inferred` \| `unknown`（禁止 Agent `confirmed`） |
| `basis` | 見 `EVIDENCE_BASIS_VALUES`（`emotion_schema.js`） |
| `direct_audio_verified` | sonic 專用；`true` 時 basis 須含 `direct_audio_feature` 或 `human_listen_review` |
| `lyric_text_available` | lyrical 專用；`true` 時 basis 須含 `lyric_text_verified` |
| `tempo_bpm_known` | rhythmic；無 BPM 資料時須為 `false` |

## 3. 證據規則（硬性）

1. **弱線索**：歌名、歌手、專輯、唯讀曲風（`weak_*` / `genre_reference_readonly`）— 不可單獨支撐 `confidence: inferred` 的情緒標籤。
2. **`duration_ms`**：僅允許 `identity.duration_ms_fact_only` 陳述曲長；**禁止**由曲長推算 BPM、快慢、板速或情緒（見 `RHYTHM_DURATION_FORBIDDEN_PATTERNS`）。
3. **`explicit`**：不得出現在任何 `basis` 或推論依據。
4. **無音訊／無可靠歌詞**：不得宣稱已確認聽感或歌詞情緒；`direct_audio_verified` / `lyric_text_available` 須與 basis 一致。
5. **禁止假觀察**：`direct_audio_verified !== true` 時，sonic 軸 `summary_zh` 不得含編曲、調性、聽感等實際觀察用語（見 `SONIC_UNVERIFIED_OBSERVATION_PATTERNS`）。
6. **證據不足**：允許 `emotion_labels: []` 或標籤 `confidence: unknown`；**不強迫**分類。

驗證實作：`validate_emotion_inference.js`、`emotion_evidence_rules.js`。

## 4. Emotion Confidence Tier（非 G3-F 曲風規則）

| Tier | 條件（摘要） |
|------|----------------|
| `high` | 至少一軸具強 basis（`direct_audio_feature` / `lyric_text_verified` / `human_listen_review`）且有 summary，且 sonic／lyric 驗證旗標與 basis 一致 |
| `medium` | 有結構化軸文字但無強 basis，或強 basis 但旗標未齊 |
| `low` | 僅弱 basis 或 `evidence_used` 僅歌名等弱欄位 |
| `none` | 無標籤、`unknown`、或各軸皆空 |

實作：`emotion_confidence_tier.js`（**不**使用主曲風 evidence 錨定歌名規則）。

## 5. 80 首試驗驗證標準

批次指標：`compute_emotion_trial_batch_metrics()`（`emotion_trial_metrics.js`）。

| 指標 | 門檻 |
|------|------|
| 結構合格率 `schema_pass_rate` | ≥ **95%** |
| 僅弱線索卻 `inferred` 之標籤占比 | ≤ **5%** |
| 假 `direct_audio_verified`（無合法 basis） | **0** |
| 待複核 `pending` 標籤占比（試驗期） | **100%**（尚未人工複核前） |

試驗通過：`trial_pass === true`（上述 gates 全過）。

## 6. Phase 0 程式對照

| 檔案 | 職責 |
|------|------|
| `emotion_taxonomy.js` | 六類 code／中文 |
| `emotion_schema.js` | schema 常數、basis 枚舉 |
| `emotion_evidence_rules.js` | 證據禁止與偵測輔助 |
| `emotion_confidence_tier.js` | tier 推導 |
| `validate_emotion_inference.js` | 單首結構＋規則驗證 |
| `emotion_trial_metrics.js` | 80 首批次門檻 |

## 7. 尚未實作（下一階段）

- Wave prepare／emit／run、Agent batch 輸入
- `g3-emotion-adopt-registry` 與 backup／apply
- `classify:build` 投影至 index tags
- 智慧歌單 emotion filter
- Spotify Audio Features／歌詞管線
