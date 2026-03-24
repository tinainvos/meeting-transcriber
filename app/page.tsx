"use client";

import { useState, useRef, useCallback, useEffect } from "react";

type Status = "idle" | "recording" | "paused" | "transcribing" | "summarizing" | "coaching";
type TranscriptView = "raw" | "cleaned";

interface MeetingContext {
  title: string;
  date: string;
  time: string;
  location: string;
  attendees: string;
  purpose: string;
}

const defaultContext: MeetingContext = {
  title: "",
  date: new Date().toISOString().slice(0, 10),
  time: "",
  location: "",
  attendees: "",
  purpose: "",
};

export default function Home() {
  const [status, setStatus] = useState<Status>("idle");
  const [timer, setTimer] = useState(0);
  const [transcript, setTranscript] = useState("");
  const [cleanedTranscript, setCleanedTranscript] = useState("");
  const [transcriptView, setTranscriptView] = useState<TranscriptView>("raw");
  const [summary, setSummary] = useState("");
  const [coach, setCoach] = useState("");
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [context, setContext] = useState<MeetingContext>(defaultContext);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const formatTime = (sec: number) => {
    const h = String(Math.floor(sec / 3600)).padStart(2, "0");
    const m = String(Math.floor((sec % 3600) / 60)).padStart(2, "0");
    const s = String(sec % 60).padStart(2, "0");
    return `${h}:${m}:${s}`;
  };

  const startTimer = useCallback(() => {
    timerRef.current = setInterval(() => {
      setTimer((prev) => prev + 1);
    }, 1000);
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.start(1000);
      setStatus("recording");
      setTimer(0);
      setTranscript("");
      setCleanedTranscript("");
      setSummary("");
      setCoach("");
      startTimer();
    } catch {
      alert("無法取得麥克風權限");
    }
  };

  const pauseRecording = () => {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.pause();
      setStatus("paused");
      stopTimer();
    }
  };

  const resumeRecording = () => {
    if (mediaRecorderRef.current?.state === "paused") {
      mediaRecorderRef.current.resume();
      setStatus("recording");
      startTimer();
    }
  };

  const stopRecording = async () => {
    if (!mediaRecorderRef.current) return;

    return new Promise<Blob>((resolve) => {
      mediaRecorderRef.current!.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        resolve(blob);
      };
      mediaRecorderRef.current!.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      stopTimer();
    });
  };

  const handleStop = async () => {
    const blob = await stopRecording();
    if (!blob) return;

    const url = URL.createObjectURL(blob);
    setAudioUrl(url);

    setStatus("transcribing");
    const formData = new FormData();
    formData.append("audio", blob, "recording.webm");

    try {
      const res = await fetch("/api/transcribe", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (data.text) {
        setTranscript(data.text);
      } else {
        setTranscript("轉錄失敗: " + (data.error || "未知錯誤"));
      }
    } catch (err) {
      setTranscript("轉錄失敗: " + String(err));
    }
    setStatus("idle");
  };

  const handleFileSelect = async () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "audio/*";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      setStatus("transcribing");
      setTranscript("");
      setCleanedTranscript("");
      setSummary("");
      setCoach("");
      const formData = new FormData();
      formData.append("audio", file);

      try {
        const res = await fetch("/api/transcribe", {
          method: "POST",
          body: formData,
        });
        const data = await res.json();
        if (data.text) {
          setTranscript(data.text);
        } else {
          setTranscript("轉錄失敗: " + (data.error || "未知錯誤"));
        }
      } catch (err) {
        setTranscript("轉錄失敗: " + String(err));
      }
      setStatus("idle");
    };
    input.click();
  };

  const handleClean = async () => {
    if (!transcript) return;
    setStatus("coaching");

    try {
      const res = await fetch("/api/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: transcript,
          mode: "clean",
        }),
      });
      const data = await res.json();
      setCleanedTranscript(data.summary || "清理失敗");
      setTranscriptView("cleaned");
    } catch (err) {
      setCleanedTranscript("清理失敗: " + String(err));
    }
    setStatus("idle");
  };

  const handleSummarize = async () => {
    if (!transcript) return;
    setStatus("summarizing");

    try {
      const res = await fetch("/api/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: transcript,
          context,
          mode: "summarize",
        }),
      });
      const data = await res.json();
      setSummary(data.summary || "摘要失敗");
    } catch (err) {
      setSummary("摘要失敗: " + String(err));
    }
    setStatus("idle");
  };

  const handleDeepCoach = async () => {
    if (!transcript) return;
    setStatus("coaching");

    try {
      const res = await fetch("/api/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: transcript,
          context,
          mode: "coach",
        }),
      });
      const data = await res.json();
      setCoach(data.summary || "分析失敗");
    } catch (err) {
      setCoach("分析失敗: " + String(err));
    }
    setStatus("idle");
  };

  const handleSave = () => {
    const content = [
      `# ${context.title || "Meeting Notes"}`,
      `日期: ${context.date}`,
      `時間: ${context.time}`,
      `地點: ${context.location}`,
      `與會者: ${context.attendees}`,
      `目的: ${context.purpose}`,
      "",
      "---",
      "",
      "## Transcript",
      cleanedTranscript || transcript,
      "",
      "## Summary",
      summary,
      "",
      "## Deep Coach",
      coach,
    ].join("\n");

    const blob = new Blob([content], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `meeting_${context.date || "notes"}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const updateContext = (field: keyof MeetingContext, value: string) => {
    setContext((prev) => ({ ...prev, [field]: value }));
  };

  useEffect(() => {
    return () => stopTimer();
  }, [stopTimer]);

  const isRecordingOrPaused = status === "recording" || status === "paused";
  const isBusy = status !== "idle" && !isRecordingOrPaused;

  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-gray-200 shrink-0">
        <h1 className="text-lg font-semibold text-gray-900">Meeting Transcriber</h1>
        <div className="flex items-center gap-4">
          <span className="font-mono text-2xl text-gray-900">{formatTime(timer)}</span>
          {isRecordingOrPaused && (
            <span
              className={`px-3 py-1 rounded-full text-xs font-medium ${
                status === "recording"
                  ? "bg-red-500/20 text-red-400 animate-pulse"
                  : "bg-yellow-500/20 text-yellow-400"
              }`}
            >
              {status === "recording" ? "REC" : "PAUSED"}
            </span>
          )}
          {status === "transcribing" && (
            <span className="px-3 py-1 rounded-full text-xs font-medium bg-blue-500/20 text-blue-400 animate-pulse">
              轉錄中...
            </span>
          )}
          {status === "summarizing" && (
            <span className="px-3 py-1 rounded-full text-xs font-medium bg-purple-500/20 text-purple-400 animate-pulse">
              摘要中...
            </span>
          )}
          {status === "coaching" && (
            <span className="px-3 py-1 rounded-full text-xs font-medium bg-amber-500/20 text-amber-400 animate-pulse">
              AI 分析中...
            </span>
          )}
        </div>
      </header>

      {/* Main content - three columns */}
      <main className="flex-1 flex overflow-hidden min-h-0">
        {/* Left: Context / Playbook */}
        <div className="w-[320px] flex flex-col border-r border-gray-200 shrink-0">
          <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200">
            <span className="text-sm font-medium text-gray-500">CONTEXT / PLAYBOOK</span>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            <div>
              <input
                type="text"
                placeholder="會議標題"
                value={context.title}
                onChange={(e) => updateContext("title", e.target.value)}
                className="w-full bg-transparent border-b border-gray-300 text-gray-900 text-lg font-medium pb-2 focus:outline-none focus:border-blue-500 placeholder-gray-400"
              />
            </div>

            <div className="bg-gray-50 rounded-lg p-3 space-y-2 border border-gray-200">
              <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wider">會議劇本 (Meeting Playbook)</h3>
              <table className="w-full text-sm">
                <tbody>
                  <tr className="border-b border-gray-200">
                    <td className="py-2 pr-3 text-gray-500 whitespace-nowrap align-top">項目</td>
                    <td className="py-2 text-gray-400">內容</td>
                  </tr>
                  <tr className="border-b border-gray-200">
                    <td className="py-2 pr-3 text-gray-500 whitespace-nowrap">日期</td>
                    <td className="py-2">
                      <input
                        type="date"
                        value={context.date}
                        onChange={(e) => updateContext("date", e.target.value)}
                        className="w-full bg-transparent text-gray-700 focus:outline-none"
                      />
                    </td>
                  </tr>
                  <tr className="border-b border-gray-200">
                    <td className="py-2 pr-3 text-gray-500 whitespace-nowrap">時間</td>
                    <td className="py-2">
                      <input
                        type="text"
                        placeholder="例: 14:00-15:00"
                        value={context.time}
                        onChange={(e) => updateContext("time", e.target.value)}
                        className="w-full bg-transparent text-gray-700 focus:outline-none placeholder-gray-400"
                      />
                    </td>
                  </tr>
                  <tr className="border-b border-gray-200">
                    <td className="py-2 pr-3 text-gray-500 whitespace-nowrap">地點</td>
                    <td className="py-2">
                      <input
                        type="text"
                        placeholder="例: Google Meet URL"
                        value={context.location}
                        onChange={(e) => updateContext("location", e.target.value)}
                        className="w-full bg-transparent text-gray-700 focus:outline-none placeholder-gray-400"
                      />
                    </td>
                  </tr>
                  <tr className="border-b border-gray-200">
                    <td className="py-2 pr-3 text-gray-500 whitespace-nowrap align-top">與會者</td>
                    <td className="py-2">
                      <textarea
                        placeholder="參與人員"
                        value={context.attendees}
                        onChange={(e) => updateContext("attendees", e.target.value)}
                        rows={2}
                        className="w-full bg-transparent text-gray-700 focus:outline-none placeholder-gray-400 resize-none"
                      />
                    </td>
                  </tr>
                  <tr>
                    <td className="py-2 pr-3 text-gray-500 whitespace-nowrap align-top">目的</td>
                    <td className="py-2">
                      <textarea
                        placeholder="會議目的"
                        value={context.purpose}
                        onChange={(e) => updateContext("purpose", e.target.value)}
                        rows={3}
                        className="w-full bg-transparent text-gray-700 focus:outline-none placeholder-gray-400 resize-none"
                      />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Summary section in left column */}
            {summary && (
              <div className="mt-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wider">SUMMARY</h3>
                  <button onClick={() => handleCopy(summary)} className="text-xs text-gray-400 hover:text-gray-900">複製</button>
                </div>
                <pre className="text-sm leading-relaxed whitespace-pre-wrap text-gray-700 font-sans bg-gray-50 rounded-lg p-3 border border-gray-200">
                  {summary}
                </pre>
              </div>
            )}
          </div>
        </div>

        {/* Center: Transcript */}
        <div className="flex-1 flex flex-col border-r border-gray-200 min-w-0">
          <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-500">TRANSCRIPT</span>
              <div className="flex bg-gray-100 rounded-md overflow-hidden ml-3">
                <button
                  onClick={() => setTranscriptView("raw")}
                  className={`px-3 py-1 text-xs font-medium transition-colors ${
                    transcriptView === "raw"
                      ? "bg-blue-600 text-white"
                      : "text-gray-400 hover:text-gray-700"
                  }`}
                >
                  RAW
                </button>
                <button
                  onClick={() => setTranscriptView("cleaned")}
                  className={`px-3 py-1 text-xs font-medium transition-colors ${
                    transcriptView === "cleaned"
                      ? "bg-blue-600 text-white"
                      : "text-gray-400 hover:text-gray-700"
                  }`}
                >
                  CLEANED
                </button>
              </div>
            </div>
            {transcript && (
              <button
                onClick={() => handleCopy(transcriptView === "raw" ? transcript : cleanedTranscript)}
                className="text-xs text-gray-400 hover:text-gray-700 transition-colors"
              >
                複製
              </button>
            )}
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {transcriptView === "raw" ? (
              transcript ? (
                <pre className="text-sm leading-relaxed whitespace-pre-wrap text-gray-700 font-sans">
                  {transcript}
                </pre>
              ) : (
                <div className="flex items-center justify-center h-full text-gray-600">
                  <p>點擊「Start」開始錄音，或選擇音檔</p>
                </div>
              )
            ) : cleanedTranscript ? (
              <pre className="text-sm leading-relaxed whitespace-pre-wrap text-gray-700 font-sans">
                {cleanedTranscript}
              </pre>
            ) : (
              <div className="flex items-center justify-center h-full text-gray-600">
                <p>點擊「Clean」清理逐字稿</p>
              </div>
            )}
          </div>
        </div>

        {/* Right: Deep Coach */}
        <div className="w-[350px] flex flex-col shrink-0">
          <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200">
            <span className="text-sm font-medium text-gray-500">DEEP COACH</span>
            {coach && (
              <button
                onClick={() => handleCopy(coach)}
                className="text-xs text-gray-400 hover:text-gray-700 transition-colors"
              >
                複製
              </button>
            )}
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {coach ? (
              <pre className="text-sm leading-relaxed whitespace-pre-wrap text-gray-700 font-sans">
                {coach}
              </pre>
            ) : (
              <div className="flex items-center justify-center h-full text-gray-600 text-center px-4">
                <p>點擊「Deep Coach」根據會議內容取得 AI 建議</p>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Bottom controls */}
      <footer className="flex items-center gap-3 px-6 py-3 border-t border-gray-200 bg-gray-50 shrink-0">
        {!isRecordingOrPaused ? (
          <button
            onClick={startRecording}
            disabled={isBusy}
            className="px-5 py-2 rounded-lg bg-green-600 hover:bg-green-500 text-white text-sm font-medium disabled:opacity-40 transition-colors"
          >
            Start
          </button>
        ) : (
          <>
            {status === "recording" ? (
              <button
                onClick={pauseRecording}
                className="px-5 py-2 rounded-lg bg-yellow-600 hover:bg-yellow-500 text-white text-sm font-medium transition-colors"
              >
                Resume
              </button>
            ) : (
              <button
                onClick={resumeRecording}
                className="px-5 py-2 rounded-lg bg-green-600 hover:bg-green-500 text-white text-sm font-medium transition-colors"
              >
                Resume
              </button>
            )}
            <button
              onClick={handleStop}
              className="px-5 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-medium transition-colors"
            >
              End
            </button>
          </>
        )}

        <button
          onClick={handleFileSelect}
          disabled={isBusy}
          className="px-5 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium disabled:opacity-40 transition-colors"
        >
          選擇音檔
        </button>

        <div className="w-px h-6 bg-gray-300" />

        <button
          onClick={handleDeepCoach}
          disabled={!transcript || isBusy}
          className="px-5 py-2 rounded-lg bg-amber-700 hover:bg-amber-600 text-white text-sm font-medium disabled:opacity-40 transition-colors"
        >
          Deep Coach
        </button>

        <button
          onClick={handleClean}
          disabled={!transcript || isBusy}
          className="px-5 py-2 rounded-lg bg-teal-700 hover:bg-teal-600 text-white text-sm font-medium disabled:opacity-40 transition-colors"
        >
          Clean
        </button>

        <button
          onClick={handleSummarize}
          disabled={!transcript || isBusy}
          className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium disabled:opacity-40 transition-colors"
        >
          Summarize
        </button>

        <button
          onClick={handleSave}
          disabled={!transcript && !summary}
          className="px-5 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-white text-sm font-medium disabled:opacity-40 transition-colors"
        >
          Save
        </button>

        {audioUrl && (
          <audio controls src={audioUrl} className="h-8 ml-auto" />
        )}
      </footer>
    </div>
  );
}
