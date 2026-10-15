// Converts workflow's Task state machine to XState v5 JSON, for the spike on
// whether the contracts could use, extend, or export to XState's format.
//
//   node docs/explorations/xstate/convert.mjs
//
// Writes two machines next to this file:
//   workflow-task.machine.json    one actor per task
//   workflow-domain.machine.json  subscriptions that need no existing task
//
// Everything mechanical is derived from the contract. Timers aren't: the
// contract sets and cancels them in steps, so where each one lives in the
// XState machine is decided below in TIMERS.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const here = dirname(fileURLToPath(import.meta.url));
const domains = join(here, '../../../packages/safety-net-contracts/src/domains');
const contract = parse(readFileSync(join(domains, 'workflow/workflow-state-machine.yaml'), 'utf8'));
const platform = parse(readFileSync(join(domains, 'platform/platform-state-machine.yaml'), 'utf8'));
const machine = contract.machines[0];

// Procedures and steps that only exist to set, cancel, or receive timers.
// XState's `after` replaces all of them.
const TIMER_PROCEDURES = new Set([
  'scheduleTimer', 'cancelWorkflowTimer', 'scheduleCreationDeadline', 'scheduleClientTimeout',
  'scheduleVerificationTimeout', 'scheduleSlaWarning', 'scheduleSlaBreachTimer',
  'cancelClientTimeout', 'cancelVerificationTimeout',
]);
const TIMER_CALLBACKS = new Set(machine.timers.map((t) => `workflow.${t.id}`));
// auto-cancel exists only as the client timeout's callback target, so the
// timer transition takes over its steps and the action goes away.
const DROPPED_ACTIONS = new Set(['auto-cancel']);

// Delays are implementations in XState (code, not JSON); `meta.delays` keeps
// what the contract says about each one so an interpreter can build them.
const DELAYS = {
  creationDeadline: { after: 'PT72H', calendar: 'business' },
  clientTimeout: { after: 'P30D', calendar: 'calendar' },
  verificationTimeout: { after: 'P7D', calendar: 'calendar' },
  slaWarning: { at: 'object.slaDeadline', offset: '-PT48H', calendar: 'calendar' },
  slaBreach: { at: 'object.slaDeadline', calendar: 'calendar' },
};

// ── Steps → actions ────────────────────────────────────────────────────────
// XState's JSON can only name an action and pass it params. Its built-ins
// (assign, raise, emit, enqueueActions) are functions, so none of them can be
// written in JSON; every step becomes a named action an interpreter supplies.

function toActions(steps = []) {
  return steps
    .filter((s) => !(typeof s.call === 'string' && TIMER_PROCEDURES.has(s.call)))
    .map(toAction)
    // An `if` whose steps were all timer steps has nothing left to do.
    .filter((a) => a.type !== 'if' || a.params.then.length || a.params.else?.length);
}

function toAction(step) {
  if (step.set) return { type: 'set', params: step.set };
  if (step.emit) return { type: 'emit', params: step.emit };
  if (step.if) {
    return {
      type: 'if',
      params: {
        condition: step.if,
        then: toActions(step.then),
        ...(step.else && { else: toActions(step.else) }),
      },
    };
  }
  if (typeof step.call === 'string') {
    return { type: 'call', params: { procedure: step.call, ...(step.with && { with: step.with }) } };
  }
  if (step.call) {
    const { description, body, ...rest } = step.call;
    const [method, path] = Object.entries(rest)[0];
    return { type: 'request', params: { method, path, ...(body && { body }), ...(description && { description }) } };
  }
  throw new Error(`Unhandled step: ${JSON.stringify(step)}`);
}

// ── Actions → transitions ──────────────────────────────────────────────────

