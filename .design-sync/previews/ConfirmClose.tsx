import { ConfirmClose } from 'devlobby'

/*
 * `paneId` is a lookup into the session, not a free string: the dialog returns
 * null for a pane it cannot find. The harness seeds p1 (a busy terminal on
 * devlobby) and p4 (a note), which is what these two cells address.
 */

/** A terminal with a dev server still running in it. */
export const Terminal = (): React.JSX.Element => <ConfirmClose paneId="p1" />

/** A note pane — no process, so the wording drops the pid. */
export const Note = (): React.JSX.Element => <ConfirmClose paneId="p4" />
