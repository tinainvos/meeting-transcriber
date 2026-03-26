import { NextRequest } from "next/server";
import { writeFile, unlink, stat } from "fs/promises";
import { spawn, execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import os from "os";

const execFileAsync = promisify(execFile);

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const file = formData.get("audio") as File;
  if (!file) {
    return new Response(JSON.stringify({ error: "No audio file" }), { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const tmpDir = os.tmpdir();
  const inputPath = path.join(tmpDir, `upload_${Date.now()}.webm`);
  const wavPath = path.join(tmpDir, `whisper_${Date.now()}.wav`);
  const modelPath = path.join(os.homedir(), ".local/share/whisper-cpp/ggml-base.bin");

  await writeFile(inputPath, buffer);

  // Convert to WAV
  try {
    await execFileAsync("ffmpeg", [
      "-y", "-i", inputPath, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wavPath,
    ]);
  } catch (err) {
    await unlink(inputPath).catch(() => {});
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: "ffmpeg error: " + message }), { status: 500 });
  }

  // Get audio duration for progress
  let duration = 0;
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "error", "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1", wavPath,
    ]);
    duration = parseFloat(stdout.trim()) || 0;
  } catch {
    // ignore
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // Send duration info first
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "info", duration: Math.round(duration) })}\n\n`));

      const whisper = spawn("whisper-cli", ["-m", modelPath, "-l", "auto", "-f", wavPath], {
        stdio: ["ignore", "pipe", "pipe"],
      });

      let combined = "";

      const processLine = (line: string) => {
        const trimmed = line.trim();
        const match = trimmed.match(/^\[(\d+):(\d+):(\d+)\.\d+\s*-->.*?\]\s*(.*)/);
        if (match && match[4].trim()) {
          const secs = parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseInt(match[3]);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "line", text: match[4].trim(), secs })}\n\n`));
        }
      };

      whisper.stdout.on("data", (data: Buffer) => {
        combined += data.toString();
        const lines = combined.split("\n");
        combined = lines.pop() || "";
        lines.forEach(processLine);
      });

      whisper.stderr.on("data", (data: Buffer) => {
        const text = data.toString();
        // Check for progress info
        const progressMatch = text.match(/progress\s*=\s*(\d+)/);
        if (progressMatch) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "progress", percent: parseInt(progressMatch[1]) })}\n\n`));
        }
        // Also check stderr for transcript lines
        combined += text;
        const lines = combined.split("\n");
        combined = lines.pop() || "";
        lines.forEach(processLine);
      });

      whisper.on("close", async () => {
        if (combined.trim()) processLine(combined);
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`));
        controller.close();

        // Cleanup
        await unlink(inputPath).catch(() => {});
        await unlink(wavPath).catch(() => {});
      });

      whisper.on("error", async (err) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "error", message: err.message })}\n\n`));
        controller.close();
        await unlink(inputPath).catch(() => {});
        await unlink(wavPath).catch(() => {});
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
