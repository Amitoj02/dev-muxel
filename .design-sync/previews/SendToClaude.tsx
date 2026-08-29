import { SendToClaude } from 'devlobby'

/*
 * Reads the pane's network log out of the netlog module rather than props, so
 * the uids here address entries the harness seeded for p3: u4 is the /api/projects
 * call, u6 the 500 on /api/telemetry.
 */

/** One request on its way to a session — headers, body, and the target picker. */
export const OneRequest = (): React.JSX.Element => <SendToClaude paneId="p3" uids={['u4']} />

/** A failure is the usual reason to send: the 500 goes with its context. */
export const Failure = (): React.JSX.Element => <SendToClaude paneId="p3" uids={['u6']} />

/** Several at once — the summary counts them and the body list scrolls. */
export const Batch = (): React.JSX.Element => (
  <SendToClaude paneId="p3" uids={['u4', 'u5', 'u6']} />
)
