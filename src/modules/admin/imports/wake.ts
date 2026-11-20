import { EventEmitter } from 'node:events';

/**
 * News, kept in this server's memory, so nobody has to ask the database again and again: "work" when a job for the photo computer is queued,
 * "drafts" when the drafts list changes. The photo computer and the admin's Imports page wait for it (GET /gleamshelf/wait, GET
 * /admin/imports/changes) instead of polling: their polling every few seconds, in every open tab and around the clock, ran the shop's
 * database over its free monthly egress in two days (2026-11-20). The shop runs one server, so memory is enough; a restart only means one
 * early answer, after which everyone looks once and waits again.
 */
const bus = new EventEmitter();
bus.setMaxListeners(0);
let draftsVersion = Date.now();

/** A job for the photo computer was queued. */
export const workQueued = () => bus.emit('work');

/** The drafts list changed (a draft arrived, was added, rejected or edited). */
export function draftsChanged() {
  draftsVersion++;
  bus.emit('drafts');
}

/** Where the drafts list is now: an Imports page compares it with what it last showed. */
export const currentDraftsVersion = () => draftsVersion;

/** Waits until `kind` happens or `seconds` pass. True when it happened. */
export function waitFor(kind: 'work' | 'drafts', seconds: number): Promise<boolean> {
  return new Promise((resolve) => {
    const done = (happened: boolean) => {
      clearTimeout(timer);
      bus.off(kind, onEvent);
      resolve(happened);
    };
    const onEvent = () => done(true);
    const timer = setTimeout(() => done(false), Math.max(1, seconds) * 1000);
    bus.on(kind, onEvent);
  });
}
