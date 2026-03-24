import { NextRequest } from "next/server";
import { writeFile, readFile, unlink } from "fs/promises";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import os from "os";

const execFileAsync = promisify(execFile);

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const file = formData.get("audio") as File;
  if (!file) {
    return new Response("No file", { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const tmpDir = os.tmpdir();
  const inputPath = path.join(tmpDir, `convert_${Date.now()}.webm`);
  const wavPath = path.join(tmpDir, `convert_${Date.now()}.wav`);

  try {
    await writeFile(inputPath, buffer);

    await execFileAsync("ffmpeg", [
      "-y", "-i", inputPath,
      "-c:a", "pcm_s16le", "-ar", "44100", "-ac", "1",
      wavPath,
    ]);

    const wavBuffer = await readFile(wavPath);

    return new Response(wavBuffer, {
      headers: {
        "Content-Type": "audio/wav",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(message, { status: 500 });
  } finally {
    await unlink(inputPath).catch(() => {});
    await unlink(wavPath).catch(() => {});
  }
}
