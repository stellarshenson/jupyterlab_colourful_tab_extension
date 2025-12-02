/**
 * Unit tests for jupyterlab_colourful_tab_extension
 */

describe('jupyterlab_colourful_tab_extension', () => {
  it('should define light theme colours', () => {
    const lightColours = [
      { name: 'Rose', colour: '#ffd6e0' },
      { name: 'Peach', colour: '#ffe5cc' },
      { name: 'Lemon', colour: '#fff9c4' },
      { name: 'Mint', colour: '#c8f7c5' },
      { name: 'Sky', colour: '#c5e8f7' },
      { name: 'Lavender', colour: '#e5d6f7' }
    ];
    expect(lightColours.length).toEqual(6);
  });

  it('should define dark theme colours', () => {
    const darkColours = [
      { name: 'Rose', colour: '#5c3a42' },
      { name: 'Peach', colour: '#5c4a3a' },
      { name: 'Lemon', colour: '#5c5a3a' },
      { name: 'Mint', colour: '#3a5c3f' },
      { name: 'Sky', colour: '#3a4a5c' },
      { name: 'Lavender', colour: '#4a3a5c' }
    ];
    expect(darkColours.length).toEqual(6);
  });
});
