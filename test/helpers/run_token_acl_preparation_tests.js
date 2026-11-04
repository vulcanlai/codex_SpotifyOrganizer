// 不安裝套件；原有測試使用隔離副本，原生遷移測試僅操作新建的 lab 假檔案。
import { spawnSync } from 'node:child_process';
const suites=[['test/helpers/run_token_acl_tests.js'],
 ['--test','--test-concurrency=1','test/acl_recovery_tool.test.js'],
 ['--test','--test-concurrency=1','test/token_acl_migration.test.js']];
for(const args of suites) {
 const result=spawnSync(process.execPath,args,{stdio:'inherit',shell:false});
 if(result.error || result.status!==0) {process.exitCode=1;break;}
}
