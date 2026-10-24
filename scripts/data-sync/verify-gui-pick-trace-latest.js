/**
 * Verify so-gui-pick-trace-latest.txt points to a readable non-empty log.
 * Exit 0 on success, 1 on failure. ASCII stdout only.
 */
import { verify_gui_pick_trace_latest_pointer } from '../../lib/data_sync/gui_pick_trace.js';

const r = verify_gui_pick_trace_latest_pointer();
if (!r.ok) {
  process.stderr.write('PROBE VERIFY FAIL: ' + (r.reason || 'unknown') + '\n');
  if (r.log_path) {
    process.stderr.write('log_path=' + r.log_path + '\n');
  }
  process.exit(1);
}
process.stdout.write('PROBE VERIFY OK\n');
process.stdout.write(r.log_path + '\n');
process.exit(0);
