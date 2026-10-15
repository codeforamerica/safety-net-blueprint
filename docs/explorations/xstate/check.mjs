// Runs the converted task machine in XState with stub implementations and a
// simulated clock, to check the timers behave as the contract intends.
//
// XState isn't a repo dependency, so install it without saving first:
//   npm install --no-save xstate@5
//   node docs/explorations/xstate/check.mjs
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createMachine, createActor, assign, raise, SimulatedClock } from 'xstate';

const dir = dirname(fileURLToPath(import.meta.url));
const json = JSON.parse(readFileSync(`${dir}/workflow-task.machine.json`, 'utf8'));
const DAY = 86_400_000, HOUR = 3_600_000;

const conditions = {
  taskIsUnassigned: ({ object }) => object.assignedToId == null,
  callerIsAssignedWorker: ({ object, caller }) => object.assignedToId === caller.id,
  callerIsSupervisor: ({ caller }) => caller.roles.includes('supervisor'),
  callerIsSystem: ({ caller }) => caller.roles.includes('system'),
};
const SYSTEM = { id: 'system', roles: ['system'] };
const passes = (cond, env) => (typeof cond === 'string' ? conditions[cond](env) : cond.any.some((c) => passes(c, env)));

function resolve(value, { context, event, clock }) {
  if (value === '$now') return new Date(clock.now()).toISOString();
  if (value === '$caller.id') return event.caller.id;
  if (typeof value === 'string' && value.startsWith('$request.')) return event.request?.[value.slice(9)];
  return value;
}

function machineFor(clock) {
  const log = [];
  const iso = (d) => Math.max(0, Date.parse(d) - clock.now());
  return {
    log,
    machine: createMachine({ ...json, context: { object: { id: 't1', assignedToId: null } } }, {
      guards: {
        authorized: ({ context, event }, { any }) => {
          const caller = event.caller ?? SYSTEM; // raised internally
          return any.some((clause) => (!clause.actors || clause.actors.some((r) => caller.roles.includes(r)))
            && (clause.conditions ?? []).every((c) => passes(c, { object: context.object, caller })));
        },
        condition: ({ context, event }) =>
          event.data.changes.some((c) => c.field === 'slaDeadline') && context.object.slaDeadline != null,
      },
      actions: {
        set: assign(({ context, event }, { field, value }) => ({
          object: { ...context.object, [field]: resolve(value, { context, event, clock }) },
        })),
        emit: (_, params) => log.push(`emit ${params.type}${params.data?.reason ? ` (${resolve(params.data.reason, { event: _.event, clock })})` : ''}`),
        call: (_, { procedure }) => log.push(`call ${procedure}`),
        request: (_, { method, path }) => log.push(`${method} ${path}`),
        if: ({ event }, { condition, then: t, else: e }) => {
          // Only sla-escalate's breach check matters here.
          if (condition.includes('sla_deadline_exceeded')) {
            const branch = event.request?.reason === 'sla_deadline_exceeded' ? t : e;
            branch.filter((a) => a.type === 'emit').forEach((a) => log.push(`emit ${a.params.type} (${event.request.reason})`));
          }
        },
        raise: raise((_, { event }) => event),
      },
      delays: {
        creationDeadline: 72 * HOUR, // business hours, approximated
        clientTimeout: 30 * DAY,
        verificationTimeout: 7 * DAY,
        slaWarning: ({ context }) => iso(context.object.slaDeadline) - 48 * HOUR,
        slaBreach: ({ context }) => iso(context.object.slaDeadline),
      },
    }),
  };
}

function start() {
  const clock = new SimulatedClock();
  const { machine, log } = machineFor(clock);
  const actor = createActor(machine, { clock }).start();
  const status = () => actor.getSnapshot().value.status;
  const send = (type, caller, extra = {}) => actor.send({ type, caller, ...extra });
  const advance = (ms) => clock.increment(ms);
  return { actor, clock, log, status, send, advance };
}

const worker = { id: 'w1', roles: ['case_worker'] };
const other = { id: 'w2', roles: ['case_worker'] };
const results = [];
const check = (name, fn) => { fn(); results.push(`ok  ${name}`); };

