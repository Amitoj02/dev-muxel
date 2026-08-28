/**
 * The single list of IPC channel names.
 *
 * Kept in shared/ so main and preload cannot drift apart on a string literal —
 * a typo in a channel name is otherwise a silent no-op that only shows up as
 * "the button does nothing".
 */

export const CH = {
  // renderer -> main, request/response
  stateLoad: 'devmuxel:state:load',
  stateSave: 'devmuxel:state:save',
  settingsPatch: 'devmuxel:settings:patch',

  ptySpawn: 'devmuxel:pty:spawn',
  ptyWrite: 'devmuxel:pty:write',
  ptyResize: 'devmuxel:pty:resize',
  ptyAck: 'devmuxel:pty:ack',
  ptyKill: 'devmuxel:pty:kill',

  gitRefresh: 'devmuxel:git:refresh',
  gitSnapshot: 'devmuxel:git:snapshot',
  gitSetRepos: 'devmuxel:git:setRepos',

  dialogPickFolder: 'devmuxel:dialog:pickFolder',
  repoScan: 'devmuxel:repo:scan',
  repoProbe: 'devmuxel:repo:probe',

  openEditor: 'devmuxel:open:editor',
  openFolder: 'devmuxel:open:folder',
  openExternal: 'devmuxel:open:external',
  editorAvailable: 'devmuxel:open:editorAvailable',

  shellsList: 'devmuxel:shells:list',

  browserAttach: 'devmuxel:browser:attach',
  browserDetach: 'devmuxel:browser:detach',
  browserEmulate: 'devmuxel:browser:emulate',
  browserEntries: 'devmuxel:browser:entries',
  browserBody: 'devmuxel:browser:body',
  browserClear: 'devmuxel:browser:clear',
  browserStash: 'devmuxel:browser:stash',
  /** Renderer tells main whether there is a browser pane to arm at all. */
  browserBridgeSync: 'devmuxel:browser:bridgeSync',
  /** A pane's send button, handing its comments to a waiting session. */
  browserSendComments: 'devmuxel:browser:sendComments',

  /**
   * Is the /devmuxel-browser skill installed for this user, and is it current?
   */
  skillStatus: 'devmuxel:skill:status',
  skillInstall: 'devmuxel:skill:install',

  winMinimise: 'devmuxel:win:minimise',
  winToggleMaximise: 'devmuxel:win:toggleMaximise',
  winClose: 'devmuxel:win:close',
  winIsMaximised: 'devmuxel:win:isMaximised',
  winAttention: 'devmuxel:win:attention',

  clipboardWrite: 'devmuxel:clipboard:write',
  clipboardRead: 'devmuxel:clipboard:read'
} as const

/** main -> renderer, fire and forget */
export const EV = {
  ptyData: 'devmuxel:ev:pty:data',
  ptyExit: 'devmuxel:ev:pty:exit',
  gitState: 'devmuxel:ev:git:state',
  browserNet: 'devmuxel:ev:browser:net',
  browserCapture: 'devmuxel:ev:browser:capture',
  browserFocus: 'devmuxel:ev:browser:focus',
  /** A session asked for the element picker on the last active browser pane. */
  browserArmPicker: 'devmuxel:ev:browser:armPicker',
  /** That batch has been read by a session; the pane may forget it. */
  browserCommentsTaken: 'devmuxel:ev:browser:commentsTaken',
  /** Whether a session is holding the line, so the pane can say so. */
  browserWaiting: 'devmuxel:ev:browser:waiting',
  winMaximised: 'devmuxel:ev:win:maximised',
  winFocus: 'devmuxel:ev:win:focus',
  appBeforeQuit: 'devmuxel:ev:app:beforeQuit',
  menuAction: 'devmuxel:ev:menu:action'
} as const
