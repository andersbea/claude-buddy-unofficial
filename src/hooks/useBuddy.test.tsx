import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBuddy } from './useBuddy';

/*
 * Orchestration-level tests for the wiring hub. In jsdom `isNative()` is false,
 * so the hook boots in browser mode with the simulator as its message source —
 * exercising the same handleMessage → applySnapshot → approval → stats path a
 * real BLE peripheral drives.
 */
describe('useBuddy (browser mode)', () => {
  it('boots in browser mode with no prompt', () => {
    const { result } = renderHook(() => useBuddy());
    expect(result.current.native).toBe(false);
    expect(result.current.prompt).toBeNull();
  });

  it('raises an approval on triggerPrompt, then clears + counts it on approve', () => {
    const { result } = renderHook(() => useBuddy());
    const before = result.current.stats.approved;

    act(() => { result.current.actions.triggerPrompt(); });
    expect(result.current.prompt).not.toBeNull();
    expect(result.current.animState).toBe('attention');

    act(() => { result.current.actions.approve(); });
    expect(result.current.prompt).toBeNull();
    expect(result.current.stats.approved).toBe(before + 1);
  });

  it('deny clears the prompt and counts a denial, not an approval', () => {
    const { result } = renderHook(() => useBuddy());
    const appr = result.current.stats.approved;
    const deny = result.current.stats.denied;

    act(() => { result.current.actions.triggerPrompt(); });
    act(() => { result.current.actions.deny(); });

    expect(result.current.prompt).toBeNull();
    expect(result.current.stats.approved).toBe(appr);
    expect(result.current.stats.denied).toBe(deny + 1);
  });
});
