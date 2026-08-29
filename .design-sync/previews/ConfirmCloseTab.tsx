import { ConfirmCloseTab } from 'dev-muxel'

/*
 * Reads the tab out of the session, so the id has to be a real one. The harness
 * seeds t1 ("build", three panes) and t2 ("api", one).
 */

/** A grid with several panes, one of them still running. */
export const Populated = (): React.JSX.Element => <ConfirmCloseTab tabId="t1" />

/** A single-pane grid — the copy singularises. */
export const SinglePane = (): React.JSX.Element => <ConfirmCloseTab tabId="t2" />
