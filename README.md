# Meeting Transcriber

本地端 AI 會議記錄工具。錄音或上傳音檔，自動轉成逐字稿，再用 AI 產生摘要與即時建議。

所有資料皆在本機處理，不上傳任何第三方雲端。

## 功能

- **即時錄音** — 瀏覽器錄音，支援暫停/繼續/停止
- **上傳音檔** — 支援 mp3、m4a、wav、webm 等格式
- **語音轉文字** — 使用 Whisper (whisper-cpp) 本地轉錄，支援中英文
- **即時轉錄** — 錄音時每 5 秒自動轉錄，文字即時顯示
- **串流轉錄** — 上傳音檔時文字逐行出現，附進度條
- **AI 即時潤飾** — 本地規則即時斷句 + Claude Haiku 背景潤飾，自動加標點與分段
- **AI 摘要** — 透過 Claude Code CLI 產生結構化會議摘要
- **AI 即時顧問 (Deep Coach)** — 分析對方意圖、建議話術、注意事項、下一步
- **會議劇本 (Playbook)** — 匯入 .md 檔自動填入會議資訊
- **匯出** — 一鍵下載完整會議記錄（.md 格式）

## 架構

```
瀏覽器 (Next.js)
├── MediaRecorder API → 錄音
├── /api/transcribe → ffmpeg 轉檔 + whisper-cli 轉文字（即時錄音用）
├── /api/transcribe-stream → SSE 串流轉錄（上傳音檔用，逐行回傳）
├── /api/polish → Claude Haiku 即時潤飾逐字稿（加標點、分段）
├── /api/summarize → Claude Code CLI 產生摘要 / Deep Coach 建議
└── /api/convert-wav → 轉換錄音格式（修正 audio player 時間軸）
```

## 流程

```
1. 錄音 / 上傳音檔
       │
       ▼
2. ffmpeg 將音檔轉成 16kHz mono WAV
       │
       ▼
3. whisper-cli 本地語音轉文字
   ├── 即時錄音：每 5 秒送一次，文字即時更新
   └── 上傳音檔：SSE 串流，文字逐行出現 + 進度條
       │
       ▼
3.5. 本地規則即時斷句 + Claude Haiku 背景潤飾
       │
       ▼
4. 使用者點擊 ▶ 觸發 Summarize / Deep Coach
       │
       ▼
5. 後端呼叫本機 claude CLI（費用包含在 Claude Max 訂閱）
   ├── Summarize：產生 Meeting Summary / Key Decisions / Action Items
   └── Deep Coach：分析對方意圖 / 建議話術 / 注意事項 / 下一步
       │
       ▼
6. 前端顯示結果
       │
       ▼
7. 點擊 ⬇ 匯出完整會議記錄（.md）
```

## 前置需求

- **Node.js** 18+
- **whisper-cpp** — 語音轉文字引擎
- **ffmpeg** — 音檔格式轉換
- **Claude Code CLI** — AI 摘要（需要 Claude Max 訂閱方案）
- **Whisper 模型檔** — `~/.local/share/whisper-cpp/ggml-base.bin`

### 安裝前置工具（macOS）

```bash
# whisper-cpp
brew install whisper-cpp

# ffmpeg
brew install ffmpeg

# 下載 Whisper base 模型（~150MB）
mkdir -p ~/.local/share/whisper-cpp
curl -L -o ~/.local/share/whisper-cpp/ggml-base.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin
```

## 安裝與啟動

```bash
npm install
npm run dev
```

開啟瀏覽器前往 http://localhost:3000

## UI 佈局

```
┌─────────────────────────────────────────────────────┐
│  Meeting Transcriber                        ↺  ⬇   │
├──────────────────────┬──────────────────────────────┤
│  CONTEXT / PLAYBOOK  │  MEETING SUMMARY         ▶  │
│  + 匯入 playbook     │                             │
│  ───────────────────  │  ────────────────────────── │
│  TRANSCRIPT    ▶ ⬆   │  DEEP COACH              ▶  │
│                       │                             │
└──────────────────────┴──────────────────────────────┘
```

### 操作說明

| 按鈕 | 位置 | 功能 |
|------|------|------|
| ▶ | TRANSCRIPT 旁 | 開始錄音 |
| ⬆ | TRANSCRIPT 旁 | 上傳音檔 |
| ⏸ | TRANSCRIPT 旁（錄音中） | 暫停錄音 |
| ⏹ | TRANSCRIPT 旁（錄音中/轉錄中） | 停止 |
| 📋 | TRANSCRIPT 旁（有文字時） | 複製逐字稿 |
| ✕ | TRANSCRIPT 旁（有文字時） | 清除逐字稿 |
| ▶ | MEETING SUMMARY 旁 | 產生 AI 摘要 |
| ▶ | DEEP COACH 旁 | 取得 AI 即時建議 |
| + | CONTEXT / PLAYBOOK 旁 | 匯入 Playbook (.md) |
| ↺ | Header 右側 | 重置所有資料 |
| ⬇ | Header 右側 | 下載會議記錄 (.md) |

## Playbook 格式

參考 `playbooks/template.md`，`## 基本資訊` 下的欄位會自動解析填入表單：

```markdown
# 會議標題

## 基本資訊

- 日期: 2026-03-24
- 時間: 14:00-15:00
- 地點: https://meet.google.com/xxx
- 與會者: Alice, Bob
- 目的: 討論 Q2 規劃

## 會議議程
1. ...

## 背景資料
- ...

## 我方立場 / 策略
- ...
```

## 隱私

- 所有錄音和轉錄資料僅存在瀏覽器記憶體，關閉頁面即消失
- 語音轉文字由本機 whisper-cpp 處理，不經過任何外部 API
- AI 摘要透過本機 Claude Code CLI 處理
- 專案不儲存任何音檔或會議記錄

## 費用

| 項目 | 費用 |
|------|------|
| 語音轉文字 (Whisper) | 免費（本地執行） |
| AI 摘要 / Deep Coach (Claude) | 包含在 Claude Max 訂閱 |

## 技術棧

- **前端** — Next.js 14, TypeScript, Tailwind CSS, shadcn/ui, react-resizable-panels
- **語音轉文字** — whisper-cpp (whisper-cli)
- **音檔處理** — ffmpeg
- **AI** — Claude Code CLI
- **字體** — Google Nunito (英文) / Noto Sans TC (中文)
