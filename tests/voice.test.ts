import { describe, expect, it } from 'vitest';
import { matchName, parseLocal } from '../src/spec/voice.js';
import { toResult } from '../server/listen.js';

const ctx = { hasWorld: true, inside: true, names: ['Plaza fountain', 'Baker', 'Clock tower', 'Glass bells'], options: ['Lantern', 'Crystal'] };

describe('voice: local phrases', () => {
  it('matches movement instantly', () => {
    expect(parseLocal('Stop!')).toEqual({ intent: 'stop' });
    expect(parseLocal('turn around')).toEqual({ intent: 'turn', degrees: 180 });
    expect(parseLocal('turn left')).toEqual({ intent: 'turn', degrees: -90 });
    expect(parseLocal('keep walking')).toEqual({ intent: 'walk' });
    expect(parseLocal('go north')).toEqual({ intent: 'move', direction: 'north' });
    expect(parseLocal('forward')).toEqual({ intent: 'move', direction: 'forward' });
    expect(parseLocal('take me home')).toEqual({ intent: 'home' });
    expect(parseLocal('where next')).toEqual({ intent: 'next' });
    expect(parseLocal('say that again')).toEqual({ intent: 'repeat' });
  });

  it('resolves places and choices', () => {
    expect(parseLocal('take me to the fountain', ctx)).toEqual({ intent: 'go', target: 'Plaza fountain' });
    expect(parseLocal('go to the old clock tower', ctx)).toEqual({ intent: 'go', target: 'Clock tower' });
    expect(parseLocal('the lantern', ctx)).toEqual({ intent: 'choose', option: 0 });
    expect(parseLocal('second one', ctx)).toEqual({ intent: 'choose', option: 1 });
  });

  it('leaves wishes for the AI', () => {
    expect(parseLocal('a snowy village among frosted pines', ctx)).toBeNull();
    expect(parseLocal('make it night', ctx)).toBeNull();
    expect(matchName('dragon', ctx.names)).toBeNull();
  });

  it('validates what the model returns', () => {
    expect(toResult('turn around', { intent: 'conjure', text: 'turn around' }, ctx).command).toEqual({ intent: 'turn', degrees: 180 });
    expect(toResult('make it night', { intent: 'conjure', text: 'make it night' }, ctx).command).toEqual({ intent: 'conjure', text: 'make it night' });
    expect(toResult('a desert oasis', { intent: 'bogus' }, ctx).command).toEqual({ intent: 'conjure', text: 'a desert oasis' });
    expect(toResult('', { intent: 'none' }, ctx).command).toEqual({ intent: 'none' });
  });
});
