#!/usr/bin/env node
/**
 * G3-F 通用下一波：npm run g3:f-next -- [--dry-run] [--prepare] [--emit] [--run] [--count=1..100] [--wave=N]
 * 最後一波可 --count=87 → g3-f15-wave-87；emit/run 僅需 --wave=N（自 manifest／目錄讀 wave_size）
 */
import { parse_g3_f_next_args, execute_g3_f_next } from './lib/classification/g3_f/run_g3_f_next.js';

const cli = parse_g3_f_next_args(process.argv.slice(2));
console.log('[g3-f-next] pid=' + process.pid + ' options=' + JSON.stringify(cli));
const report = await execute_g3_f_next(cli);
console.log(JSON.stringify(report, null, 2));
