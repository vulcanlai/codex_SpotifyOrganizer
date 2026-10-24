/**
 * G3-F 採用預覽（僅 dry-run）
 * npm run g3:f-adopt-preview
 */
import {
  run_g3_f_adopt_preview,
  parse_g3_f_adopt_preview_args,
} from './lib/classification/g3_f/g3_f_adopt_preview.js';

function main() {
  const cli = parse_g3_f_adopt_preview_args(process.argv.slice(2));
  if (cli.forbidden) {
    console.error(
      '[g3-f-adopt-preview] 禁止正式採用旗標：' +
        cli.forbidden +
        '（本工具僅 dry-run）'
    );
    process.exit(1);
  }
  const report = run_g3_f_adopt_preview({
    batch_size: cli.batch_size,
    batch_index: cli.batch_index,
    output_dir: cli.output_dir,
    write_reports: true,
  });
  console.log(
    JSON.stringify(
      {
        mode: report.mode,
        eligible_total: report.eligible_total,
        batch_track_count: report.batch_track_count,
        batch_track_ids: report.batch_track_ids,
        exclusion_counts: report.exclusion_counts,
        reports_dir: 'reports/g3-f-adopt-preview/dry-run-v1',
      },
      null,
      2
    )
  );
}

main();
