"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Panel, Group as PanelGroup, Separator as ResizeHandle } from "react-resizable-panels";
import { Plus, Pause, Play, Square, Upload, Copy, X, Loader2, Download, RotateCcw } from "lucide-react";

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

// Local instant punctuation for raw Chinese transcript
function localPolish(text: string): string {
  if (!text) return text;
  let result = text;

  // Add comma after common transition words/phrases
  result = result.replace(/(然後|所以|但是|不過|因為|如果|那|就是說|接下來|其實|基本上|簡單來說|總之|對|好|嗯|欸)(?=[^\s，。、！？\n])/g, "$1，");

  // Add period before topic transitions (when followed by certain patterns)
  result = result.replace(/(了|的|吧|嗎|呢|啊|哦|喔|啦|嘛|呀|吼|齁|對)(?=(然後|所以|但是|不過|因為|如果|那我|接下來|其實|再來|第一|第二|第三|首先|最後))/g, "$1。\n\n");

  // Add period + line break at longer segments (~80 chars) at natural break points
  const segments: string[] = [];
  let current = "";
  for (const char of result) {
    current += char;
    if (char === "\n") {
      segments.push(current);
      current = "";
    } else if (current.length > 60 && /[，。！？]/.test(char)) {
      segments.push(current + "\n");
      current = "";
    }
  }
  if (current) segments.push(current);
  result = segments.join("");

  // Clean up: remove duplicate punctuation
  result = result.replace(/，+/g, "，");
  result = result.replace(/。+/g, "。");
  result = result.replace(/，。/g, "。");
  result = result.replace(/\n{3,}/g, "\n\n");

  return result;
}

function TranscriptLines({ text }: { text: string }) {
  return (
    <div className="space-y-1">
      {text.split("\n").map((line, i) => {
        const match = line.match(/^(\d+:\d+:\d+)\s+(.*)/);
        if (match) {
          return (
            <div key={i} className="flex gap-4">
              <span className="text-xs text-muted-foreground font-mono tabular-nums shrink-0 pt-0.5">{match[1]}</span>
              <span className="text-sm">{match[2]}</span>
            </div>
          );
        }
        return <div key={i} className="text-sm">{line}</div>;
      })}
    </div>
  );
}

