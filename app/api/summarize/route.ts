import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, unlink } from "fs/promises";
import path from "path";
import os from "os";

const execFileAsync = promisify(execFile);

function buildPrompt(
  mode: string,
  text: string,
  context?: { title?: string; date?: string; time?: string; location?: string; attendees?: string; purpose?: string }
) {
  const contextInfo = context
    ? `會議資訊：
標題: ${context.title || "未指定"}
日期: ${context.date || "未指定"}
時間: ${context.time || "未指定"}
地點: ${context.location || "未指定"}
與會者: ${context.attendees || "未指定"}
目的: ${context.purpose || "未指定"}

`
    : "";

  const trimmedText = text.slice(0, 30000);

  if (mode === "clean") {
    return `請將以下語音轉錄的原始文字清理成易讀的逐字稿。
- 移除時間戳記
- 修正明顯的語音辨識錯誤
- 適當斷句分段
- 保留原意，不要增刪內容
直接輸出清理後的文字，不要加任何說明。

原始轉錄：
${trimmedText}`;
  }

  if (mode === "coach") {
    return `你是一個即時會議戰術顧問（Deep Coach）。根據以下會議資訊和對話內容，提供分析和建議。

${contextInfo}對話內容：
${trimmedText}

請用以下格式回覆：

🎯 對方意圖
（分析對方的核心訴求和立場）

💬 建議話術
（提供 2-3 個可以使用的回應方式）

⚠️ 注意
（需要注意的風險或陷阱）

👉 下一步
（建議的後續行動）`;
  }

  // default: summarize
  return `${contextInfo}請閱讀以下會議轉錄文字，產生結構化摘要。直接輸出摘要內容。

格式：
## Meeting Summary
（2-3 段摘要）

## Key Decisions
（關鍵決策，如果沒有就寫「無正式決策產生」）

## Action Items
（待辦事項，格式：[ ] 負責人 - 事項）

## Key Discussions
（重要討論主題）

轉錄文字：
${trimmedText}`;
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { text, context, mode = "summarize" } = body;

  if (!text) {
    return NextResponse.json({ error: "No text provided" }, { status: 400 });
  }

  const tmpDir = os.tmpdir();
  const inputFile = path.join(tmpDir, `claude_input_${Date.now()}.txt`);

  try {
    const prompt = buildPrompt(mode, text, context);
    await writeFile(inputFile, prompt);

    const { stdout } = await execFileAsync(
      "claude",
      ["-p", prompt, "--output-format", "text"],
      {
        maxBuffer: 10 * 1024 * 1024,
        timeout: 120000,
        env: { ...process.env, PATH: process.env.PATH },
      }
    );

    return NextResponse.json({ summary: stdout.trim() });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    await unlink(inputFile).catch(() => {});
  }
}
