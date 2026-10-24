<template>
  <div>
    <h1>人工分類 V1</h1>
    <p class="subtitle">本機預覽／寫入 manual-overrides；不呼叫 Spotify API。</p>

    <section class="card">
      <h2>Spotify 網址或 ID</h2>
      <label for="spotify_input">Track／Album URL 或 ID（可多行）</label>
      <textarea
        id="spotify_input"
        v-model="spotify_input"
        placeholder="https://open.spotify.com/track/… 或 album/…"
      />
      <div v-if="needs_id_type_choice" class="id_type_choice">
        <span class="id_type_label">純 ID 無法自動判定類型，請選擇：</span>
        <label class="id_type_option">
          <input v-model="spotify_id_kind" type="radio" value="track" />
          單曲（Track）
        </label>
        <label class="id_type_option">
          <input v-model="spotify_id_kind" type="radio" value="album" />
          專輯（Album）
        </label>
      </div>
      <div class="btn_row">
        <button class="secondary" type="button" :disabled="loading" @click="load_sync_status">
          重新整理同步狀態
        </button>
      </div>
    </section>

    <section class="card">
      <h2 class="playlist_section_heading">
        智慧歌單（{{ playlists.length }} 張）
        <span class="selected_count">已選 {{ selected_playlist_ids.length }} 張</span>
      </h2>
      <div class="playlist_toolbar">
        <input v-model="playlist_search" type="search" placeholder="搜尋未選歌單名稱或 ID…" />
      </div>
      <div v-if="selected_display_playlists.length" class="playlist_selected_zone">
        <label
          v-for="pl in selected_display_playlists"
          :key="pl.playlist_id"
          class="playlist_item playlist_item_selected"
        >
          <input
            type="checkbox"
            :checked="true"
            @change="on_playlist_toggle(pl.playlist_id, $event)"
          />
          <span>
            <strong>
              <span class="playlist_selected_mark" aria-hidden="true">✓</span>
              {{ pl.display_title }}
            </strong>
            <div class="playlist_meta">{{ pl.playlist_id }} · {{ kind_label(pl.kind) }}</div>
          </span>
        </label>
      </div>
      <div ref="unselected_list_el" class="playlist_list playlist_list_scroll">
        <p v-if="unselected_search_empty" class="playlist_search_empty">
          沒有符合搜尋條件的未選歌單。
        </p>
        <template v-for="grp in unselected_grouped_display" :key="grp.group_key">
          <div class="playlist_group_title">{{ grp.title_zh }}</div>
          <label
            v-for="pl in grp.playlists"
            :key="pl.playlist_id"
            class="playlist_item"
          >
            <input
              type="checkbox"
              :checked="false"
              @change="on_playlist_toggle(pl.playlist_id, $event)"
            />
            <span>
              <strong>{{ pl.display_title }}</strong>
              <div class="playlist_meta">{{ pl.playlist_id }} · {{ kind_label(pl.kind) }}</div>
            </span>
          </label>
        </template>
      </div>
      <div class="btn_row">
        <button class="primary" type="button" :disabled="!can_preview" @click="run_preview">
          預覽（不寫入）
        </button>
      </div>
    </section>

    <section v-if="preview" class="card">
      <h2>預覽結果（唯讀）</h2>
      <div v-if="preview.albums && preview.albums.length" class="warn">
        <div v-for="(a, idx) in preview.albums" :key="idx">
          專輯 {{ a.album_name || a.album_id }}：{{ a.track_count }} 首
          <span v-if="a.incomplete">（不完整）</span>
          <span v-if="a.note_zh"> — {{ a.note_zh }}</span>
        </div>
      </div>
      <div v-if="preview.membership_summary" class="preview_summary">
        <p>
          <strong>總歌曲數：</strong>{{ preview.membership_summary.track_count }}
          <span class="preview_summary_sep">｜</span>
          <strong>目標歸屬：</strong>{{ preview.membership_summary.total_target_slots }}
          （已存在 {{ preview.membership_summary.existing_target_slots }}／待新增
          {{ preview.membership_summary.pending_target_slots }}）
        </p>
        <p>
          <strong>需更新歌曲：</strong>{{ preview.membership_summary.tracks_needing_update }}
          <span class="preview_summary_sep">｜</span>
          <strong>已完成：</strong>{{ preview.membership_summary.tracks_fully_classified }}
        </p>
        <p v-if="preview.playlists_selected.length">
          <strong>本次歌單：</strong>
          <span v-for="p in preview.playlists_selected" :key="p.playlist_id" class="badge">{{
            p.label_zh
          }}</span>
        </p>
      </div>
      <div
        v-if="preview.apply_status_message_zh"
        :class="preview_status_class(preview)"
      >
        {{ preview.apply_status_message_zh }}
      </div>
      <div v-if="preview.blocked_reasons.length" class="error">
        {{ preview.blocked_reasons.join('；') }}
      </div>
      <div v-if="preview.tracks.length" class="preview_track_list">
        <article
          v-for="t in preview.tracks"
          :key="t.track_id"
          class="preview_track_card"
          :class="{ preview_track_card_done: t.classification_status === 'complete' }"
        >
          <h3 class="preview_track_title">
            {{ t.track_name || t.metadata_hint_zh || '（無曲名）' }}
          </h3>
          <p v-if="t.artists_text" class="preview_track_artists">{{ t.artists_text }}</p>
          <p v-if="t.album_name" class="preview_track_album">專輯：{{ t.album_name }}</p>
          <p v-if="t.metadata_hint_zh && !t.track_name" class="preview_track_meta_hint">
            {{ t.metadata_hint_zh }}
          </p>
          <p class="preview_track_status">
            <span v-if="t.classification_status === 'complete'" class="status_done">已完成</span>
            <span v-else-if="t.classification_status === 'partial'" class="status_pending"
              >待補歸屬</span
            >
            <span v-if="t.g3_f_registry_status === 'adopted'" class="badge">G3-F adopted</span>
          </p>
          <div v-if="t.playlists_already.length" class="preview_pl_block">
            <span class="preview_pl_label">已在此目標歌單：</span>
            <span v-for="p in t.playlists_already" :key="'a-' + p.playlist_id" class="badge badge_ok">{{
              p.label_zh
            }}</span>
          </div>
          <div v-if="t.playlists_pending.length" class="preview_pl_block">
            <span class="preview_pl_label">待新增：</span>
            <span v-for="p in t.playlists_pending" :key="'p-' + p.playlist_id" class="badge badge_pending">{{
              p.label_zh
            }}</span>
          </div>
          <div v-if="t.playlists_other.length" class="preview_pl_block">
            <span class="preview_pl_label">其他人工歌單：</span>
            <span v-for="p in t.playlists_other" :key="'o-' + p.playlist_id" class="badge">{{
              p.label_zh
            }}</span>
          </div>
          <details class="preview_track_details">
            <summary>Track ID</summary>
            <code>{{ t.track_id }}</code>
          </details>
          <div v-if="t.conflicts.length" class="warn">{{ t.conflicts.join(' ') }}</div>
        </article>
      </div>
      <div class="btn_row" v-if="preview.can_apply">
        <button
          class="danger"
          type="button"
          :disabled="apply_busy || !preview_token"
          @click="run_apply"
        >
          確認寫入 manual-overrides
        </button>
      </div>
      <div v-else-if="preview && preview.ok && preview.apply_status === 'complete'" class="ok_msg">
        已完成分類，無須重複寫入。
      </div>
      <div v-else-if="preview && !preview.ok" class="warn">目前無法套用，請修正上方警告後再預覽。</div>
    </section>

    <section v-if="apply_result" class="card">
      <h2>寫入結果</h2>
      <div v-if="apply_result.ok" class="ok_msg">
        成功寫入 {{ apply_result.writes }} 筆。
        <span v-if="apply_result.backup_path">備份：{{ apply_result.backup_path }}</span>
        <span v-if="apply_result.classify_build_ran">（已執行 classify:build）</span>
      </div>
      <div v-else class="error">
        {{ apply_result.message_zh || apply_result.error }}
      </div>
    </section>

    <section class="card">
      <h2>Spotify 同步狀態</h2>
      <p class="sync_note">
        本機分類：{{ sync.local_classification_ready ? '就緒' : '—' }}。
        Web UI 尚未啟用 Spotify 寫入；請用 CLI：
        {{ sync.spotify_sync_cli_hint }}
      </p>
      <p v-if="sync.playlists_need_sync_count">
        建議同步的歌單：<strong>{{ sync.playlists_need_sync_count }}</strong> 張
      </p>
      <ul v-if="sync.playlists_need_sync && sync.playlists_need_sync.length">
        <li v-for="s in sync.playlists_need_sync.slice(0, 8)" :key="s.mvp_playlist_id">
          {{ s.mvp_playlist_id }} — {{ s.reason_zh }}
        </li>
      </ul>
    </section>

    <div v-if="error_message" class="error">{{ error_message }}</div>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, ref } from 'vue';
