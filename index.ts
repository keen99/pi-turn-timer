import type { ExtensionContext, ExtensionAPI } from "@earendil-works/pi-coding-agent";

const STATUS_KEY = "turn-timer";

let turnStart: number | undefined;
let lastTurnEnd: number | undefined;
let interval: NodeJS.Timeout | undefined;
let latestCtx: ExtensionContext | undefined;

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) return `${days}d${String(hours).padStart(2, "0")}h`;
  if (hours > 0) return `${hours}h${String(minutes).padStart(2, "0")}m`;
  if (minutes > 0) return `${minutes}m${String(seconds).padStart(2, "0")}s`;
  return `${seconds}s`;
}

function setStatus(text: string | undefined): void {
  if (!latestCtx) return;
  try {
    latestCtx.ui.setStatus(STATUS_KEY, text);
  } catch {
    // stale context — ignore
  }
}

function tickIntervalMs(ms: number): number {
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return 1000;       // seconds — 1s
  if (totalSeconds < 3600) return 5000;    // minutes — 5s
  return 60000;                            // hours+ — 60s
}

function scheduleNext(ms: number): void {
  if (interval) clearTimeout(interval);
  interval = setTimeout(() => {
    tick();
    const elapsed = turnStart ? Date.now() - turnStart : lastTurnEnd ? Date.now() - lastTurnEnd : 0;
    if (elapsed > 0) scheduleNext(elapsed);
  }, ms);
}

function tick(): void {
  if (turnStart) {
    // Active turn — show elapsed
    setStatus(`⏱ ${formatDuration(Date.now() - turnStart)}`);
    scheduleNext(tickIntervalMs(Date.now() - turnStart));
  } else if (lastTurnEnd) {
    // Idle — show time since last turn ended
    setStatus(`💤 ${formatDuration(Date.now() - lastTurnEnd)}`);
    scheduleNext(tickIntervalMs(Date.now() - lastTurnEnd));
  }
}

export default function turnTimerExtension(pi: ExtensionAPI): void {
  pi.on("session_start", (_event, ctx) => {
    latestCtx = ctx;
    // Clear any leftover status from a prior session.
    setStatus(undefined);
  });

  pi.on("before_agent_start", (_event, ctx) => {
    latestCtx = ctx;
    // Start fresh: clear stale timer from a previous turn.
    if (interval) {
      clearTimeout(interval);
      interval = undefined;
    }
    turnStart = Date.now();
    tick();
  });

  pi.on("agent_end", (_event, ctx) => {
    latestCtx = ctx;
    if (interval) {
      clearTimeout(interval);
      interval = undefined;
    }
    if (turnStart) {
      const elapsed = Date.now() - turnStart;
      const formatted = formatDuration(elapsed);
      lastTurnEnd = Date.now();
      // Keep final duration visible in footer, plus a toast.
      setStatus(`⏱ ${formatted}`);
      try {
        ctx?.ui?.notify(`Turn: ${formatted}`, "info");
      } catch {
        // ignore notify failures
      }
      turnStart = undefined;
      // Switch to idle timer after showing final turn duration briefly.
      setTimeout(() => {
        if (!turnStart && lastTurnEnd) {
          tick();
        }
      }, 3000);
    }
  });

  pi.on("session_shutdown", () => {
    if (interval) {
      clearTimeout(interval);
      interval = undefined;
    }
    setStatus(undefined);
    turnStart = undefined;
    lastTurnEnd = undefined;
  });
}