export default function Home() {
  const [status, setStatus] = useState<Status>("idle");
  const [timer, setTimer] = useState(0);
  const [transcript, setTranscript] = useState("");
  const [audioDuration, setAudioDuration] = useState(0);
  const [transcribeProgress, setTranscribeProgress] = useState(0);
  const [cleanedTranscript, setCleanedTranscript] = useState("");
  const [transcriptView, setTranscriptView] = useState<TranscriptView>("raw");
  const [summary, setSummary] = useState("");
  const [coach, setCoach] = useState("");
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [context, setContext] = useState<MeetingContext>(defaultContext);
  const [playbookContent, setPlaybookContent] = useState("");
  const [playbookFilename, setPlaybookFilename] = useState("");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const liveTranscriptRef = useRef<NodeJS.Timeout | null>(null);
  const lastTranscribedIndex = useRef(0);
  const isTranscribingChunk = useRef(false);
  const isPolishing = useRef(false);
  const polishTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const transcriptContainerRef = useRef<HTMLDivElement | null>(null);
  const userScrolledUp = useRef(false);
  const [polishedTranscript, setPolishedTranscript] = useState("");
  const [isPolishingState, setIsPolishingState] = useState(false);
  const polishedRawLength = useRef(0); // how many chars of raw text have been polished

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

  const pendingPolishText = useRef<string | null>(null);

  const polishTranscript = useCallback(async (text: string) => {
    if (isPolishing.current) {
      // Queue this text for when the current polish finishes
      pendingPolishText.current = text;
      return;
    }
    if (!text) return;
    isPolishing.current = true;
    setIsPolishingState(true);
    try {
      console.log("[polish] sending text length:", text.length);
      const res = await fetch("/api/polish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      console.log("[polish] response:", data.text ? "ok, length:" + data.text.length : "error:" + data.error);
      if (data.text) {
        setPolishedTranscript(data.text);
        polishedRawLength.current = text.length;
      }
    } catch (err) {
      console.error("[polish] fetch error:", err);
    }
    isPolishing.current = false;
    setIsPolishingState(false);

    // If new text came in while polishing, process it
    if (pendingPolishText.current) {
      const next = pendingPolishText.current;
      pendingPolishText.current = null;
      polishTranscript(next);
    }
  }, []);

  const schedulePolish = useCallback((text: string) => {
    if (polishTimeoutRef.current) clearTimeout(polishTimeoutRef.current);
    polishTimeoutRef.current = setTimeout(() => {
      polishTranscript(text);
    }, 2000);
  }, [polishTranscript]);

  const transcribeChunk = useCallback(async () => {
    if (isTranscribingChunk.current) return;
    const chunks = chunksRef.current;
    if (chunks.length <= lastTranscribedIndex.current) return;

    isTranscribingChunk.current = true;
    try {
      const blob = new Blob(chunks.slice(0), { type: "audio/webm" });
      const formData = new FormData();
      formData.append("audio", blob, "chunk.webm");

      console.log("[transcribe] sending chunk, size:", blob.size);
      const res = await fetch("/api/transcribe", { method: "POST", body: formData });
      const data = await res.json();
      console.log("[transcribe] response:", data.text ? "text length:" + data.text.length : "error:" + data.error);
      if (data.text) {
        setTranscript(data.text);
        console.log("[transcribe] scheduling polish");
        schedulePolish(data.text);
      }
      lastTranscribedIndex.current = chunks.length;
    } catch {
      // ignore chunk errors
    }
    isTranscribingChunk.current = false;
  }, [schedulePolish]);

  const startLiveTranscription = useCallback(() => {
    liveTranscriptRef.current = setInterval(() => {
      transcribeChunk();
    }, 5000); // every 5 seconds
  }, [transcribeChunk]);

  const stopLiveTranscription = useCallback(() => {
    if (liveTranscriptRef.current) {
      clearInterval(liveTranscriptRef.current);
      liveTranscriptRef.current = null;
    }
    if (polishTimeoutRef.current) {
      clearTimeout(polishTimeoutRef.current);
      polishTimeoutRef.current = null;
    }
  }, []);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];
      lastTranscribedIndex.current = 0;
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      mediaRecorder.start(1000);
      setStatus("recording");
      setTimer(0);
      setTranscript("");
      setPolishedTranscript("");
      polishedRawLength.current = 0;
      setCleanedTranscript("");
      setSummary("");
      setCoach("");
      startTimer();
      startLiveTranscription();
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
    stopLiveTranscription();
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

  const handleStopTranscribe = () => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setStatus("idle");
  };

  const handleClearTranscript = () => {
    setTranscript("");
    setPolishedTranscript("");
    setCleanedTranscript("");
    setSummary("");
    setCoach("");
    setAudioUrl(null);
    setAudioDuration(0);
    setTranscribeProgress(0);
  };

  const handleResetAll = () => {
    setTranscript("");
    setPolishedTranscript("");
    setCleanedTranscript("");
    setSummary("");
    setCoach("");
    setAudioUrl(null);
    setAudioDuration(0);
    setTranscribeProgress(0);
    setContext(defaultContext);
    setPlaybookContent("");
    setPlaybookFilename("");
  };

  const streamTranscribe = async (blob: Blob, filename: string) => {
    setStatus("transcribing");
    setTranscript("");
    setAudioDuration(0);
    setTranscribeProgress(0);
    userScrolledUp.current = false;

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    const formData = new FormData();
    formData.append("audio", blob, filename);
    const lines: string[] = [];

    try {
      const res = await fetch("/api/transcribe-stream", { method: "POST", body: formData, signal: abortController.signal });
      const reader = res.body?.getReader();
      if (!reader) throw new Error("No reader");

      const decoder = new TextDecoder();
      let buffer = "";
      let totalDuration = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";

        for (const part of parts) {
          const dataLine = part.replace(/^data: /, "").trim();
          if (!dataLine) continue;
          try {
            const msg = JSON.parse(dataLine);
            if (msg.type === "info") {
              totalDuration = msg.duration;
              setAudioDuration(msg.duration);
            } else if (msg.type === "line") {
              lines.push(msg.text);
              setTranscript(lines.join(""));
              if (msg.secs !== undefined && totalDuration > 0) {
                setTranscribeProgress(Math.min(Math.round((msg.secs / totalDuration) * 100), 99));
              }
              // Polish every 5 lines during streaming
              if (lines.length % 5 === 0 && !isPolishing.current) {
                isPolishing.current = true;
                setIsPolishingState(true);
                const textToPolish = lines.join("");
                const rawLen = textToPolish.length;
                fetch("/api/polish", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ text: textToPolish }),
                }).then(r => r.json()).then(d => {
                  if (d.text) {
                    setPolishedTranscript(d.text);
                    polishedRawLength.current = rawLen;
                  }
                }).catch(() => {}).finally(() => {
                  isPolishing.current = false;
                  setIsPolishingState(false);
                });
              }
            } else if (msg.type === "done") {
              setTranscribeProgress(100);
            } else if (msg.type === "error") {
              setTranscript("轉錄失敗: " + msg.message);
            }
          } catch {
            // ignore parse errors
          }
        }
      }
    } catch (err) {
      // Don't overwrite transcript if aborted with existing content
      if (err instanceof DOMException && err.name === "AbortError") {
        // user stopped, keep whatever transcript we have
      } else {
        setTranscript((prev) => prev || "轉錄失敗: " + String(err));
      }
    }
    abortControllerRef.current = null;
    setAudioDuration(0);
    setStatus("idle");

    // Trigger final polish after stream transcription completes
    const finalText = lines.join("");
    if (finalText) {
      console.log("[streamTranscribe] done, triggering final polish, length:", finalText.length);
      setIsPolishingState(true);
      try {
        const polishRes = await fetch("/api/polish", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: finalText }),
        });
        const polishData = await polishRes.json();
        if (polishData.text) {
          setPolishedTranscript(polishData.text);
          polishedRawLength.current = finalText.length;
        }
      } catch (err) {
        console.error("[polish] error:", err);
      }
      setIsPolishingState(false);
    }
  };

  const handleStop = async () => {
    const blob = await stopRecording();
    if (!blob) return;

    // Convert webm to wav via server for correct duration in audio player
    const formData = new FormData();
    formData.append("audio", blob, "recording.webm");
    try {
      const res = await fetch("/api/convert-wav", { method: "POST", body: formData });
      if (res.ok) {
        const wavBlob = await res.blob();
        setAudioUrl(URL.createObjectURL(wavBlob));
      } else {
        setAudioUrl(URL.createObjectURL(blob));
      }
    } catch {
      setAudioUrl(URL.createObjectURL(blob));
    }

    setCleanedTranscript("");
    setSummary("");
    setCoach("");
    await streamTranscribe(blob, "recording.webm");
  };

  const handleFileSelect = async () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "audio/*";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      setCleanedTranscript("");
      setSummary("");
      setCoach("");
      await streamTranscribe(file, file.name);
    };
    input.click();
  };

  const callClaude = async (mode: string) => {
    const statusMap: Record<string, Status> = { clean: "coaching", summarize: "summarizing", coach: "coaching" };
    setStatus(statusMap[mode] || "summarizing");
    try {
      const res = await fetch("/api/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: transcript, context, mode }),
      });
      const data = await res.json();
      const result = data.summary || "失敗";
      if (mode === "clean") { setCleanedTranscript(result); setTranscriptView("cleaned"); }
      else if (mode === "coach") { setCoach(result); }
      else { setSummary(result); }
    } catch (err) {
      const msg = "失敗: " + String(err);
      if (mode === "clean") setCleanedTranscript(msg);
      else if (mode === "coach") setCoach(msg);
      else setSummary(msg);
    }
    setStatus("idle");
  };

  const handleSave = () => {
    const datetime = context.date && context.time
      ? `${context.date} ${context.time}`
      : context.date || "";

    const sections = [
      `# ${context.title || "Meeting Notes"}`,
      "",
      "## 基本資訊",
      "",
      `- 日期時間: ${datetime}`,
      `- 地點: ${context.location}`,
      `- 與會者: ${context.attendees}`,
      `- 目的: ${context.purpose}`,
    ];

    if (playbookContent) {
      sections.push("", "## Playbook", "", playbookContent);
    }

    if (summary) {
      sections.push("", "---", "", "## Summary", "", summary);
    }

    if (coach) {
      sections.push("", "---", "", "## Deep Coach", "", coach);
    }

    sections.push("", "---", "", "## Transcript", "", cleanedTranscript || transcript);

    const content = sections.join("\n");
    const blob = new Blob([content], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `meeting_${context.date || "notes"}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopy = (text: string) => navigator.clipboard.writeText(text);

  const parsePlaybook = (text: string) => {
    const get = (key: string) => {
      const regex = new RegExp(`^-\\s*${key}:\\s*(.+)$`, "m");
      const match = text.match(regex);
      return match ? match[1].trim() : "";
    };

    const title = text.match(/^#\s+(.+)$/m)?.[1]?.trim() || "";
    const date = get("日期");
    const time = get("時間");
    const location = get("地點");
    const attendees = get("與會者");
    const purpose = get("目的");

    return { title, date, time, location, attendees, purpose };
  };

  const handleImportPlaybook = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".md,.markdown,.txt";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const text = await file.text();
      setPlaybookContent(text);
      setPlaybookFilename(file.name);

      const parsed = parsePlaybook(text);
      setContext((prev) => ({
        title: parsed.title || prev.title,
        date: parsed.date || prev.date,
        time: parsed.time || prev.time,
        location: parsed.location || prev.location,
        attendees: parsed.attendees || prev.attendees,
        purpose: parsed.purpose || prev.purpose,
      }));
    };
    input.click();
  };

  const updateContext = (field: keyof MeetingContext, value: string) => {
    setContext((prev) => ({ ...prev, [field]: value }));
  };

  useEffect(() => { return () => { stopTimer(); stopLiveTranscription(); }; }, [stopTimer, stopLiveTranscription]);

  // Auto-scroll transcript to bottom when new text arrives
  useEffect(() => {
    const el = transcriptContainerRef.current;
    if (!el || userScrolledUp.current) return;
    el.scrollTop = el.scrollHeight;
  }, [transcript, polishedTranscript]);

  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const isRecordingOrPaused = status === "recording" || status === "paused";
  const isBusy = status !== "idle" && !isRecordingOrPaused;

  // Combine: AI polished portion + locally polished remaining raw text
  const remainingRaw = polishedTranscript
    ? transcript.slice(polishedRawLength.current)
    : "";
  const displayTranscript = polishedTranscript
    ? polishedTranscript + (remainingRaw ? "\n\n" + localPolish(remainingRaw) : "")
    : localPolish(transcript);

  if (!mounted) {
    return <div className="h-screen flex items-center justify-center bg-background text-muted-foreground">Loading...</div>;
  }

  return (
    <div className="h-screen flex flex-col bg-background text-foreground">
      {/* Header */}
      <header className="flex items-center justify-between px-3 py-2 border-b shrink-0">
        <h1 className="text-lg font-semibold">Meeting Transcriber</h1>
        <div className="flex items-center gap-1">
          <Button onClick={handleResetAll} disabled={isBusy} size="icon" variant="ghost" className="h-7 w-7" title="重置所有資料">
            <RotateCcw className="h-4 w-4" />
          </Button>
          <Button onClick={handleSave} disabled={!transcript && !summary} size="icon" variant="ghost" className="h-7 w-7" title="儲存會議記錄">
            <Download className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {/* Main content - three columns with resizable panels */}
      <main className="flex-1 overflow-hidden min-h-0">
        <PanelGroup direction="horizontal" className="h-full">

        {/* Left: Context (top) + Transcript (bottom), split vertically */}
        <Panel defaultSize={50} minSize={20}>
        <div className="h-full flex flex-col">
          {/* Top: Context / Playbook */}
          <div className="h-1/2 flex flex-col border-b overflow-hidden resize-y" style={{ minHeight: 120 }}>
            <div className="flex items-center justify-between px-4 py-2 border-b shrink-0">
              <span className="text-sm font-medium text-muted-foreground">CONTEXT / PLAYBOOK</span>
              <Button variant="ghost" size="icon" className="h-5 w-5" onClick={handleImportPlaybook} title="匯入 Playbook (.md)">
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto hide-scrollbar p-3 space-y-4">
              <Input
                placeholder="會議標題"
                value={context.title}
                onChange={(e) => updateContext("title", e.target.value)}
                className="text-lg font-medium border-0 border-b rounded-none shadow-none px-0 focus-visible:ring-0"
              />
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                會議劇本 (Meeting Playbook)
              </h3>
              <div className="grid grid-cols-[60px_1fr] gap-2 text-sm">
                <span className="text-muted-foreground py-1">日期時間</span>
                <Input type="datetime-local" value={context.date && context.time ? `${context.date}T${context.time.split("-")[0]?.trim() || "00:00"}` : context.date ? `${context.date}T00:00` : ""} onChange={(e) => { const v = e.target.value; if (v) { updateContext("date", v.split("T")[0]); updateContext("time", v.split("T")[1]?.slice(0, 5) || ""); } }} className="h-8 py-0 px-2" />
                <span className="text-muted-foreground py-1">地點</span>
                <Input placeholder="例: Google Meet URL" value={context.location} onChange={(e) => updateContext("location", e.target.value)} className="h-8" />
                <span className="text-muted-foreground py-1">與會者</span>
                <Textarea placeholder="參與人員" value={context.attendees} onChange={(e) => updateContext("attendees", e.target.value)} rows={2} className="resize-none min-h-0" />
                <span className="text-muted-foreground py-1">目的</span>
                <Textarea placeholder="會議目的" value={context.purpose} onChange={(e) => updateContext("purpose", e.target.value)} rows={2} className="resize-none min-h-0" />
              </div>

              {playbookContent && (
                <div className="mt-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{playbookFilename}</span>
                    <Button variant="ghost" size="sm" className="h-5 text-xs text-muted-foreground" onClick={() => { setPlaybookContent(""); setPlaybookFilename(""); }}>
                      移除
                    </Button>
                  </div>
                  <pre className="text-sm leading-relaxed whitespace-pre-wrap font-sans text-foreground bg-muted/50 rounded-md p-3">{playbookContent}</pre>
                </div>
              )}
            </div>
          </div>

          {/* Bottom: Transcript */}
          <div className="flex-1 flex flex-col overflow-hidden min-h-0">
            <div className="flex items-center justify-between px-4 py-2 border-b shrink-0">
              <span className="text-sm font-medium text-muted-foreground">TRANSCRIPT</span>
              <div className="flex items-center gap-2">
                {/* Idle + no transcript: show play + upload */}
                {!isRecordingOrPaused && !transcript && status === "idle" && (
                  <>
                    <Button onClick={startRecording} size="icon" variant="ghost" className="h-5 w-5" title="開始錄音">
                      <Play className="h-3 w-3" />
                    </Button>
                    <Button onClick={handleFileSelect} size="icon" variant="ghost" className="h-5 w-5" title="上傳音檔">
                      <Upload className="h-3 w-3" />
                    </Button>
                  </>
                )}
                {/* Transcribing: show progress bar + stop */}
                {status === "transcribing" && (
                  <>
                    <div className="w-20 h-1.5 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-blue-500 rounded-full transition-all duration-500 ease-out" style={{ width: `${transcribeProgress}%` }} />
                    </div>
                    <span className="text-xs text-muted-foreground font-mono tabular-nums">{transcribeProgress}%</span>
                    <Button onClick={handleStopTranscribe} size="icon" variant="destructive" className="h-5 w-5 rounded-full" title="停止轉錄">
                      <Square className="h-2 w-2" />
                    </Button>
                  </>
                )}
                {/* Recording/Paused: show status + controls */}
                {isRecordingOrPaused && (
                  <>
                    <div className={`w-2 h-2 rounded-full ${status === "recording" ? "bg-red-500 animate-pulse" : "bg-yellow-500"}`} />
                    <span className="text-xs text-muted-foreground font-mono tabular-nums">{formatTime(timer)}</span>
                    {status === "recording" ? (
                      <Button onClick={pauseRecording} size="icon" variant="secondary" className="h-5 w-5 rounded-full" title="暫停">
                        <Pause className="h-2.5 w-2.5" />
                      </Button>
                    ) : (
                      <Button onClick={resumeRecording} size="icon" className="h-5 w-5 rounded-full bg-green-600 hover:bg-green-500 text-white" title="繼續">
                        <Play className="h-2.5 w-2.5" />
                      </Button>
                    )}
                    <Button onClick={handleStop} size="icon" variant="destructive" className="h-5 w-5 rounded-full" title="停止">
                      <Square className="h-2 w-2" />
                    </Button>
                  </>
                )}
                {/* Has transcript + idle: show copy + clear */}
                {transcript && status === "idle" && (
                  <>
                    <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => handleCopy(transcript)} title="複製">
                      <Copy className="h-3 w-3" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-5 w-5" onClick={handleClearTranscript} title="清除">
                      <X className="h-3 w-3" />
                    </Button>
                  </>
                )}
              </div>
            </div>
            <div
              ref={transcriptContainerRef}
              className="flex-1 overflow-y-auto p-3 flex flex-col min-h-0"
              onWheel={(e) => {
                if (e.deltaY < 0) userScrolledUp.current = true;
              }}
              onScroll={(e) => {
                const el = e.currentTarget;
                if (el.scrollHeight - el.scrollTop - el.clientHeight < 10) {
                  userScrolledUp.current = false;
                }
              }}
            >
              {isRecordingOrPaused ? (
                <>
                  {transcript ? (
                    <div className="space-y-2">
                      <div className="text-sm leading-relaxed whitespace-pre-wrap">
                        {displayTranscript}
                      </div>
                      {isPolishingState && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          <span>AI 潤飾中...</span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center justify-center h-full text-muted-foreground">
                      <p className="text-sm">即時轉錄中，每 5 秒更新...</p>
                    </div>
                  )}
                </>
              ) : transcript ? (
                <div className="space-y-2">
                  <div className="text-sm leading-relaxed whitespace-pre-wrap">
                    {displayTranscript}
                  </div>
                  {isPolishingState && (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      <span>AI 潤飾中...</span>
                    </div>
                  )}
                </div>
              ) : status === "transcribing" ? (
                <>
                  {transcript ? (
                    <div className="text-sm leading-relaxed whitespace-pre-wrap">{displayTranscript}</div>
                  ) : (
                    <div className="flex items-center justify-center h-full">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                  )}
                </>
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  <p className="text-sm">點擊上方按鈕開始錄音或上傳音檔</p>
                </div>
              )}
            </div>
          </div>
        </div>
        </Panel>

        <ResizeHandle className="w-1.5 bg-border hover:bg-primary/20 transition-colors" />

        {/* Right: Meeting Summary (top) + Deep Coach (bottom) */}
        <Panel defaultSize={50} minSize={20}>
        <div className="h-full flex flex-col">
          {/* Top: Meeting Summary */}
          <div className="h-1/2 flex flex-col border-b overflow-hidden resize-y" style={{ minHeight: 120 }}>
            <div className="flex items-center justify-between px-4 py-2 border-b shrink-0">
              <span className="text-sm font-medium text-muted-foreground">MEETING SUMMARY</span>
              <div className="flex items-center gap-1">
                {!summary && status !== "summarizing" && (
                  <Button onClick={() => callClaude("summarize")} size="icon" variant="ghost" className="h-5 w-5" disabled={!transcript || isBusy} title="產生摘要">
                    <Play className="h-3 w-3" />
                  </Button>
                )}
                {status === "summarizing" && (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                )}
                {summary && status !== "summarizing" && (
                  <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => handleCopy(summary)} title="複製">
                    <Copy className="h-3 w-3" />
                  </Button>
                )}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              {status === "summarizing" ? (
                <div className="flex items-center justify-center h-full">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : summary ? (
                <pre className="text-sm leading-relaxed whitespace-pre-wrap font-sans">{summary}</pre>
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  <p className="text-sm">{transcript ? "點擊上方按鈕開始產生摘要" : "點擊上方按鈕開始產生摘要"}</p>
                </div>
              )}
            </div>
          </div>

          {/* Bottom: Deep Coach */}
          <div className="flex-1 flex flex-col overflow-hidden min-h-0">
            <div className="flex items-center justify-between px-4 py-2 border-b shrink-0">
              <span className="text-sm font-medium text-muted-foreground">DEEP COACH</span>
              <div className="flex items-center gap-1">
                {!coach && status !== "coaching" && (
                  <Button onClick={() => callClaude("coach")} size="icon" variant="ghost" className="h-5 w-5" disabled={!transcript || isBusy} title="取得 AI 建議">
                    <Play className="h-3 w-3" />
                  </Button>
                )}
                {status === "coaching" && (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                )}
                {coach && status !== "coaching" && (
                  <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => handleCopy(coach)} title="複製">
                    <Copy className="h-3 w-3" />
                  </Button>
                )}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              {status === "coaching" ? (
                <div className="flex items-center justify-center h-full">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : coach ? (
                <pre className="text-sm leading-relaxed whitespace-pre-wrap font-sans">{coach}</pre>
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground text-center px-4">
                  <p className="text-sm">{transcript ? "點擊上方按鈕開始取得 AI 建議" : "點擊上方按鈕開始取得 AI 建議"}</p>
                </div>
              )}
            </div>
          </div>
        </div>
        </Panel>
        </PanelGroup>
      </main>

      {/* Bottom: audio player */}
      {audioUrl && (
        <footer className="flex items-center px-6 py-2 border-t bg-muted/50 shrink-0">
          <audio controls src={audioUrl} className="h-8 w-full" />
        </footer>
      )}
    </div>
  );
}
