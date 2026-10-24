/**
 * G3-F 採用（registry）；預設 dry-run + 產出 apply-plan.json
 * npm run g3:f-adopt
 */
import {
  run_g3_f_adopt_dry_run,
  run_g3_f_adopt_apply_from_plan,
  simulate_g3_f_adopt_apply_from_plan,
  parse_g3_f_adopt_cli_args,
  format_dry_run_cli_summary,
  G3_F_ADOPT_AUTHORIZE_TOKEN,
} from './lib/classification/g3_f/g3_f_adopt_run.js';

function main() {
  const cli = parse_g3_f_adopt_cli_args(process.argv.slice(2));

  if (cli.simulate_apply) {
    if (!cli.apply_plan_path) {
      console.error('[g3-f-adopt] --simulate-apply 需搭配 --apply-plan=<path>');
      process.exit(1);
    }
    const result = simulate_g3_f_adopt_apply_from_plan({
      apply_plan_path: cli.apply_plan_path,
    });
    console.log(JSON.stringify(result, null, cli.verbose ? 2 : 0));
    return;
  }

  if (!cli.dry_run) {
    if (cli.authorize_token !== G3_F_ADOPT_AUTHORIZE_TOKEN) {
      console.error(
        '[g3-f-adopt] 正式採用需明確授權：--authorize-apply=' +
          G3_F_ADOPT_AUTHORIZE_TOKEN
      );
      process.exit(1);
    }
    if (!cli.apply_plan_path) {
      console.error(
        '[g3-f-adopt] 已停用舊式 apply。正式採用必須提供：--apply-plan=<apply-plan.json>'
      );
      process.exit(1);
    }
    try {
      const result = run_g3_f_adopt_apply_from_plan({
        authorize_token: cli.authorize_token,
        allow_production_write: true,
        apply_plan_path: cli.apply_plan_path,
        verbose: cli.verbose,
      });
      console.log(JSON.stringify(result, null, cli.verbose ? 2 : 0));
    } catch (e) {
      console.error(e.message || String(e));
      process.exit(1);
    }
    return;
  }

  const report = run_g3_f_adopt_dry_run({
    batch_size: cli.batch_size,
    batch_index: cli.batch_index,
    skip_registry_adopted: cli.skip_registry_adopted,
    output_dir: cli.output_dir,
    write_reports: true,
  });
  console.log(JSON.stringify(format_dry_run_cli_summary(report, cli.verbose), null, 2));
}

main();
