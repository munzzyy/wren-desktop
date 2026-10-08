// Copyright 2026 Cole Munz
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';

import {
  BLOCKED_RETRY,
  OPEN_RECHECK,
  runProxyGate,
} from '../../../wren/proxy/libsignalGate.std.ts';

const URL = 'socks5h://wren:x@127.0.0.1:9050';

function setup(answers: {
  check: Array<boolean | Error>;
  probe: Array<boolean | Error>;
  badUrl?: boolean;
}) {
  const calls: Array<string> = [];
  const delays: Array<number> = [];
  const changes: Array<boolean> = [];
  let pending: (() => void) | undefined;

  const answer = async (list: Array<boolean | Error>): Promise<boolean> => {
    const next = list.shift();
    if (next instanceof Error) {
      throw next;
    }
    return next ?? false;
  };

  runProxyGate({
    net: {
      setInvalidProxy: () => calls.push('invalid'),
      setProxyFromUrl: url => {
        if (answers.badUrl) {
          throw new Error('bad url');
        }
        calls.push(`proxy ${url}`);
      },
    },
    proxyUrl: URL,
    check: () => answer(answers.check),
    probe: () => answer(answers.probe),
    schedule: (fn, ms) => {
      delays.push(ms);
      pending = fn;
    },
    onChange: open => changes.push(open),
  });

  const step = async () => {
    // Let the tick that is in flight finish and schedule the next one.
    await new Promise(resolve => setTimeout(resolve, 0));
    const fn = pending;
    pending = undefined;
    fn?.();
    await new Promise(resolve => setTimeout(resolve, 0));
  };

  return { calls, delays, changes, step };
}

describe('wren/proxy/libsignalGate', () => {
  it('blocks libsignal before anything else happens', () => {
    const { calls, changes } = setup({ check: [], probe: [] });
    assert.deepEqual(calls, ['invalid']);
    assert.deepEqual(changes, [false]);
  });

  it('stays blocked while the proxy cannot reach Signal', async () => {
    const gate = setup({ check: [false, false], probe: [] });
    await gate.step();
    await gate.step();
    assert.deepEqual(gate.calls, ['invalid']);
    assert.deepEqual(gate.delays.slice(0, 2), [BLOCKED_RETRY, BLOCKED_RETRY]);
  });

  it('opens once a request through the proxy reached Signal', async () => {
    const gate = setup({ check: [false, true], probe: [true] });
    await gate.step();
    await gate.step();
    assert.deepEqual(gate.calls, ['invalid', `proxy ${URL}`]);
    assert.deepEqual(gate.changes, [false, true]);
    assert.strictEqual(gate.delays.at(-1), OPEN_RECHECK);
  });

  it('blocks again as soon as the proxy stops answering', async () => {
    const gate = setup({ check: [true], probe: [true, false] });
    await gate.step();
    await gate.step();
    await gate.step();
    assert.deepEqual(gate.calls, ['invalid', `proxy ${URL}`, 'invalid']);
    assert.deepEqual(gate.changes, [false, true, false]);
  });

  it('treats any error as down', async () => {
    const gate = setup({
      check: [new Error('ipc'), true],
      probe: [new Error('ipc')],
    });
    await gate.step();
    await gate.step();
    await gate.step();
    assert.deepEqual(gate.calls, [
      'invalid',
      'invalid',
      `proxy ${URL}`,
      'invalid',
    ]);
    assert.deepEqual(gate.changes, [false, true, false]);
  });

  it('stays blocked when libsignal refuses the proxy URL', async () => {
    const gate = setup({ check: [true], probe: [], badUrl: true });
    await gate.step();
    assert.deepEqual(gate.calls, ['invalid', 'invalid']);
    assert.deepEqual(gate.changes, [false]);
  });
});
