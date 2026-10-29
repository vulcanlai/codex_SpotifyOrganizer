# G3 合成測試資料

`g3_data.js` 人工定義 400 首虛構歌曲：sample-100 的 AI 來源為 10 + 20 + 70 首，
90 首 medium、10 首 low，31 首缺少演唱語言證據，另 300 首供新分類。
fixture 不從正式 backup、歷史快照或 OAuth 憑證產生。

`g3_fixture.js` 為每個測試 worker 複製實際 lib 到暫存專案，每項測試重建合成資料；
所有寫入與模組路徑均指向暫存位置，結束後清理。F 波次另直接提供合成 context，
驗證集合差、固定 seed、短佇列及缺少 Agent output 時停止，不依賴歷史 pending 數字。
相同來源的精確數字與缺口、重複、重疊反例均保留，不能以目前正式資料的數字取代。

- `npm run test:g3`：先跑這些 G3 測試。
- `npm test`：在隔離專案副本執行完整既有清單，使用假 Client ID，
  阻擋正式專案寫入與外部 HTTP，前後核對正式 backup SHA-256。
- `test:unit` 保留原始 Node 測試清單，供隔離入口使用；不要直接對正式資料執行。

完整測試中尚有既有測試需要本機資料的唯讀副本；本次未將所有歷史測試改為合成 fixture。