import { group_playlists_for_ui } from '@manual_classify_lib/mvp_playlist_ui_sort.js';

const spotify_input = ref('');
const spotify_id_kind = ref('');
const playlists = ref([]);
const playlist_search = ref('');
const selected_playlist_ids = ref([]);
const unselected_list_el = ref(null);
const preview = ref(null);
const preview_token = ref('');
const overrides_fingerprint = ref('');
const apply_result = ref(null);
const apply_busy = ref(false);
const loading = ref(false);
const error_message = ref('');
const sync = ref({
  local_classification_ready: true,
  spotify_sync_via_web_ui: false,
  spotify_sync_cli_hint: '',
  playlists_need_sync_count: 0,
  playlists_need_sync: [],
});

function playlist_matches_search(pl, q) {
  if (!q) {
    return true;
  }
  const hay =
    (pl.display_title || '') +
    ' ' +
    (pl.label_zh || '') +
    ' ' +
    (pl.playlist_id || '');
  return hay.toLowerCase().indexOf(q) >= 0;
}

const selected_display_playlists = computed(function () {
  /** @type {Record<string, object>} */
  const by_id = {};
  for (let i = 0; i < playlists.value.length; i += 1) {
    by_id[playlists.value[i].playlist_id] = playlists.value[i];
  }
  /** @type {object[]} */
  const top = [];
  for (let t = 0; t < selected_playlist_ids.value.length; t += 1) {
    const pl = by_id[selected_playlist_ids.value[t]];
    if (pl) {
      top.push(pl);
    }
  }
  return top;
});