const asList = (v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

// The contract ORs guard clauses; each clause ANDs actors and conditions.
// XState's JSON has no and/or/not (those are functions too), so the whole
// list goes to one named guard.
const toGuard = (guards) => guards && { type: 'authorized', params: { any: guards } };

function toTransition(action, overrides = {}) {
  const meta = {
    endpoint: `POST /tasks/{taskId}/${action.id}`,
    ...(action.schema?.request && { request: action.schema.request }),
  };
  const actions = toActions(action.steps);
  return {
    ...(action.transition?.to && { target: action.transition.to }),
    ...(action.guards && { guard: toGuard(action.guards) }),
    ...(actions.length && { actions }),
    description: action.description.replace(/^POST \S+ — /, ''),
    meta,
    ...overrides,
  };
}

const states = Object.fromEntries(machine.states.map(({ id, description, ...meta }) => [
  id, { description, meta, on: {} },
]));

for (const action of machine.actions) {
  if (DROPPED_ACTIONS.has(action.id)) continue;
  for (const from of asList(action.transition?.from)) {
    states[from].on[action.id] = toTransition(action);
  }
}

// ── Timers ─────────────────────────────────────────────────────────────────
// A state's `after` starts its timer on entry and cancels it on exit.

const step = (machineActionId) => machine.actions.find((a) => a.id === machineActionId).steps;

// Waiting on the client: 30 days, then cancel. Leaving the state any other
// way (resume) cancels the timer, so no step has to.
states.awaiting_client.after = {
  clientTimeout: {
    target: 'cancelled',
    actions: toActions(step('auto-cancel')),
    description: 'Cancel after 30 calendar days without a response from the client',
  },
};

// Waiting on verification: 7 days, then resume. auto-resume stays as an
// action, because a verification result can also trigger it.
states.awaiting_verification.after = {
  verificationTimeout: {
    target: 'in_progress',
    actions: toActions(step('auto-resume')).filter((a) => a.type !== 'emit').concat({
      type: 'emit',
      params: { type: 'workflow.task.resumed', description: 'Emit a domain event recording the automated resumption' },
    }),
    description: 'Resume after 7 calendar days waiting on a verification result',
  },
};

// The creation deadline and SLA timers aren't tied to one status, so they run
// in their own regions beside it. When one fires, it raises sla-escalate,
// which only pending, in_progress and escalated accept, the same states the
// contract's sla-escalate allows. In any other status the event is ignored,
// which is what the contract's rejected callback amounts to today.
const raiseSlaEscalate = (reason) => ({ type: 'raise', params: { event: { type: 'sla-escalate', request: { reason } } } });

const slaDeadlineChanged = {
  type: 'condition',
  params: { condition: 'event.data.changes.exists(c, c.field == "slaDeadline") && object.slaDeadline != null' },
};

const deadlines = {
  type: 'parallel',
  description: 'Deadlines that run across statuses',
  states: {
    creation: {
      initial: 'running',
      states: {
        running: {
          after: {
            creationDeadline: {
              target: 'passed',
              actions: [raiseSlaEscalate('deadline_exceeded')],
              description: 'Escalate 72 business hours after creation',
            },
          },
        },
        passed: {},
      },
    },
    sla: {
      initial: 'unset',
      // XState computes a delay once, on entry. Re-entering `tracking` when
      // the deadline changes is how the timers follow it.
      on: {
        'workflow.task.updated': {
          guard: slaDeadlineChanged,
          target: '.tracking',
          reenter: true,
          description: 'Restart the SLA timers when the SLA deadline is set or changes',
        },
      },
      states: {
        unset: {},
        tracking: {
          after: {
            slaWarning: {
              target: 'warned',
              actions: [raiseSlaEscalate('sla_deadline_approaching')],
              description: 'Escalate 48 hours before the SLA deadline',
            },
          },
        },
        warned: {
          after: {
            slaBreach: {
              target: 'breached',
              actions: [raiseSlaEscalate('sla_deadline_exceeded')],
              description: 'Escalate and record the breach at the SLA deadline',
            },
          },
        },
        breached: {},
      },
    },
  },
};

// ── Subscriptions ──────────────────────────────────────────────────────────
// A subscription with `transition` needs an existing task; it belongs to the
// task actor. One without it creates or finds tasks, so no task actor can
// receive it; those go to a separate domain machine.

const instanceEvents = machine.events.filter((e) => e.transition && !TIMER_CALLBACKS.has(e.type));
const domainEvents = machine.events.filter((e) => !e.transition && !TIMER_CALLBACKS.has(e.type));

const created = instanceEvents.find((e) => e.type === 'workflow.task.created');
const updated = instanceEvents.find((e) => e.type === 'workflow.task.updated');
const unmapped = instanceEvents.filter((e) => e !== created && e !== updated);
if (unmapped.length) throw new Error(`Unmapped subscriptions: ${unmapped.map((e) => e.type)}`);

const contextOf = (e) => e.context && { context: e.context };

const task = {
  id: 'task',
  type: 'parallel',
  description: 'A workflow task. One actor per stored task; `status` is the task\'s status field.',
  // A task actor starts when the task is created, so the created
  // subscription becomes the machine's entry actions.
  entry: toActions(created.steps),
  states: {
    status: {
      initial: machine.initialState,
      on: {
        'workflow.task.updated': {
          actions: toActions(updated.steps),
          description: updated.description,
        },
      },
      states,
    },
    deadlines,
  },
  meta: {
    object: machine.object,
    domain: contract.domain,
    apiSpec: contract.apiSpec,
    eventsSpec: contract.eventsSpec,
    // Named in guards; XState expects these as code.
    conditions: Object.fromEntries([...platform.guards, ...contract.guards].map((g) => [g.id, g.condition])),
    procedures: Object.fromEntries(contract.procedures
      .filter((p) => !TIMER_PROCEDURES.has(p.id))
      .map(({ id, ...p }) => [id, { ...p, ...(p.then && { then: toActions(p.then) }), ...(p.else && { else: toActions(p.else) }) }])),
    delays: DELAYS,
    schemas: `${contract.apiSpec.replace('-openapi.yaml', '-state-machine.yaml')}#/$defs`,
  },
};

const domain = {
  id: 'workflow',
  description: 'Workflow\'s subscriptions that create or find tasks rather than act on one.',
  initial: 'listening',
  states: {
    listening: {
      on: Object.fromEntries(domainEvents.map((e) => [e.type, {
        actions: toActions(e.steps),
        description: e.description,
        ...(e.context && { meta: contextOf(e) }),
      }])),
    },
  },
};

writeFileSync(join(here, 'workflow-task.machine.json'), `${JSON.stringify(task, null, 2)}\n`);
writeFileSync(join(here, 'workflow-domain.machine.json'), `${JSON.stringify(domain, null, 2)}\n`);
console.log('Wrote workflow-task.machine.json and workflow-domain.machine.json');
