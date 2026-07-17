import { deadTerminalIds, stableTabId, terminalTabId } from '../identity';

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

describe('deadTerminalIds', () => {
  it('drops a terminal whose session the server no longer lists', () => {
    expect(deadTerminalIds(['terminal:3'], [])).toEqual(['terminal:3']);
  });

  it('keeps a terminal whose session is still running', () => {
    expect(deadTerminalIds(['terminal:3'], ['3'])).toEqual([]);
  });

  it('never prunes file paths, whatever the server reports', () => {
    const stored = ['/home/lab/x.ipynb', 'terminal:2'];
    expect(deadTerminalIds(stored, [])).toEqual(['terminal:2']);
    expect(deadTerminalIds(stored, ['2'])).toEqual([]);
  });

  it('prunes only the dead names when several terminals are stored', () => {
    const stored = ['terminal:1', 'terminal:2', 'terminal:3'];
    expect(deadTerminalIds(stored, ['1', '3'])).toEqual(['terminal:2']);
  });

  it('recycled name: colouring 3, losing it, then a new 3 leaves no entry', () => {
    // The reported defect - terminado hands the next terminal the freed name
    const stored = ['terminal:3'];
    const afterDeath = deadTerminalIds(stored, []);
    expect(afterDeath).toEqual(['terminal:3']);
    // the entry is deleted at death, so the new terminal 3 finds nothing stored
    const remaining = stored.filter(id => !afterDeath.includes(id));
    expect(deadTerminalIds(remaining, ['3'])).toEqual([]);
    expect(remaining).toEqual([]);
  });
});

describe('terminalTabId', () => {
  it('prefixes a session name', () => {
    expect(terminalTabId('1')).toEqual('terminal:1');
  });
});