check('created: entry routes and prioritizes', () => {
  const t = start();
  assert.equal(t.status(), 'pending');
  assert.deepEqual(t.log, ['call assignToQueue', 'call setPriority']);
});

check('guards: only the assigned worker can complete', () => {
  const t = start();
  t.send('claim', worker);
  assert.equal(t.status(), 'in_progress');
  t.send('complete', other, { request: { outcome: 'x' } });
  assert.equal(t.status(), 'in_progress');
  t.send('complete', worker, { request: { outcome: 'x' } });
  assert.equal(t.status(), 'completed');
});

check('client timeout: cancels after 30 days', () => {
  const t = start();
  t.send('claim', worker);
  t.send('await-client', worker);
  t.advance(29 * DAY);
  assert.equal(t.status(), 'awaiting_client');
  t.advance(2 * DAY);
  assert.equal(t.status(), 'cancelled');
  assert.ok(t.actor.getSnapshot().context.object.cancelledAt);
  assert.ok(t.log.includes('emit workflow.task.cancelled (client_unresponsive)'));
});

check('client timeout: resuming cancels the timer with no cancel step', () => {
  const t = start();
  t.send('claim', worker);
  t.send('await-client', worker);
  t.advance(10 * DAY);
  t.send('resume', worker);
  t.advance(25 * DAY);
  assert.notEqual(t.status(), 'cancelled');
});

check('verification timeout: resumes after 7 days', () => {
  const t = start();
  t.send('claim', worker);
  t.send('await-verification', worker);
  t.advance(7 * DAY + 1);
  assert.equal(t.status(), 'in_progress');
});

check('creation deadline: escalates an unclaimed task after 72 hours', () => {
  const t = start();
  t.advance(72 * HOUR + 1);
  assert.equal(t.status(), 'escalated');
});

check('creation deadline: also escalates a claimed task (as the contract does)', () => {
  const t = start();
  t.send('claim', worker);
  t.advance(72 * HOUR + 1);
  assert.equal(t.status(), 'escalated');
});

check('SLA: warning then breach follow the deadline once it is set', () => {
  const t = start();
  t.send('claim', worker);
  t.send('await-client', worker); // out of reach of the creation deadline
  t.send('resume', worker);
  t.actor.getSnapshot().context.object.slaDeadline = new Date(t.clock.now() + 10 * DAY).toISOString();
  t.actor.send({ type: 'workflow.task.updated', data: { changes: [{ field: 'slaDeadline' }] } });
  t.log.length = 0;
  t.advance(8 * DAY - HOUR);
  assert.ok(!t.log.some((l) => l.includes('sla_deadline_approaching')));
  t.advance(2 * HOUR);
  assert.ok(t.log.includes('emit workflow.task.escalated (sla_deadline_approaching)'), t.log.join('\n'));
  t.advance(2 * DAY);
  assert.ok(t.log.includes('emit workflow.task.sla_breached (sla_deadline_exceeded)'), t.log.join('\n'));
});

check('SLA: moving the deadline restarts the timers', () => {
  const t = start();
  t.actor.getSnapshot().context.object.slaDeadline = new Date(t.clock.now() + 2 * DAY + HOUR).toISOString();
  t.actor.send({ type: 'workflow.task.updated', data: { changes: [{ field: 'slaDeadline' }] } });
  t.actor.getSnapshot().context.object.slaDeadline = new Date(t.clock.now() + 20 * DAY).toISOString();
  t.actor.send({ type: 'workflow.task.updated', data: { changes: [{ field: 'slaDeadline' }] } });
  t.log.length = 0;
  t.advance(2 * HOUR);
  assert.ok(!t.log.some((l) => l.includes('sla_deadline_approaching')), t.log.join('\n'));
});

check('SLA: a warning while waiting on the client is ignored', () => {
  const t = start();
  t.send('claim', worker);
  t.send('await-client', worker);
  t.actor.getSnapshot().context.object.slaDeadline = new Date(t.clock.now() + 2 * DAY + HOUR).toISOString();
  t.actor.send({ type: 'workflow.task.updated', data: { changes: [{ field: 'slaDeadline' }] } });
  t.advance(2 * HOUR);
  assert.equal(t.status(), 'awaiting_client');
});

console.log(results.join('\n'));
