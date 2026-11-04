/** 原生遷移引擎只在 TEMP 標記的 lab 使用 dummy.txt；絕不讀取正式 Token。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const sourceRoot=fileURLToPath(new URL('../',import.meta.url));
const engine=path.join(sourceRoot,'scripts/token_acl_migrate.ps1');
const cli=path.join(sourceRoot,'scripts/token-acl-migrate.js');
const executable=path.win32.join(process.env.SystemRoot || 'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
const native=process.platform==='win32';
const q=value=>"'"+value.replaceAll("'","''")+"'";
const contents='FAKE_TOKEN_DATA_NOT_A_REAL_SPOTIFY_TOKEN';
function fixture() {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'so-token-migrate-tests-'));
 fs.writeFileSync(path.join(root,'lab-marker.txt'),'SpotifyOrganizer isolated ACL lab v1');
 fs.writeFileSync(path.join(root,'dummy.txt'),contents);
 console.log('保留遷移 lab：'+root);
 return root;
}
function step(root,mode,confirmation='',inject='') {
 const code=`& ([scriptblock]::Create([IO.File]::ReadAllText(${q(engine)},[Text.Encoding]::UTF8))) -Mode ${q(mode)} -SourceRoot ${q(sourceRoot)} -ProjectRoot ${q(root)} -Scope lab -Confirmation ${q(confirmation)} -InjectFailure ${q(inject)}`;
 const r=spawnSync(executable,['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(code,'utf16le').toString('base64')],
  {encoding:'utf8',shell:false,timeout:45000,maxBuffer:1048576});
 assert.equal(r.status,0,'lab process failed');
 assert.ok(!/S-1-5-21-\d+/.test(r.stdout+r.stderr));
 const report=JSON.parse(r.stdout.trim().replace(/^\uFEFF/,''));
 return report;
}
function prepare(root) {
 assert.equal(step(root,'preflight').owner_matches,true);
 assert.equal(step(root,'authorize','--confirm-owner').ok,true);
 const snapshot=step(root,'snapshot');
 assert.equal(snapshot.ok,true,JSON.stringify(snapshot));
 return snapshot.snapshot_directory;
}

test('正式 CLI 不接受路徑、SID、lab 模式或省略確認', {skip:!native},()=>{
 for(const args of [['apply'],['restore'],['prepare'],['preflight','.spotify_tokens.json'],['apply','--lab'],['prepare','--confirm-owner','--sid','FAKE']]) {
  const r=spawnSync(process.execPath,[cli,...args],{encoding:'utf8',shell:false});
  assert.equal(r.status,1);
  assert.match(r.stderr,/用法/);
 }
});

test('沙箱正式 preflight 在任何 Token 或 HKCU 操作前拒絕', {skip:!native},t=>{
 const name=spawnSync(path.win32.join(process.env.SystemRoot,'System32/whoami.exe'),['/user','/fo','csv','/nh'],{encoding:'utf8'});
 if (!/\\CodexSandbox/i.test(name.stdout)) {t.skip('僅適用 Codex 沙箱；一般使用者成功流程須本人執行');return;}
 const r=spawnSync(process.execPath,[cli,'preflight'],{encoding:'utf8',shell:false,timeout:20000});
 assert.equal(r.status,1);
 const report=JSON.parse(r.stdout.trim());
 assert.equal(report.reason,'sandbox_identity');
 assert.equal(report.target,undefined);
 assert.equal(report.snapshot_directory,undefined);
});

test('lab 完整準備、套用、獨立 verify、跨程序復原；不變更假 Token 內容', {skip:!native},()=>{
 const root=fixture();const store=prepare(root);
 assert.equal(step(root,'apply','--confirm-acl').ok,true);
 assert.equal(step(root,'verify').target_verified,true);
 assert.equal(fs.readFileSync(path.join(root,'dummy.txt'),'utf8'),contents);
 const reused=step(root,'snapshot');assert.equal(reused.snapshot_reused,true);
 assert.equal(step(root,'restore','--confirm-original-acl').original_restored,true);
 assert.equal(step(root,'recovery-status').original_restored,true);
 assert.equal(fs.readFileSync(path.join(root,'dummy.txt'),'utf8'),contents);
 const snapshot=fs.readFileSync(path.join(store,'original.bin'));
 assert.ok(!snapshot.includes(Buffer.from(contents)));
 assert.equal(JSON.parse(snapshot.toString()).target,path.join(root,'dummy.txt'));
});

test('拒絕覆寫不同的核准值；未核准與未快照不能修改 ACL', {skip:!native},()=>{
 const root=fixture();
 const missing=step(root,'snapshot');assert.equal(missing.ok,false);
 assert.equal(missing.reason,'authorization_required_or_mismatched');
 fs.writeFileSync(path.join(root,'lab-approval.txt'),'FAKE_OTHER_OWNER');
 assert.equal(step(root,'authorize','--confirm-owner').reason,'existing_authorization_preserved');
 assert.equal(fs.readFileSync(path.join(root,'lab-approval.txt'),'utf8'),'FAKE_OTHER_OWNER');
 assert.equal(fs.existsSync(path.join(root,'recovery')),false);
 assert.equal(fs.readFileSync(path.join(root,'dummy.txt'),'utf8'),contents);
});

test('套用後注入失敗：從持久快照自動復原，診斷資料保留', {skip:!native},()=>{
 const root=fixture();const store=prepare(root);
 const result=step(root,'apply','--confirm-acl','after-apply');
 assert.equal(result.ok,false);assert.equal(result.reason,'injected_lab_failure');
 assert.equal(result.rollback_attempted,true);assert.equal(result.rollback_succeeded,true);
 assert.equal(step(root,'recovery-status').original_restored,true);
 assert.ok(fs.existsSync(path.join(store,'original.key')));
 assert.equal(fs.readFileSync(path.join(root,'dummy.txt'),'utf8'),contents);
});

test('人工復原不依賴 HKCU 核准；快照完整性失敗則拒絕', {skip:!native},()=>{
 const root=fixture();const store=prepare(root);
 assert.equal(step(root,'apply','--confirm-acl').ok,true);
 fs.writeFileSync(path.join(root,'lab-approval.txt'),'');
 assert.equal(step(root,'restore','--confirm-original-acl').ok,true);
 const file=path.join(store,'original.bin');const data=fs.readFileSync(file);data[0]^=1;fs.writeFileSync(file,data);
 assert.equal(step(root,'restore','--confirm-original-acl').reason,'snapshot_authentication_failed');
 assert.ok(fs.existsSync(path.join(store,'original.hmac')));
});

test('目標被替換、硬連結或資料中繼資料變動時拒絕復原', {skip:!native},()=>{
 const root=fixture();prepare(root);
 const target=path.join(root,'dummy.txt');
 fs.linkSync(target,path.join(root,'extra-fake-link.txt'));
 assert.equal(step(root,'restore','--confirm-original-acl').reason,'multiple_links_rejected');
 // 只移除本測試自己建立的額外假連結；保留 dummy 與快照。
 fs.unlinkSync(path.join(root,'extra-fake-link.txt'));
 fs.appendFileSync(target,'FAKE_CHANGE');
 assert.equal(step(root,'restore','--confirm-original-acl').reason,'target_data_metadata_changed');
 fs.renameSync(target,path.join(root,'preserved-original-dummy.txt'));
 fs.writeFileSync(target,'FAKE_REPLACEMENT');
 assert.equal(step(root,'restore','--confirm-original-acl').reason,'file_identity_mismatch');
});

test('即使重新簽署快照，也不能變更目標或快照身分', {skip:!native},()=>{
 const root=fixture();const store=prepare(root);
 const file=path.join(store,'original.bin');const data=JSON.parse(fs.readFileSync(file,'utf8'));
 data.target=path.join(root,'.spotify_tokens.json');
 const bytes=Buffer.from(JSON.stringify(data));fs.writeFileSync(file,bytes);
 const key=fs.readFileSync(path.join(store,'original.key'));
 fs.writeFileSync(path.join(store,'original.hmac'),crypto.createHmac('sha256',key).update(bytes).digest('hex'));
 assert.equal(step(root,'restore','--confirm-original-acl').reason,'snapshot_target_mismatch');
});

test('同一登入工作階段的並行遷移被拒絕', {skip:!native},async()=>{
 const root=fixture();
 const code=`$u=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value; $h=[Security.Cryptography.SHA256]::Create(); $tag=([BitConverter]::ToString($h.ComputeHash([Text.Encoding]::UTF8.GetBytes(${q(root.toLowerCase())}+'|'+$u)))).Replace('-','').ToLowerInvariant().Substring(0,32); $m=[Threading.Mutex]::new($false,('Local\\SpotifyOrganizer.TokenAcl.'+$tag)); if(!$m.WaitOne(0)){exit 1}; [Console]::WriteLine('READY'); [Console]::Out.Flush(); [Threading.Thread]::Sleep(20000)`;
 const child=spawn(executable,['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(code,'utf16le').toString('base64')],{stdio:['ignore','pipe','pipe'],windowsHide:true});
 try {
  await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(new Error('mutex test timeout')),10000);
   child.stdout.on('data',data=>{if(data.toString().includes('READY')){clearTimeout(timer);resolve();}});
   child.once('error',error=>{clearTimeout(timer);reject(error);});
   child.once('exit',()=>{clearTimeout(timer);reject(new Error('mutex holder exited early'));});
  });
  assert.equal(step(root,'preflight').reason,'another_migration_running');
  assert.equal(fs.existsSync(path.join(root,'recovery')),false);
 } finally {child.kill();}
});
