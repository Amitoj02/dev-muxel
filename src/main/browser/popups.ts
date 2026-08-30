/**
 * What happens when a page in a pane asks for a new tab.
 *
 * A browser pane has no tabs and its guest may not open a window, so a
 * `target="_blank"` link has nowhere of its own to go. Loading it over the top
 * of the page you were on — which is what this used to do — is wrong twice: it
 * loses the page you were reading, and it hands a site that opens tabs by
 * itself the ability to take the pane away from you.
 *
 * So the request goes to the user. There are three honest answers: a browser
 * pane of its own, nothing, or nothing for a while — that last one being the
 * one that matters on a site that opens a tab every time you touch it.
 *
 * This file is the bookkeeping behind the third answer, and behind not asking
 * the same question a hundred times a second. It is deliberately free of
 * Electron: the guest is a number here, the clock is a parameter, and the
 * whole of it is checked by `npm run check:browser`.
 */

/**
 * How long a question may go unanswered before it is assumed lost.
 *
 * The renderer answers every dialog, including the ones something else closed
 * — but "including" is doing a lot of work in a process that can be reloaded
 * mid-question, and a question nobody will ever answer would silence that
 * pane's links for the rest of the session.
 */
const ASK_TTL_MS = 2 * 60 * 1000

/** What to do about a request, before anybody is disturbed by it. */
export type PopupVerdict =
  /** Put it to the user. */
  | 'ask'
  /** This guest already has a question on screen; one at a time. */
  | 'asking'
  /** The user said not for a while, and it has not been a while. */
  | 'snoozed'

/** What came back. `open` and `ignore` differ only to the caller that logs them. */
export type PopupDecision = 'open' | 'ignore' | 'snooze'

export class PopupGate {
  /** guest id -> when it was asked about, so a lost question expires. */
  private asked = new Map<number, number>()
  /** guest id -> when its snooze runs out. */
  private snoozedUntil = new Map<number, number>()

  /**
   * @param snoozeMs how long "not now" lasts — `POPUP_SNOOZE_MS`, handed in
   *   rather than imported. Nothing in this file imports a value from
   *   anywhere, which is what lets the checks run it straight off Node's type
   *   stripping with no build step in front of them.
   */
  private readonly snoozeMs: number

  constructor(snoozeMs: number) {
    this.snoozeMs = snoozeMs
  }

  /**
   * Decide whether to disturb the user, and record that we did.
   *
   * A guest that is already being asked about is refused rather than queued: a
   * page firing new tabs in a loop must not be able to stack dialogs, and the
   * second URL is never the one the user meant anyway.
   */
  consider(guestId: number, now = Date.now()): PopupVerdict {
    const until = this.snoozedUntil.get(guestId) ?? 0
    if (until > now) return 'snoozed'
    if (until) this.snoozedUntil.delete(guestId)

    const asked = this.asked.get(guestId)
    if (asked !== undefined && now - asked < ASK_TTL_MS) return 'asking'

    this.asked.set(guestId, now)
    return 'ask'
  }

  /** The user answered; the next new tab from this guest gets asked about too. */
  settle(guestId: number): void {
    this.asked.delete(guestId)
  }

  /** Ignore this guest's new tabs, without asking, for a while. */
  snooze(guestId: number, now = Date.now()): void {
    this.asked.delete(guestId)
    this.snoozedUntil.set(guestId, now + this.snoozeMs)
  }

  /** Apply an answer, whichever it was. */
  decide(guestId: number, decision: PopupDecision, now = Date.now()): void {
    if (decision === 'snooze') this.snooze(guestId, now)
    else this.settle(guestId)
  }

  /** What is left of a snooze, in ms. Zero when there is none. */
  snoozeLeft(guestId: number, now = Date.now()): number {
    return Math.max(0, (this.snoozedUntil.get(guestId) ?? 0) - now)
  }

  /** The guest is gone; its id will be handed to somebody else. */
  forget(guestId: number): void {
    this.asked.delete(guestId)
    this.snoozedUntil.delete(guestId)
  }
}
