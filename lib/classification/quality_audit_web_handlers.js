/**
 * 第六階段 F：品質驗證 API（與正式 AI 審核隔離）
 */
import fs from 'node:fs';
import { load_phase_f_sample } from './phase_f_sample.js';
import {
  load_quality_verification,
  save_quality_review,
  QualityAuditValidationError,
} from './quality_audit_store.js';
import { build_quality_audit_report } from './quality_audit_report.js';
import { build_quality_audit_track_view } from './quality_audit_present.js';
import { FILE_CLASSIFICATION_INDEX } from './paths.js';
import { FILE_PHASE_E_CANDIDATES_IMPORTED } from './ai_test_batches.js';

function read_json(p) {
  if (!fs.existsSync(p)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function json_response(status, data) {
  return {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(data),
  };
}

function find_candidate(doc, id) {
  const list = doc && doc.candidates ? doc.candidates : [];
  for (let i = 0; i < list.length; i += 1) {
    if (list[i].spotify_id === id) {
      return list[i];
    }
  }
  return null;
}

/**
 * @param {string} method
 * @param {string} pathname
 * @param {string} body_text
 * @param {URLSearchParams} [search_params]
 */
export async function handle_quality_audit_api(
  method,
  pathname,
  body_text,
  search_params
) {
  const params = search_params || new URLSearchParams();

  if (pathname === '/api/quality-audit/status' && method === 'GET') {
    const sample = load_phase_f_sample();
    if (!sample) {
      return json_response(404, {
        error: '尚未建立 phase-f 抽樣，請執行 npm run classify:quality-audit-build-phase-f',
      });
    }
    const verification = load_quality_verification();
    let report;
    try {
      report = build_quality_audit_report({ write: false });
    } catch (err) {
      report = null;
    }
    return json_response(200, {
      audit_id: sample.audit_id,
      sample_id: sample.sample_id,
      track_count: sample.track_count,
      sample,
      verification_updated_at: verification.updated_at,
      report_summary: report
        ? {
            verification_progress: report.verification_progress,
            verdict_counts: report.verdict_counts,
            rates: report.rates,
          }
        : null,
      isolated_from_formal_review: true,
    });
  }

  if (pathname === '/api/quality-audit/tracks' && method === 'GET') {
    const sample = load_phase_f_sample();
    if (!sample) {
      return json_response(404, { error: '尚未建立 phase-f 抽樣' });
    }
    const imported = read_json(FILE_PHASE_E_CANDIDATES_IMPORTED);
    const index = read_json(FILE_CLASSIFICATION_INDEX);
    const tracks_by_id = (index && index.tracks_by_id) || {};
    const verification = load_quality_verification();
    const reviews = verification.reviews_by_track_id || {};

    const tier_filter = params.get('confidence_tier') || '';
    const verdict_filter = params.get('verdict') || '';

    const items = [];
    for (let i = 0; i < sample.track_ids.length; i += 1) {
      const id = sample.track_ids[i];
      const cand = find_candidate(imported, id);
      if (!cand) {
        continue;
      }
      const view = build_quality_audit_track_view({
        candidate: cand,
        index_row: tracks_by_id[id] || null,
        review: reviews[id] || null,
      });
      if (tier_filter && view.confidence_tier !== tier_filter) {
        continue;
      }
      if (verdict_filter && view.quality_review.verdict !== verdict_filter) {
        continue;
      }
      items.push(view);
    }

    return json_response(200, {
      items,
      total: items.length,
      filters: { confidence_tier: tier_filter, verdict: verdict_filter },
    });
  }

  if (pathname.indexOf('/api/quality-audit/track/') === 0 && method === 'GET') {
    const id = decodeURIComponent(
      pathname.slice('/api/quality-audit/track/'.length)
    );
    const sample = load_phase_f_sample();
    if (!sample || sample.track_ids.indexOf(id) < 0) {
      return json_response(404, { error: '不在品質驗證樣本內' });
    }
    const imported = read_json(FILE_PHASE_E_CANDIDATES_IMPORTED);
    const cand = find_candidate(imported, id);
    if (!cand) {
      return json_response(404, { error: '找不到 AI 候選' });
    }
    const index = read_json(FILE_CLASSIFICATION_INDEX);
    const verification = load_quality_verification();
    const view = build_quality_audit_track_view({
      candidate: cand,
      index_row: index && index.tracks_by_id ? index.tracks_by_id[id] : null,
      review: verification.reviews_by_track_id
        ? verification.reviews_by_track_id[id]
        : null,
    });
    return json_response(200, { track: view });
  }

  if (pathname === '/api/quality-audit/review' && method === 'POST') {
    let body = {};
    try {
      body = body_text ? JSON.parse(body_text) : {};
    } catch {
      return json_response(400, { error: 'JSON 無效' });
    }
    try {
      const doc = save_quality_review(body, { write: true });
      const report = build_quality_audit_report({ write: true });
      return json_response(200, {
        ok: true,
        verification: doc,
        report_summary: {
          verification_progress: report.verification_progress,
          verdict_counts: report.verdict_counts,
          rates: report.rates,
        },
        note: '品質驗證不會寫入 manual-overrides 或 AI 正式審核',
      });
    } catch (err) {
      if (err instanceof QualityAuditValidationError) {
        return json_response(400, { error: err.message });
      }
      throw err;
    }
  }

  if (pathname === '/api/quality-audit/report' && method === 'GET') {
    const sample = load_phase_f_sample();
    if (!sample) {
      return json_response(404, { error: '尚未建立 phase-f 抽樣' });
    }
    const report = build_quality_audit_report({ write: true });
    return json_response(200, { report });
  }

  return null;
}
