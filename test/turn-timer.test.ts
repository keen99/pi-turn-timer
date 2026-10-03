import assert from "node:assert/strict";
import test from "node:test";

const { default: turnTimer } = await import("../index.js");

type Ctx = any;

function harness() {
	const statuses: Array<{ key: string; text: string | undefined }> = [];
	const notices: Array<{ text: string; level: string }> = [];
	const handlers = new Map<string, Array<(event: any, ctx: Ctx) => void>>();
	const ctx: Ctx = {
		ui: {
			setStatus: (key: string, text: string | undefined) => statuses.push({ key, text }),
			notify: (text: string, level = "info") => notices.push({ text, level }),
		},
	};
	const pi: any = {
		on: (event: string, fn: (event: any, ctx: Ctx) => void) => {
			if (!handlers.has(event)) handlers.set(event, []);
			handlers.get(event)!.push(fn);
		},
	};
	turnTimer(pi);
	const fire = (event: string, ctxArg: Ctx = ctx) => {
		for (const fn of handlers.get(event) ?? []) fn({}, ctxArg);
	};
	return { statuses, notices, fire };
}

// node's mocked Date starts at epoch 0; turnStart = 0 is falsy and flips
// tick() to the idle branch. Give the clock a real-feeling base.
const BASE = 1_700_000_000_000;

// Module-level singleton state leaks across tests. session_shutdown resets it.
function shutdown(t: ReturnType<typeof harness>) {
	t.fire("session_shutdown");
}

test("session_start clears leftover turn + idle status", () => {
	const t = harness();
	t.fire("session_start");
	assert.deepEqual(
		t.statuses.map((s) => [s.key, s.text]),
		[
			["za-turn-timer", undefined],
			["zb-idle-timer", undefined],
		],
	);
	shutdown(t);
});

test("before_agent_start starts live turn timer; ticks at 1s under a minute", (tt) => {
	const t = harness();
	tt.mock.timers.enable({ apis: ["setTimeout", "Date"] });
	tt.mock.timers.setTime(BASE);
	t.fire("session_start");
	t.fire("before_agent_start");
	assert.equal(t.statuses.at(-1)!.key, "za-turn-timer");
	assert.match(t.statuses.at(-1)!.text!, /^⏱ 0s$/);
	tt.mock.timers.tick(1000);
	assert.match(t.statuses.at(-1)!.text!, /^⏱ 1s$/);
	tt.mock.timers.tick(58000);
	assert.match(t.statuses.at(-1)!.text!, /^⏱ 59s$/);
	shutdown(t);
});

test("agent_end freezes duration, notifies, starts idle timer", (tt) => {
	const t = harness();
	tt.mock.timers.enable({ apis: ["setTimeout", "Date"] });
	tt.mock.timers.setTime(BASE);
	t.fire("session_start");
	t.fire("before_agent_start");
	tt.mock.timers.tick(4200);
	assert.match(t.statuses.at(-1)!.text!, /^⏱ 4s$/);
	t.fire("agent_end");
	// agent_end sets the frozen duration, then switches to the idle timer in
	// the same synchronous pass — the LAST entry is idle, not the turn one.
	const lastTurn = t.statuses.filter((s) => s.key === "za-turn-timer").at(-1);
	assert.match(lastTurn!.text!, /^⏱ 4s$/, "final duration frozen");
	assert.equal(t.notices.at(-1)!.text, "Turn: 4s");
	assert.equal(t.notices.at(-1)!.level, "info");
	const idleNow = t.statuses.filter((s) => s.key === "zb-idle-timer").at(-1);
	assert.match(idleNow!.text!, /^💤 0s$/, "idle timer starts immediately");
	tt.mock.timers.tick(1000);
	const idle = t.statuses.filter((s) => s.key === "zb-idle-timer").at(-1);
	assert.match(idle!.text!, /^💤 1s$/, `idle ticks: ${JSON.stringify(idle)}`);
	shutdown(t);
});

test("duration formatting crosses minute/hour/day boundaries", (tt) => {
	const t = harness();
	tt.mock.timers.enable({ apis: ["setTimeout", "Date"] });
	tt.mock.timers.setTime(BASE);
	t.fire("session_start");
	t.fire("before_agent_start");
	tt.mock.timers.tick(60_000);
	assert.match(t.statuses.at(-1)!.text!, /^⏱ 1m00s$/);
	// >=1h flips tick cadence to 60s; jump straight there
	tt.mock.timers.tick(3540_000);
	assert.match(t.statuses.at(-1)!.text!, /^⏱ 1h00m$/);
	tt.mock.timers.tick(82_800_000); // +23h -> 24h total
	assert.match(t.statuses.at(-1)!.text!, /^⏱ 1d00h$/);
	shutdown(t);
});

test("second turn resets timer instead of stacking", (tt) => {
	const t = harness();
	tt.mock.timers.enable({ apis: ["setTimeout", "Date"] });
	tt.mock.timers.setTime(BASE);
	t.fire("session_start");
	t.fire("before_agent_start");
	tt.mock.timers.tick(3000);
	t.fire("agent_end");
	t.fire("before_agent_start");
	assert.match(t.statuses.at(-1)!.text!, /^⏱ 0s$/, "new turn restarts at 0");
	tt.mock.timers.tick(2000);
	assert.match(t.statuses.at(-1)!.text!, /^⏱ 2s$/);
	shutdown(t);
});

test("session_shutdown clears everything and stops ticking", (tt) => {
	const t = harness();
	tt.mock.timers.enable({ apis: ["setTimeout", "Date"] });
	tt.mock.timers.setTime(BASE);
	t.fire("session_start");
	t.fire("before_agent_start");
	tt.mock.timers.tick(1000);
	t.fire("session_shutdown");
	const count = t.statuses.length;
	tt.mock.timers.tick(10_000);
	assert.equal(t.statuses.length, count, "no ticks after shutdown");
	assert.equal(
		t.statuses.filter((s) => s.key === "za-turn-timer").at(-1)!.text,
		undefined,
	);
});
