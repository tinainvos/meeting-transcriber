import { NextRequest, NextResponse } from "next/server";
import { writeFile, unlink } from "fs/promises";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import os from "os";

const execFileAsync = promisify(execFile);

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const file = formData.get("audio") as File;
  if (!file) {
    return NextResponse.json({ error: "No audio file" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const tmpDir = os.tmpdir();
  const inputPath = path.join(tmpDir, `upload_${Date.now()}.webm`);
  const wavPath = path.join(tmpDir, `whisper_${Date.now()}.wav`);
  const modelPath = path.join(
    os.homedir(),
    ".local/share/whisper-cpp/ggml-base.bin"
  );

  try {
    // Save uploaded file
    await writeFile(inputPath, buffer);

    // Convert to WAV 16kHz mono
    await execFileAsync("ffmpeg", [
      "-y",
      "-i",
      inputPath,
      "-ar",
      "16000",
      "-ac",
      "1",
      "-c:a",
      "pcm_s16le",
      wavPath,
    ]);

    // Run whisper-cli
    const { stdout, stderr } = await execFileAsync(
      "whisper-cli",
      ["-m", modelPath, "-l", "auto", "-f", wavPath],
      { maxBuffer: 50 * 1024 * 1024, timeout: 600000 }
    );

    // Parse transcript lines
    const lines = (stdout + stderr)
      .split("\n")
      .map((line) => {
        const match = line.trim().match(/^\[(\d+):(\d+):(\d+)\.\d+\s*-->.*?\]\s*(.*)/);
        return match ? `${match[1]}:${match[2]}:${match[3]} ${match[4].trim()}` : null;
      })
      .filter(Boolean)
      .join("\n");

    return NextResponse.json({ text: lines || "（無法辨識內容）" });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    // Cleanup temp files
    await unlink(inputPath).catch(() => {});
    await unlink(wavPath).catch(() => {});
  }
}
