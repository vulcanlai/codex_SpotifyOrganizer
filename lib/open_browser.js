/**
 * 嘗試以系統預設瀏覽器開啟 URL（失敗時僅提示，不中断流程）
 */
import { exec } from 'node:child_process';

/**
 * @param {string} url
 * @returns {Promise<void>}
 */
export function open_browser(url) {
  return new Promise(function (resolve) {
    let cmd;
    if (process.platform === 'win32') {
      // start 是 cmd 內建，需透過 cmd /c；引號避免 & 等字元問題
      cmd = `cmd /c start "" "${url.replace(/"/g, '%22')}"`;
    } else if (process.platform === 'darwin') {
      cmd = `open "${url.replace(/"/g, '\\"')}"`;
    } else {
      cmd = `xdg-open "${url.replace(/"/g, '\\"')}"`;
    }

    exec(cmd, function () {
      resolve();
    });
  });
}
