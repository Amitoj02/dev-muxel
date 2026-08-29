import { NewTerminalMenu } from 'devlobby'

const noop = (): void => {}

/*
 * The body of the titlebar's + menu — a fragment of `pmenu__*` rows, so the
 * preview supplies the `.pmenu` surface the popover would normally provide.
 * Repositories come from the store; the harness seeds three.
 */
export const InMenu = (): React.JSX.Element => (
  <div className="pmenu" style={{ position: 'static', width: 320 }}>
    <NewTerminalMenu onClose={noop} />
  </div>
)
