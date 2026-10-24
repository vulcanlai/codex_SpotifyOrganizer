/**
 * 正式 CLI（export-data.bat）不得啟用測試用環境變數
 */
import {
  ENV_ALLOW_7Z_PASSWORD_STDIN,
  ENV_ALLOW_PROJECT_ROOT_OVERRIDE,
} from './constants.js';

/** 正式匯出 CLI 啟動時呼叫，清除測試專用開關 */
export function clear_data_sync_test_env_for_production_cli() {
  delete process.env[ENV_ALLOW_7Z_PASSWORD_STDIN];
  delete process.env[ENV_ALLOW_PROJECT_ROOT_OVERRIDE];
}

/**
 * @param {'env' | 'stdin' | 'interactive'} password_mode
 */
export function assert_production_export_password_mode(password_mode) {
  if (password_mode === 'stdin') {
    return;
  }
  if (password_mode === 'env') {
    if (process.env[ENV_ALLOW_7Z_PASSWORD_STDIN] === '1') {
      throw new Error(
        '正式匯出拒絕啟用的測試密碼開關 ' +
          ENV_ALLOW_7Z_PASSWORD_STDIN +
          '；請使用 GUI／CLI env 模式，勿手動設定該環境變數'
      );
    }
    return;
  }
  if (password_mode === 'interactive') {
    throw new Error(
      '已不支援互動式 ZIP 密碼；請在本機 .env 設定 DATA_SYNC_ZIP_PASSWORD 並使用 env 模式'
    );
  }
  throw new Error('不支援的 password_mode：' + password_mode);
}
