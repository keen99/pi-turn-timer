import type { ExtensionContext, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const STATUS_KEY = "za-turn-timer";
const IDLE_KEY = "zb-idle-timer";

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
  if (interval) {
    clearTimeout(interval);
    interval = undefined;
  }
  interval = setTimeout(() => {
    interval = undefined;
    tick();
  }, ms);
}

function setIdle(text: string | undefined): void {
  if (!latestCtx) return;
  try {
    latestCtx.ui.setStatus(IDLE_KEY, text);
  } catch {
    // stale context — ignore
  }
}

function tick(): void {
  if (turnStart) {
    setStatus(`⏱ ${formatDuration(Date.now() - turnStart)}`);
    scheduleNext(tickIntervalMs(Date.now() - turnStart));
  } else if (lastTurnEnd) {
    setIdle(`💤 ${formatDuration(Date.now() - lastTurnEnd)}`);
    scheduleNext(tickIntervalMs(Date.now() - lastTurnEnd));
  }
}

export default function turnTimerExtension(pi: ExtensionAPI): void {
  pi.on("session_start", (_event, ctx) => {
    latestCtx = ctx;
    // Clear any leftover status from a prior session.
    setStatus(undefined);
    setIdle(undefined);
    // Deep-smoke marker (release matrix): proves session_start ran and the
    // setStatus path works on the real session's ui object.
    if (process.env.TURN_TIMER_DEBUG === "1") {
      try {
        writeFileSync(
          join(getAgentDir(), "turn-timer-installed.json"),
          JSON.stringify({ installed: true }, null, 2) + "\n",
        );
      } catch {}
    }
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
      // Keep final duration visible in footer (frozen), start idle timer.
      setStatus(`⏱ ${formatted}`);
      try {
        ctx?.ui?.notify(`Turn: ${formatted}`, "info");
      } catch {
        // ignore notify failures
      }
      turnStart = undefined;
      // Switch to idle timer immediately.
      if (lastTurnEnd) tick();
    }
  });

  pi.on("session_shutdown", () => {
    if (interval) {
      clearTimeout(interval);
      interval = undefined;
    }
    setStatus(undefined);
    setIdle(undefined);
    turnStart = undefined;
    lastTurnEnd = undefined;
  });
}
