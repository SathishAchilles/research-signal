"use client";

import { PauseIcon, PlayIcon, SquareIcon, Volume2Icon } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";

type Segment = { id: string; label: string; text: string };
type Status = "idle" | "playing" | "paused";

const RATES = [0.8, 1, 1.25, 1.5] as const;
const PREFS_KEY = "rs-listen";
const CHUNK_MAX = 200; // Chrome drops utterances that run past ~15s; short chunks keep it reading.
const LANG_ORDER = ["en-in", "en-gb", "en-us"];
const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

const chip =
  "glass-chip glass-interactive inline-flex h-7 items-center gap-1.5 px-3 text-[0.8rem] font-medium hover:text-foreground disabled:opacity-50";
const field =
  "h-7 rounded-full border border-chip-border bg-transparent px-2 text-[0.8rem] text-foreground focus-visible:outline-3 focus-visible:outline-solid focus-visible:outline-focus [&>option]:bg-plate-solid";

// --- support and voices, read through useSyncExternalStore so SSR renders nothing ---------------

const noopSubscribe = () => () => {};
const supported = () => typeof window !== "undefined" && Boolean(window.speechSynthesis) && typeof window.SpeechSynthesisUtterance === "function";

let voiceCache: SpeechSynthesisVoice[] = [];
let voiceKey = "";
const EMPTY_VOICES: SpeechSynthesisVoice[] = [];
function voicesSnapshot(): SpeechSynthesisVoice[] {
  if (!supported()) return EMPTY_VOICES;
  const all = window.speechSynthesis.getVoices();
  const key = all.map((v) => v.voiceURI).join("|");
  if (key !== voiceKey) {
    voiceKey = key;
    voiceCache = all.filter((v) => v.lang.toLowerCase().startsWith("en"));
  }
  return voiceCache;
}
function subscribeVoices(onChange: () => void) {
  if (!supported()) return () => {};
  window.speechSynthesis.addEventListener("voiceschanged", onChange);
  return () => window.speechSynthesis.removeEventListener("voiceschanged", onChange);
}

function preferredVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  for (const lang of LANG_ORDER) {
    const matches = voices.filter((v) => v.lang.toLowerCase().replace("_", "-").startsWith(lang));
    if (matches.length) return matches.find((v) => v.localService) ?? matches[0];
  }
  return voices[0] ?? null;
}

// --- prefs (per viewer; storage can be missing or throw) -----------------------------------------

type Prefs = { rate: number; voiceURI: string | null };
function readPrefs(): Prefs {
  const fallback: Prefs = { rate: 1, voiceURI: null };
  if (typeof window === "undefined") return fallback;
  try {
    const raw = JSON.parse(window.localStorage.getItem(PREFS_KEY) ?? "null") as Partial<Prefs> | null;
    const rate = raw?.rate;
    return {
      rate: typeof rate === "number" && (RATES as readonly number[]).includes(rate) ? rate : 1,
      voiceURI: typeof raw?.voiceURI === "string" ? raw.voiceURI : null,
    };
  } catch {
    return fallback;
  }
}
function writePrefs(prefs: Prefs) {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // private window or blocked storage: the choice just isn't remembered
  }
}

// --- text chunking: sentence boundaries first, then commas, then words ---------------------------

function splitLong(sentence: string, max: number): string[] {
  const out: string[] = [];
  let rest = sentence;
  while (rest.length > max) {
    const window_ = rest.slice(0, max + 1);
    let cut = Math.max(window_.lastIndexOf(", "), window_.lastIndexOf("; "), window_.lastIndexOf(": "));
    if (cut < max / 3) cut = window_.lastIndexOf(" ");
    if (cut < 1) cut = max;
    out.push(rest.slice(0, cut + 1).trim());
    rest = rest.slice(cut + 1).trim();
  }
  if (rest) out.push(rest);
  return out;
}

