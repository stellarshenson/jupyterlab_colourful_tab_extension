/**
 * Unit tests for the public IColourfulTabs token
 */
import { Token } from '@lumino/coreutils';
import { IColourfulTabs } from '../tokens';

describe('IColourfulTabs token', () => {
  it('is a Lumino Token', () => {
    expect(IColourfulTabs).toBeInstanceOf(Token);
  });

  it('carries the contracted token id', () => {
    // The consumer extension resolves the token by this exact string; changing
    // it silently breaks federation, so pin it in a test.
    expect(IColourfulTabs.name).toBe(
      'jupyterlab_colourful_tab_extension:IColourfulTabs'
    );
  });
});
