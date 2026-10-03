# pi-turn-timer

[![pi releases tested](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/keen99/pi-turn-timer/main/latest-tested.json)](https://github.com/keen99/pi-turn-timer/actions/workflows/release-watch.yml)

Pi extension that shows elapsed turn time live in the footer and notifies the
duration when a turn ends.

- **Live footer status**: `⏱ 12s` → `⏱ 1m05s` → `⏱ 2h15m`, updated every second
  while the agent is working.
- **End-of-turn toast**: `Turn: 1m23s` via `ctx.ui.notify`.
- **Footer persists final duration** until the next turn starts.

Zero config. Uses the same `ctx.ui.setStatus` footer channel as PiRelay status
lines, so it composes with the forked/custom footer.

## Install

```
pi install git:github.com/keen99/pi-turn-timer
```

## How it works

Hooks `before_agent_start` to start a 1s `setInterval` that writes the elapsed
duration to footer status key `turn-timer`. On `agent_end` the interval is
cleared, the final duration stays in the footer, and a toast notifies the total.
`session_shutdown` cleans up the interval and clears the status.