function chunkText(text: string, max = CHUNK_MAX): string[] {
  const parts = text.match(/[^.!?]+(?:[.!?]+["')\]]*|$)\s*/g) ?? [text];
  const chunks: string[] = [];
  let current = "";
  for (const raw of parts) {
    const s = raw.trim();
    if (!s) continue;
    if (s.length > max) {
      if (current) chunks.push(current);
      current = "";
      chunks.push(...splitLong(s, max));
      continue;
    }
    if (current && current.length + 1 + s.length > max) {
      chunks.push(current);
      current = s;
    } else {
      current = current ? `${current} ${s}` : s;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

// --- highlighting --------------------------------------------------------------------------------

// A card can render twice (Top 3 strip and its domain); the last copy is the one in reading order.
function segmentElement(id: string): HTMLElement | null {
  const all = document.querySelectorAll<HTMLElement>(`#${CSS.escape(id)}`);
  return all.length ? all[all.length - 1] : null;
}
function clearHighlight() {
  document.querySelectorAll("[data-reading]").forEach((el) => el.removeAttribute("data-reading"));
}
function highlight(id: string) {
  clearHighlight();
  const el = segmentElement(id);
  if (!el) return;
  el.setAttribute("data-reading", "");
  const reduce = window.matchMedia(REDUCED_MOTION).matches;
  el.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
}

const fmtRate = (r: number) => `${r}×`;

export default function ReadAloud({ title, segments, className }: { title: string; segments: Segment[]; className?: string }) {
  const isSupported = useSyncExternalStore(noopSubscribe, supported, () => false);
  const voices = useSyncExternalStore(subscribeVoices, voicesSnapshot, () => EMPTY_VOICES);
  const [prefs, setPrefs] = useState<Prefs>(readPrefs);
  const [status, setStatus] = useState<Status>("idle");
  const [index, setIndex] = useState(0);
  const [announcement, setAnnouncement] = useState("");
  // Each start bumps the run; callbacks from a cancelled run see a stale number and do nothing.
  const runRef = useRef(0);
  // Holding the live utterance stops Chrome and Safari from collecting it before onend fires.
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const statusId = useId();

  const voice = voices.find((v) => v.voiceURI === prefs.voiceURI) ?? preferredVoice(voices);
  const total = segments.length;

  const stop = useCallback((announce = true) => {
    runRef.current += 1;
    utteranceRef.current = null;
    if (supported()) {
      const synth = window.speechSynthesis;
      if (synth.paused) synth.resume();
      synth.cancel();
    }
    clearHighlight();
    setStatus("idle");
    if (announce) setAnnouncement("Stopped reading.");
  }, []);

  const start = useCallback(
    (from: number, rate: number, chosen: SpeechSynthesisVoice | null) => {
      if (!supported() || from >= segments.length) return;
      const synth = window.speechSynthesis;
      const run = ++runRef.current;
      if (synth.paused) synth.resume();
      synth.cancel();

      const speakSegment = (i: number) => {
        if (run !== runRef.current) return;
        if (i >= segments.length) {
          utteranceRef.current = null;
          clearHighlight();
          setStatus("idle");
          setIndex(0);
          setAnnouncement(`Finished reading ${title}.`);
          return;
        }
        const seg = segments[i];
        const chunks = chunkText(seg.text);
        setIndex(i);
        setStatus("playing");
        setAnnouncement(`Reading section ${i + 1} of ${segments.length}: ${seg.label}`);
        highlight(seg.id);

        const speakChunk = (c: number) => {
          if (run !== runRef.current) return;
          if (c >= chunks.length) return speakSegment(i + 1);
          const u = new SpeechSynthesisUtterance(chunks[c]);
          u.rate = rate;
          if (chosen) {
            u.voice = chosen;
            u.lang = chosen.lang;
          } else {
            u.lang = "en-GB";
          }
          u.onend = () => speakChunk(c + 1);
          u.onerror = (e) => {
            if (run !== runRef.current) return;
            if (e.error === "interrupted" || e.error === "canceled") return;
            speakChunk(c + 1); // skip a chunk the engine refused rather than stalling
          };
          utteranceRef.current = u;
          synth.speak(u);
        };
        speakChunk(0);
      };
      speakSegment(from);
    },
    [segments, title],
  );

  const pause = () => {
    window.speechSynthesis.pause();
    setStatus("paused");
    setAnnouncement("Paused.");
  };
  const resume = () => {
    window.speechSynthesis.resume();
    setStatus("playing");
    setAnnouncement(`Resumed section ${index + 1} of ${total}.`);
  };

  const changeRate = (rate: number) => {
    const next = { ...prefs, rate };
    setPrefs(next);
    writePrefs(next);
    if (status !== "idle") start(index, rate, voice); // restart the section at the new speed
  };
  const changeVoice = (uri: string) => {
    const next = { ...prefs, voiceURI: uri };
    setPrefs(next);
    writePrefs(next);
    const chosen = voices.find((v) => v.voiceURI === uri) ?? null;
    if (status !== "idle") start(index, prefs.rate, chosen);
  };

  // Stale speech from a previous page is cancelled on mount; leaving the page (route change,
  // unmount, tab close) cancels this one.
  useEffect(() => {
    if (!supported()) return;
    const synth = window.speechSynthesis;
    synth.cancel();
    const onHide = () => {
      runRef.current += 1;
      synth.cancel();
    };
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      runRef.current += 1;
      utteranceRef.current = null;
      if (synth.paused) synth.resume();
      synth.cancel();
      clearHighlight();
    };
  }, []);

  if (!isSupported || total === 0) return null;

  const active = status !== "idle";
  const current = segments[Math.min(index, total - 1)];

  return (
    <div
      role="group"
      aria-label={`Listen to ${title}`}
      aria-describedby={statusId}
      data-read-aloud={status}
      className={cn("flex flex-wrap items-center gap-2", className)}
      onKeyDown={(e) => {
        if (e.key === "Escape" && active) {
          e.stopPropagation();
          stop();
        }
      }}
    >
      <style>{`[data-reading]{outline:2px solid var(--signal);outline-offset:4px;border-radius:var(--plate-radius,12px);scroll-margin-block:8rem}`}</style>
      {!active ? (
        <button type="button" className={chip} onClick={() => start(0, prefs.rate, voice)} data-listen="play">
          <Volume2Icon aria-hidden className="size-3.5" />
          Listen
        </button>
      ) : (
        <>
          {status === "playing" ? (
            <button type="button" className={chip} onClick={pause} data-listen="pause" aria-label="Pause reading">
              <PauseIcon aria-hidden className="size-3.5" />
              Pause
            </button>
          ) : (
            <button type="button" className={chip} onClick={resume} data-listen="resume" aria-label="Resume reading">
              <PlayIcon aria-hidden className="size-3.5" />
              Resume
            </button>
          )}
          <button type="button" className={chip} onClick={() => stop()} data-listen="stop" aria-label="Stop reading">
            <SquareIcon aria-hidden className="size-3" />
            Stop
          </button>
        </>
      )}
      <label className="sr-only" htmlFor={`${statusId}-rate`}>
        Reading speed
      </label>
      <select
        id={`${statusId}-rate`}
        className={field}
        value={prefs.rate}
        onChange={(e) => changeRate(Number(e.target.value))}
        data-listen="rate"
      >
        {RATES.map((r) => (
          <option key={r} value={r}>
            {fmtRate(r)}
          </option>
        ))}
      </select>
      {voices.length > 1 ? (
        <>
          <label className="sr-only" htmlFor={`${statusId}-voice`}>
            Voice
          </label>
          <select
            id={`${statusId}-voice`}
            className={cn(field, "max-w-44 truncate")}
            value={voice?.voiceURI ?? ""}
            onChange={(e) => changeVoice(e.target.value)}
            data-listen="voice"
          >
            {voices.map((v) => (
              <option key={v.voiceURI} value={v.voiceURI}>
                {v.name} ({v.lang})
              </option>
            ))}
          </select>
        </>
      ) : null}
      {active ? (
        <span className="micro num" aria-hidden>
          Section {index + 1} of {total} — {current.label}
        </span>
      ) : null}
      <span id={statusId} role="status" aria-live="polite" className="sr-only">
        {announcement}
      </span>
    </div>
  );
}
