import { describe, expect, it } from 'vitest';
import { currentDraftsVersion, draftsChanged, waitFor, workQueued } from './wake.js';

describe('waiting for news instead of polling the database (wake.ts)', () => {
  it('wakes a waiting photo computer as soon as a job is queued', async () => {
    const waiting = waitFor('work', 60);
    workQueued();
    expect(await waiting).toBe(true);
  });

  it('answers false when nothing happens in time', async () => {
    expect(await waitFor('work', 0.05)).toBe(false);
  });

  it('moves the drafts version and wakes an Imports page when drafts change, and only for drafts', async () => {
    const before = currentDraftsVersion();
    const drafts = waitFor('drafts', 60);
    const work = waitFor('work', 0.05);
    draftsChanged();
    expect(await drafts).toBe(true);
    expect(await work).toBe(false);
    expect(currentDraftsVersion()).toBe(before + 1);
  });
});