const unselected_grouped_display = computed(function () {
  const q = playlist_search.value.trim().toLowerCase();
  const selected_set = {};
  for (let s = 0; s < selected_playlist_ids.value.length; s += 1) {
    selected_set[selected_playlist_ids.value[s]] = true;
  }
  /** @type {object[]} */
  const rest = [];
  for (let j = 0; j < playlists.value.length; j += 1) {
    const pl = playlists.value[j];
    if (selected_set[pl.playlist_id]) {
      continue;
    }
    if (playlist_matches_search(pl, q)) {
      rest.push(pl);
    }
  }
  return group_playlists_for_ui(rest);
});

const unselected_search_empty = computed(function () {
  const q = playlist_search.value.trim();
  if (!q) {
    return false;
  }
  if (unselected_grouped_display.value.length > 0) {
    return false;
  }
  const selected_set = {};
  for (let s = 0; s < selected_playlist_ids.value.length; s += 1) {
    selected_set[selected_playlist_ids.value[s]] = true;
  }
  for (let j = 0; j < playlists.value.length; j += 1) {
    if (!selected_set[playlists.value[j].playlist_id]) {
      return true;
    }
  }
  return false;
});

const needs_id_type_choice = computed(function () {
  if (preview.value && preview.value.spotify_input && preview.value.spotify_input.needs_type_choice) {
    return preview.value.spotify_input.needs_type_choice.length > 0;
  }
  return false;
});

