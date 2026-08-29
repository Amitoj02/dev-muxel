import { Toast } from 'devlobby'

const noop = (): void => {}

/*
 * The only transient surface in the app. Both tones are prop-driven, so this is
 * one of the few components whose variants can sit side by side in one card.
 */

/** The ordinary case: something happened and you may care. */
export const Info = (): React.JSX.Element => (
  <Toast text="Pane reopened — Ctrl+Shift+T again for the one before it" tone="info" onDone={noop} />
)

/** Errors stay up longer and carry the signal red. */
export const Error = (): React.JSX.Element => (
  <Toast text="Could not open C:\Users\dev\projects\ledger — no such folder" tone="error" onDone={noop} />
)
