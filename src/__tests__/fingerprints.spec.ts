/**
 * Unit tests for the terminal fingerprint client.
 */
import { ServerConnection } from '@jupyterlab/services';

// The whole point of the module under test is the one call it makes, so the
// connection layer is stubbed and the test states what the server answered.
jest.mock('@jupyterlab/services', () => ({
  ServerConnection: {
    makeSettings: jest.fn(() => ({ baseUrl: 'http://localhost:8888/' })),
    makeRequest: jest.fn()
  }
}));

import { fetchTerminalFingerprints } from '../fingerprints';

const makeRequest = ServerConnection.makeRequest as unknown as jest.Mock;

/** A fetch answer with a JSON body. */
function answers(body: unknown, ok = true): void {
  makeRequest.mockResolvedValue({ ok, json: async () => body });
}

describe('fetchTerminalFingerprints', () => {
  beforeEach(() => {
    makeRequest.mockReset();
  });

  it('asks the companion route under the server base url', async () => {
    answers({ terminals: {} });
    await fetchTerminalFingerprints();
    expect(makeRequest.mock.calls[0][0]).toEqual(
      'http://localhost:8888/colourful-tab/terminals'
    );
  });

  it('answers the fingerprint of every terminal the server runs', async () => {
    answers({ terminals: { '1': '8123:874512', '3': '8140:875001' } });
    await expect(fetchTerminalFingerprints()).resolves.toEqual({
      '1': '8123:874512',
      '3': '8140:875001'
    });
  });

  it('answers an empty map when the server runs no terminals', async () => {
    // Distinct from null on purpose: this states that every stored terminal
    // colour is stale, where null states that nothing can be established
    answers({ terminals: {} });
    const fingerprints = await fetchTerminalFingerprints();
    expect(fingerprints).not.toBeNull();
    expect(fingerprints).toEqual({});
  });

  it('answers null when the route is not there', async () => {
    answers({ message: 'Not Found' }, false);
    await expect(fetchTerminalFingerprints()).resolves.toBeNull();
  });

  it('answers null when the server cannot be reached', async () => {
    makeRequest.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(fetchTerminalFingerprints()).resolves.toBeNull();
  });

  it('answers null when the body is not JSON', async () => {
    makeRequest.mockResolvedValue({
      ok: true,
      json: async () => {
        throw new SyntaxError('Unexpected token <');
      }
    });
    await expect(fetchTerminalFingerprints()).resolves.toBeNull();
  });

  it('answers null when the body lacks the documented key', async () => {
    // Something else is serving the path; that is not the same as "no
    // terminals" and must not be read as a licence to drop every colour
    answers({ sessions: {} });
    await expect(fetchTerminalFingerprints()).resolves.toBeNull();
  });

  it('drops a terminal whose fingerprint is not a string', async () => {
    answers({ terminals: { '1': '8123:874512', '2': null } });
    await expect(fetchTerminalFingerprints()).resolves.toEqual({
      '1': '8123:874512'
    });
  });
});
