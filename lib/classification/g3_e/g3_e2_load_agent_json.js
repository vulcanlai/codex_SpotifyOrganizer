/**
 * G3-E.2 相容層 → 共用 loader
 */
import { g3_e2_wave_spec } from './g3_e_wave_spec.js';
import {
  load_g3_e_batch_agent_output,
  G3E2AgentOutputMissingError,
  G3EAgentOutputMissingError,
} from './g3_e_load_agent_json.js';

export { G3E2AgentOutputMissingError, G3EAgentOutputMissingError };

export function load_g3_e2_batch_agent_output(
  batch_id,
  expected_ids,
  input_hash_by_id,
  progress_doc
) {
  return load_g3_e_batch_agent_output(
    g3_e2_wave_spec(),
    batch_id,
    expected_ids,
    input_hash_by_id,
    progress_doc
  );
}
