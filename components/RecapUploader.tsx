"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const MAX_BYTES = 48 * 1024 * 1024;
const EARLY_STOP_BYTES = 46 * 1024 * 1024;
const MAX_DURATION_MS = 2 * 60 * 1000;
const TARGET_VIDEO_BITRATE = 2_000_000;
const TARGET_AUDIO_BITRATE = 96_000;

type UploadStatus = "idle" | "uploading" | "success" | "error";
type RecorderState = "idle" | "requesting" | "recording" | "preview";

function pickRecorderMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;

  const candidates = [
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4",
    "video/webm;codecs=vp8,opus",
    "video/webm"
  ];

  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate));
}

function baseMimeType(value: string): string {
  return value.split(";")[0].trim().toLowerCase();
}

function extensionForMime(value: string): "mp4" | "webm" {
  return baseMimeType(value) === "video/webm" ? "webm" : "mp4";
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.min(Math.floor(ms / 1000), 120);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function RecapUploader({ token }: { token: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<UploadStatus>("idle");
  const [message, setMessage] = useState("");
  const [recorderState, setRecorderState] = useState<RecorderState>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [recordingNote, setRecordingNote] = useState("");

  const liveVideoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const chunkBytesRef = useRef(0);
  const recordingStartedAtRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const maxDurationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const supabase = useMemo(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    return url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
  }, []);

  function clearTimers() {
    if (timerRef.current) clearInterval(timerRef.current);
    if (maxDurationTimeoutRef.current) clearTimeout(maxDurationTimeoutRef.current);
    timerRef.current = null;
    maxDurationTimeoutRef.current = null;
  }

  function stopStream() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (liveVideoRef.current) liveVideoRef.current.srcObject = null;
  }

  function stopRecording() {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
  }

  useEffect(() => {
    return () => {
      clearTimers();
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") recorder.stop();
      stopStream();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
    // Only run this cleanup on unmount; preview URLs are explicitly revoked when replaced.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startRecording() {
    setStatus("idle");
    setMessage("");
    setRecordingNote("");
    setRecorderState("requesting");
    setFile(null);
    setElapsedMs(0);

    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }

    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        throw new Error("This browser does not support in-page recording. Use the file upload option below instead.");
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: {
          facingMode: "user",
          width: { ideal: 1280, max: 1280 },
          height: { ideal: 720, max: 720 },
          frameRate: { ideal: 30, max: 30 }
        }
      });
      streamRef.current = stream;

      const mimeType = pickRecorderMimeType();
      const options: MediaRecorderOptions = {
        videoBitsPerSecond: TARGET_VIDEO_BITRATE,
        audioBitsPerSecond: TARGET_AUDIO_BITRATE
      };
      if (mimeType) options.mimeType = mimeType;

      const recorder = new MediaRecorder(stream, options);
      recorderRef.current = recorder;
      chunksRef.current = [];
      chunkBytesRef.current = 0;

      recorder.ondataavailable = (event) => {
        if (!event.data.size) return;
        chunksRef.current.push(event.data);
        chunkBytesRef.current += event.data.size;

        if (chunkBytesRef.current >= EARLY_STOP_BYTES && recorder.state !== "inactive") {
          setRecordingNote("Recording stopped early to stay under the free storage file-size limit.");
          recorder.stop();
        }
      };

      recorder.onerror = () => {
        clearTimers();
        stopStream();
        setRecorderState("idle");
        setStatus("error");
        setMessage("The browser could not finish the recording. Please try again or use the file upload option.");
      };

      recorder.onstop = () => {
        clearTimers();
        const endedAt = Date.now();
        if (recordingStartedAtRef.current) setElapsedMs(Math.min(endedAt - recordingStartedAtRef.current, MAX_DURATION_MS));

        const contentType = baseMimeType(recorder.mimeType || chunksRef.current[0]?.type || "video/mp4");
        const safeContentType = contentType === "video/webm" ? "video/webm" : "video/mp4";
        const blob = new Blob(chunksRef.current, { type: safeContentType });
        stopStream();

        if (!blob.size) {
          setRecorderState("idle");
          setStatus("error");
          setMessage("No video was captured. Please try recording again.");
          return;
        }

        if (blob.size > MAX_BYTES) {
          setRecorderState("idle");
          setStatus("error");
          setMessage("The recording ended up larger than 48 MB. Please record again; the site will try to stop sooner.");
          return;
        }

        const ext = extensionForMime(safeContentType);
        const recordedFile = new File([blob], `fantasy-recap.${ext}`, { type: safeContentType, lastModified: Date.now() });
        setFile(recordedFile);
        const url = URL.createObjectURL(blob);
        setPreviewUrl(url);
        setRecorderState("preview");
      };

      recorder.start(1000);
      recordingStartedAtRef.current = Date.now();
      setRecorderState("recording");
      requestAnimationFrame(() => {
        if (liveVideoRef.current) liveVideoRef.current.srcObject = stream;
      });

      timerRef.current = setInterval(() => {
        if (recordingStartedAtRef.current) {
          setElapsedMs(Math.min(Date.now() - recordingStartedAtRef.current, MAX_DURATION_MS));
        }
      }, 250);

      maxDurationTimeoutRef.current = setTimeout(() => {
        setElapsedMs(MAX_DURATION_MS);
        if (recorder.state !== "inactive") recorder.stop();
      }, MAX_DURATION_MS);
    } catch (error) {
      clearTimers();
      stopStream();
      setRecorderState("idle");
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Could not access the camera and microphone.");
    }
  }

  function resetRecording() {
    clearTimers();
    stopRecording();
    stopStream();
    recorderRef.current = null;
    chunksRef.current = [];
    chunkBytesRef.current = 0;
    recordingStartedAtRef.current = null;
    setFile(null);
    setElapsedMs(0);
    setRecorderState("idle");
    setRecordingNote("");
    setStatus("idle");
    setMessage("");
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
  }

  async function submitFile(fileToUpload: File) {
    if (!supabase) {
      setStatus("error");
      setMessage("Video uploads are not configured yet.");
      return;
    }
    if (fileToUpload.size > MAX_BYTES) {
      setStatus("error");
      setMessage("Please use a video that is 48 MB or smaller, or record the recap directly on this page.");
      return;
    }

    const contentType = baseMimeType(fileToUpload.type);
    if (!["video/mp4", "video/quicktime", "video/webm"].includes(contentType)) {
      setStatus("error");
      setMessage("Please use an MP4, MOV, or WebM video.");
      return;
    }

    setStatus("uploading");
    setMessage("Preparing secure upload…");

    try {
      const intentResponse = await fetch("/api/recap/upload-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, contentType, size: fileToUpload.size })
      });
      const intent = await intentResponse.json();
      if (!intentResponse.ok) throw new Error(intent.error ?? "Could not prepare upload.");

      setMessage("Uploading video… keep this page open.");
      const { error: uploadError } = await supabase.storage
        .from("recap-videos")
        .uploadToSignedUrl(intent.path, intent.token, fileToUpload, { contentType });
      if (uploadError) throw uploadError;

      setMessage("Saving recap…");
      const finalizeResponse = await fetch("/api/recap/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          path: intent.path,
          originalFilename: fileToUpload.name,
          size: fileToUpload.size,
          contentType
        })
      });
      const finalized = await finalizeResponse.json();
      if (!finalizeResponse.ok) throw new Error(finalized.error ?? "Could not finish upload.");

      setStatus("success");
      setMessage("Recap submitted. Your obligation has been marked complete.");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Upload failed. Please try again.");
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (file) await submitFile(file);
  }

  if (status === "success") {
    return (
      <div className="upload-success">
        <span className="eyebrow">SUBMITTED</span>
        <h2>Recap received.</h2>
        <p>{message}</p>
        <a className="button primary inline-button" href="/recaps">View the recap archive</a>
      </div>
    );
  }

  return (
    <form className="upload-form" onSubmit={submit}>
      <div className="recorder-panel">
        <div className="recorder-heading">
          <div>
            <span className="eyebrow">RECOMMENDED</span>
            <h2>Record your recap here</h2>
          </div>
          <span className="recording-limit">2:00 max</span>
        </div>
        <p className="helper-text">The site requests 720p/30 fps and a lower bitrate so a two-minute talking-head recap stays within the league's free storage limit.</p>

        {recorderState === "idle" || recorderState === "requesting" ? (
          <button className="button primary" type="button" onClick={startRecording} disabled={recorderState === "requesting" || status === "uploading"}>
            {recorderState === "requesting" ? "Opening camera…" : "Record recap"}
          </button>
        ) : null}

        {recorderState === "recording" ? (
          <div className="recorder-stage">
            <video ref={liveVideoRef} className="live-recap-video" autoPlay muted playsInline />
            <div className="recorder-controls">
              <span className="recording-indicator"><span className="recording-dot" />REC {formatDuration(elapsedMs)} / 2:00</span>
              <button className="button" type="button" onClick={stopRecording}>Stop recording</button>
            </div>
          </div>
        ) : null}

        {recorderState === "preview" && previewUrl && file ? (
          <div className="recorder-stage">
            <video className="recorded-recap-preview" src={previewUrl} controls playsInline preload="metadata" />
            <div className="recorder-controls preview-controls">
              <span>{formatDuration(elapsedMs)} · {(file.size / 1024 / 1024).toFixed(1)} MB</span>
              <button className="button" type="button" onClick={resetRecording} disabled={status === "uploading"}>Re-record</button>
            </div>
          </div>
        ) : null}

        {recordingNote ? <p className="helper-text recording-note">{recordingNote}</p> : null}
      </div>

      <div className="upload-divider"><span>or upload an existing compressed video</span></div>

      <label>
        Existing recap video
        <input
          type="file"
          accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm"
          disabled={status === "uploading" || recorderState === "recording" || recorderState === "requesting"}
          onChange={(event) => {
            const selected = event.target.files?.[0] ?? null;
            if (previewUrl) {
              URL.revokeObjectURL(previewUrl);
              setPreviewUrl(null);
            }
            setRecorderState("idle");
            setFile(selected);
            setStatus("idle");
            setMessage("");
            setRecordingNote("");
          }}
        />
      </label>
      <p className="helper-text">MP4, MOV, or WebM · maximum 48 MB for existing files</p>
      {file && recorderState !== "preview" ? <p className="selected-file">Selected: {file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB</p> : null}
      {message ? <div className={`notice ${status === "error" ? "error" : "success"}`}>{message}</div> : null}
      <button className="button primary submit-recap-button" type="submit" disabled={!file || status === "uploading" || recorderState === "recording" || recorderState === "requesting"}>
        {status === "uploading" ? "Uploading…" : "Submit recap"}
      </button>
    </form>
  );
}
