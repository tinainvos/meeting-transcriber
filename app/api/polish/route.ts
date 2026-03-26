import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import os from "os";

const execFileAsync = promisify(execFile);
const claudePath = path.join(os.homedir(), ".local/bin/claude");

export async function POST(request: NextRequest) {
  const { text } = await request.json();

  if (!text) {
    return NextResponse.json({ error: "No text provided" }, { status: 400 });
  }

  const prompt = `以下是一段語音轉錄的原始文字（無標點、無分段）。請潤飾使其易讀。規則：
- 修正明顯的語音辨識錯誤
- 加入適當的標點符號（句號、逗號、問號等）
- 在語意轉換處換行分段，讓文字有呼吸感
- 保留原意，不要增刪內容
- 直接輸出潤飾後的文字，不要加任何說明或標題

${text.slice(0, 15000)}`;

  try {
    const { stdout } = await execFileAsync(
      claudePath,
      ["-p", prompt, "--output-format", "text", "--model", "claude-haiku-4-5-20251001"],
      {
        maxBuffer: 10 * 1024 * 1024,
        timeout: 60000,
        env: { ...process.env, PATH: process.env.PATH },
      }
    );

    return NextResponse.json({ text: stdout.trim() });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
