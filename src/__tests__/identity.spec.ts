import {
  IStoredColour,
  parseStoredColour,
  stableTabId,
  staleTerminalIds,
  terminalSessionName
} from '../identity';

/** The persisted entries, in the shape the prune reads them. */
function stored(
  ...pairs: Array<[string, IStoredColour]>
): Map<string, IStoredColour> {
  return new Map(pairs);
}

describe('stableTabId', () => {
  it('resolves a file tab to its path', () => {
    expect(stableTabId('Name: x.ipynb\nPath: /home/lab/x.ipynb', null)).toEqual(
      '/home/lab/x.ipynb'
    );
  });

  it('resolves a terminal tab to its session name', () => {
    expect(stableTabId(null, '3')).toEqual('terminal:3');
  });

  it('returns null for a launcher - a widget id is not an identity (DEF-6)', () => {
    // A launcher carries an empty title attribute and no terminal session; its
    // widget id (`launcher-0`) is a per-session counter and must never be a key
    expect(stableTabId('', null)).toBeNull();
    expect(stableTabId(null, null)).toBeNull();
  });

  it('returns null for a titled tab that is neither file nor terminal', () => {
    expect(stableTabId('Settings', null)).toBeNull();
  });
});

describe('parseStoredColour', () => {
  const PALETTE = 6;

  it('reads the pre-fingerprint bare number as a colour with no fingerprint', () => {
    expect(parseStoredColour(2, PALETTE)).toEqual({ colour: 2 });
  });

  it('reads the fingerprinted object shape', () => {
    expect(parseStoredColour({ colour: 2, fp: 'pty-a' }, PALETTE)).toEqual({
      colour: 2,
      fp: 'pty-a'
    });
  });

  it('drops a value that is not a colour at all', () => {
    // localStorage is shared, hand-editable and outlives every release; one
    // value of another shape reaches `entry.fp` on the next prune and throws,
    // taking tab colouring down for that browser until the key is cleared
    expect(parseStoredColour(null, PALETTE)).toBeNull();
    expect(parseStoredColour('mint', PALETTE)).toBeNull();
    expect(parseStoredColour(true, PALETTE)).toBeNull();
    expect(parseStoredColour({ fp: 'pty-a' }, PALETTE)).toBeNull();
    expect(parseStoredColour({ colour: 'mint' }, PALETTE)).toBeNull();
  });

  it('drops a colour index the palette has no entry for', () => {
    expect(parseStoredColour(PALETTE, PALETTE)).toBeNull();
    expect(parseStoredColour(-1, PALETTE)).toBeNull();
    expect(parseStoredColour(1.5, PALETTE)).toBeNull();
    expect(parseStoredColour({ colour: 99, fp: 'pty-a' }, PALETTE)).toBeNull();
  });

  it('drops an entry whose fingerprint is not a string', () => {
    // It can never match a fingerprint the server reports, so the entry is
    // corrupt rather than one waiting to match
    expect(parseStoredColour({ colour: 2, fp: 17 }, PALETTE)).toBeNull();
  });
});

describe('staleTerminalIds with fingerprints', () => {
  it('keeps a terminal whose fingerprint still matches', () => {
    const entries = stored(['terminal:3', { colour: 2, fp: 'pty-a' }]);
    expect(staleTerminalIds(entries, { '3': 'pty-a' }, ['3'])).toEqual([]);
  });

  it('recycled name: drops the dead terminal 3 while a live 3 runs', () => {
    // The defect this rule exists for - terminado hands the next terminal the
    // freed name, so the name is PRESENT in the running list and the colour of
    // the dead terminal paints the new one
    const entries = stored(['terminal:3', { colour: 3, fp: 'dead-pty' }]);
    expect(staleTerminalIds(entries, { '3': 'live-pty' }, ['3'])).toEqual([
      'terminal:3'
    ]);
    // and this is what the running list alone can see: nothing
    expect(staleTerminalIds(entries, null, ['3'])).toEqual([]);
  });

  it('drops a terminal the server no longer reports at all', () => {
    const entries = stored(['terminal:3', { colour: 2, fp: 'pty-a' }]);
    expect(staleTerminalIds(entries, {}, [])).toEqual(['terminal:3']);
  });

  it('drops an entry carrying no fingerprint, whatever the server runs', () => {
    // The pre-fingerprint shape cannot be told apart from the stale entry the
    // prune exists to remove, so it goes rather than adopting the live one
    const entries = stored(['terminal:3', { colour: 2 }]);
    expect(staleTerminalIds(entries, { '3': 'pty-a' }, ['3'])).toEqual([
      'terminal:3'
    ]);
  });

  it('never returns a file path', () => {
    const entries = stored(
      ['/home/lab/x.ipynb', { colour: 4 }],
      ['terminal:2', { colour: 1, fp: 'pty-a' }]
    );
    expect(staleTerminalIds(entries, {}, [])).toEqual(['terminal:2']);
    expect(staleTerminalIds(entries, { '2': 'pty-a' }, ['2'])).toEqual([]);
  });

  it('prunes only the disowned names when several terminals are stored', () => {
    const entries = stored(
      ['terminal:1', { colour: 0, fp: 'pty-a' }],
      ['terminal:2', { colour: 1, fp: 'pty-b' }],
      ['terminal:3', { colour: 2, fp: 'pty-c' }]
    );
    const live = { '1': 'pty-a', '2': 'pty-new', '3': 'pty-c' };
    expect(staleTerminalIds(entries, live, ['1', '2', '3'])).toEqual([
      'terminal:2'
    ]);
  });
});

describe('staleTerminalIds without fingerprints', () => {
  it('drops a terminal whose session the server no longer lists', () => {
    const entries = stored(['terminal:3', { colour: 2, fp: 'pty-a' }]);
    expect(staleTerminalIds(entries, null, [])).toEqual(['terminal:3']);
  });

  it('keeps a running terminal that carries no fingerprint', () => {
    // A server without the fingerprint route would otherwise lose every stored
    // terminal colour, since none of its entries can ever carry one
    const entries = stored(['terminal:3', { colour: 2 }]);
    expect(staleTerminalIds(entries, null, ['3'])).toEqual([]);
  });

  it('never returns a file path', () => {
    const entries = stored(
      ['/home/lab/x.ipynb', { colour: 4 }],
      ['terminal:2', { colour: 1 }]
    );
    expect(staleTerminalIds(entries, null, [])).toEqual(['terminal:2']);
  });
});

describe('terminalSessionName', () => {
  it('strips the prefix off a terminal id', () => {
    expect(terminalSessionName('terminal:3')).toEqual('3');
  });

  it('answers null for a file path', () => {
    expect(terminalSessionName('/home/lab/x.ipynb')).toBeNull();
  });
});
