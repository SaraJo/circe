import { describe, expect, it } from 'vitest';
import { fleetIdentity, withFleetIdentity, withoutFleetIdentity } from '../src/main/fleetIdentity';

const old = '# Scully — coordinator\n\nYou are **Trillian**, the central coordinator.\nUse `hermes -p random` for Random.\n';

describe('Hermes fleet identity', () => {
  it('repairs an old introduction even when the heading was already renamed', () => {
    const self = fleetIdentity('default', old, 'Scully');
    const peer = fleetIdentity('random', '# Random\n\nFamily planner.\n', 'Mulder');
    expect(self.previousNames).toEqual(['Trillian']);
    const result = withFleetIdentity(old, 'default', [self, peer], { name: 'Scully', tagline: 'coordinator' });
    expect(result).toContain('You are **Scully**, the central coordinator.');
    expect(result).toContain('Use `hermes -p random` for Random.');
    expect(result).toContain('"name": "Mulder"');
    expect(result).toContain('"Random"');
  });
  it('retains a plain introduction’s role and does not change generic role instructions', () => {
    const soul = '# Zaphod\nYou are Zaphod, the wealth planner.\nYou are the synthesizer for money questions.\n';
    const result = withFleetIdentity(soul, 'zaphod', [fleetIdentity('zaphod', soul, 'Krycek')], { name: 'Krycek', tagline: null });
    expect(result).toContain('You are Krycek, the wealth planner.');
    expect(result).toContain('You are the synthesizer for money questions.');
  });
  it('keeps previous aliases across repeated renames and writes only one roster', () => {
    const first = withFleetIdentity(old, 'default', [fleetIdentity('default', old, 'Scully')], { name: 'Scully', tagline: 'coordinator' });
    const identity = fleetIdentity('default', first, 'Spock');
    expect(identity.previousNames).toEqual(['Scully', 'Trillian']);
    const second = withFleetIdentity(first, 'default', [identity], { name: 'Spock', tagline: 'coordinator' });
    expect(second.match(/circe:fleet-identity:start/g)).toHaveLength(1);
    const again = withFleetIdentity(second, 'default', [identity], { name: 'Spock', tagline: 'coordinator' });
    expect(again).toBe(second);
  });
  it('preserves an unrenamed peer’s original persona and front matter', () => {
    const soul = '---\ntitle: Writer\n---\n# Writer\n\nWrite clearly.\n';
    const result = withFleetIdentity(soul, 'writer', [fleetIdentity('writer', soul, 'Writer')]);
    expect(result.startsWith('---\ntitle: Writer\n---\n')).toBe(true);
    expect(withoutFleetIdentity(result)).toBe(soul);
  });
});
