import type { ExtensionContext, ExtensionAPI } from "@earendil-works/pi-coding-agent";

const STATUS_KEY = "turn-timer";

let turnStart: number | undefined;
let interval: NodeJS.Timeout | undefined;
let latestCtx: ExtensionContext | undefined;

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
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

function tick(): void {
  if (!turnStart) return;
  setStatus(`⏱ ${formatDuration(Date.now() - turnStart)}`);
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
      clearInterval(interval);
      interval = undefined;
    }
    turnStart = Date.now();
    tick();
    interval = setInterval(tick, 1000);
  });

  pi.on("agent_end", (_event, ctx) => {
    latestCtx = ctx;
    if (interval) {
      clearInterval(interval);
      interval = undefined;
    }
    if (turnStart) {
      const elapsed = Date.now() - turnStart;
      const formatted = formatDuration(elapsed);
      // Keep final duration visible in footer, plus a toast.
      setStatus(`⏱ ${formatted}`);
      try {
        ctx?.ui?.notify(`Turn: ${formatted}`, "info");
      } catch {
        // ignore notify failures
      }
      turnStart = undefined;
    }
  });

  pi.on("session_shutdown", () => {
    if (interval) {
      clearInterval(interval);
      interval = undefined;
    }
    setStatus(undefined);
    turnStart = undefined;
  });
}