function preview_request_body() {
  /** @type {object} */
  const body = {
    spotify_input: spotify_input.value,
    playlist_ids: selected_playlist_ids.value.slice(),
  };
  if (spotify_id_kind.value === 'track' || spotify_id_kind.value === 'album') {
    body.spotify_id_kind = spotify_id_kind.value;
  }
  return body;
}

function on_playlist_toggle(playlist_id, event) {
  const scroll_el = unselected_list_el.value;
  const scroll_top = scroll_el ? scroll_el.scrollTop : 0;
  const checked = event && event.target ? event.target.checked : false;
  const ids = selected_playlist_ids.value.slice();
  const idx = ids.indexOf(playlist_id);
  if (checked && idx < 0) {
    ids.push(playlist_id);
  } else if (!checked && idx >= 0) {
    ids.splice(idx, 1);
  }
  selected_playlist_ids.value = ids;
  nextTick(function () {
    if (unselected_list_el.value) {
      unselected_list_el.value.scrollTop = scroll_top;
    }
  });
}

const can_preview = computed(function () {
  return (
    spotify_input.value.trim().length > 0 &&
    selected_playlist_ids.value.length > 0 &&
    !loading.value
  );
});

function preview_status_class(preview_row) {
  if (!preview_row || !preview_row.ok) {
    return 'error';
  }
  if (preview_row.apply_status === 'complete') {
    return 'ok_msg';
  }
  if (preview_row.apply_status === 'partial') {
    return 'warn';
  }
  return 'preview_status_neutral';
}

function kind_label(kind) {
  if (kind === 'emotion_tentative') {
    return '情緒';
  }
  return '語言×曲風';
}

async function api_get(path) {
  const res = await fetch(path);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message_zh || data.error || 'request_failed');
  }
  return data;
}

async function api_post(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message_zh || data.error || 'request_failed');
  }
  return data;
}

async function load_playlists() {
  const data = await api_get('/api/playlists');
  playlists.value = data.playlists || [];
}

async function load_sync_status() {
  loading.value = true;
  error_message.value = '';
  try {
    sync.value = await api_get('/api/sync-status');
  } catch (err) {
    error_message.value = err.message || String(err);
  } finally {
    loading.value = false;
  }
}

async function run_preview() {
  loading.value = true;
  error_message.value = '';
  apply_result.value = null;
  preview.value = null;
  preview_token.value = '';
  overrides_fingerprint.value = '';
  try {
    const data = await api_post('/api/preview', preview_request_body());
    preview.value = data.preview;
    preview_token.value = data.preview_token;
    overrides_fingerprint.value = data.preview.overrides_fingerprint || '';
  } catch (err) {
    error_message.value = err.message || String(err);
  } finally {
    loading.value = false;
  }
}

async function run_apply() {
  if (!preview_token.value || apply_busy.value) {
    return;
  }
  if (!window.confirm('確定要寫入 manual-overrides 並執行 classify:build？')) {
    return;
  }
  apply_busy.value = true;
  error_message.value = '';
  try {
    apply_result.value = await api_post('/api/apply', {
      confirm: true,
      preview_token: preview_token.value,
      overrides_fingerprint: overrides_fingerprint.value,
      request: preview_request_body(),
    });
    await load_sync_status();
  } catch (err) {
    apply_result.value = { ok: false, error: err.message };
  } finally {
    apply_busy.value = false;
  }
}

onMounted(function () {
  load_playlists().catch(function (e) {
    error_message.value = e.message || String(e);
  });
  load_sync_status();
});
</script>
