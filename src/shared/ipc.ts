/**
 * The single list of IPC channel names.
 *
 * Kept in shared/ so main and preload cannot drift apart on a string literal —
 * a typo in a channel name is otherwise a silent no-op that only shows up as
 * "the button does nothing".
 */

export const CH = {
  // renderer -> main, request/response
  stateLoad: 'grid:state:load',
  stateSave: 'grid:state:save',
  settingsPatch: 'grid:settings:patch',

  ptySpawn: 'grid:pty:spawn',
  ptyWrite: 'grid:pty:write',
  ptyResize: 'grid:pty:resize',
  ptyAck: 'grid:pty:ack',
  ptyKill: 'grid:pty:kill',

  gitRefresh: 'grid:git:refresh',
  gitSnapshot: 'grid:git:snapshot',
  gitSetRepos: 'grid:git:setRepos',

  dialogPickFolder: 'grid:dialog:pickFolder',
  repoScan: 'grid:repo:scan',
  repoProbe: 'grid:repo:probe',

  openEditor: 'grid:open:editor',
  openFolder: 'grid:open:folder',
  openExternal: 'grid:open:external',
  editorAvailable: 'grid:open:editorAvailable',

  shellsList: 'grid:shells:list',

  browserAttach: 'grid:browser:attach',
  browserDetach: 'grid:browser:detach',
  browserEmulate: 'grid:browser:emulate',
  browserEntries: 'grid:browser:entries',
  browserBody: 'grid:browser:body',
  browserClear: 'grid:browser:clear',
  browserStash: 'grid:browser:stash',
  /** Renderer tells main whether there is a browser pane to arm at all. */
  browserBridgeSync: 'grid:browser:bridgeSync',
  /** A pane's send button, handing its comments to a waiting session. */
  browserSendComments: 'grid:browser:sendComments',


  winMinimise: 'grid:win:minimise',
  winToggleMaximise: 'grid:win:toggleMaximise',
  winClose: 'grid:win:close',
  winIsMaximised: 'grid:win:isMaximised',
  winAttention: 'grid:win:attention',

  clipboardWrite: 'grid:clipboard:write',
  clipboardRead: 'grid:clipboard:read'
} as const

/** main -> renderer, fire and forget */
export const EV = {
  ptyData: 'grid:ev:pty:data',
  ptyExit: 'grid:ev:pty:exit',
  gitState: 'grid:ev:git:state',
  browserNet: 'grid:ev:browser:net',
  browserCapture: 'grid:ev:browser:capture',
  browserFocus: 'grid:ev:browser:focus',
  /** A session asked for the element picker on the last active browser pane. */
  browserArmPicker: 'grid:ev:browser:armPicker',
  /** That batch has been read by a session; the pane may forget it. */
  browserCommentsTaken: 'grid:ev:browser:commentsTaken',
  /** Whether a session is holding the line, so the pane can say so. */
  browserWaiting: 'grid:ev:browser:waiting',
  winMaximised: 'grid:ev:win:maximised',
  winFocus: 'grid:ev:win:focus',
  appBeforeQuit: 'grid:ev:app:beforeQuit',
  menuAction: 'grid:ev:menu:action'
} as const
