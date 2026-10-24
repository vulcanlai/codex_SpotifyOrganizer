import {
  FILE_AI_CANDIDATES,
  FILE_AI_CANDIDATES_V1,
  FILE_AI_CANDIDATES_V2,
  FILE_AI_REVIEW,
  FILE_AI_REVIEW_V1,
  FILE_AI_REVIEW_V2,
  AI_CANDIDATE_VERSION_V2,
} from './paths.js';

/**
 * @param {number|string|null|undefined} raw
 */
export function parse_candidate_version(raw) {
  const n = parseInt(raw, 10);
  if (n === AI_CANDIDATE_VERSION_V2) {
    return AI_CANDIDATE_VERSION_V2;
  }
  return 1;
}

export function candidates_file_for_version(version) {
  if (version === AI_CANDIDATE_VERSION_V2) {
    return FILE_AI_CANDIDATES_V2;
  }
  return FILE_AI_CANDIDATES;
}

export function review_file_for_version(version) {
  if (version === AI_CANDIDATE_VERSION_V2) {
    return FILE_AI_REVIEW_V2;
  }
  return FILE_AI_REVIEW;
}

export function v1_archive_candidates_file() {
  return FILE_AI_CANDIDATES_V1;
}

export function v1_archive_review_file() {
  return FILE_AI_REVIEW_V1;
}
