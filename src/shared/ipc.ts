/**
 * The single list of IPC channel names.
 *
 * Kept in shared/ so main and preload cannot drift apart on a string literal —
 * a typo in a channel name is otherwise a silent no-op that only shows up as
 * "the button does nothing".
 */

export const CH = {
  // renderer -> main, request/response
  stateLoad: 'devlobby:state:load',
  stateSave: 'devlobby:state:save',
  settingsPatch: 'devlobby:settings:patch',

  ptySpawn: 'devlobby:pty:spawn',
  ptyWrite: 'devlobby:pty:write',
  ptyResize: 'devlobby:pty:resize',
  ptyAck: 'devlobby:pty:ack',
  ptyKill: 'devlobby:pty:kill',

  gitRefresh: 'devlobby:git:refresh',
  gitSnapshot: 'devlobby:git:snapshot',
  gitSetRepos: 'devlobby:git:setRepos',

  dialogPickFolder: 'devlobby:dialog:pickFolder',
  repoScan: 'devlobby:repo:scan',
  repoProbe: 'devlobby:repo:probe',

  openEditor: 'devlobby:open:editor',
  openFolder: 'devlobby:open:folder',
  openExternal: 'devlobby:open:external',
  editorAvailable: 'devlobby:open:editorAvailable',

  shellsList: 'devlobby:shells:list',

  browserAttach: 'devlobby:browser:attach',
  browserDetach: 'devlobby:browser:detach',
  browserEmulate: 'devlobby:browser:emulate',
  browserEntries: 'devlobby:browser:entries',
  browserBody: 'devlobby:browser:body',
  browserClear: 'devlobby:browser:clear',
  browserStash: 'devlobby:browser:stash',
  /** Renderer tells main whether there is a browser pane to arm at all. */
  browserBridgeSync: 'devlobby:browser:bridgeSync',
  /** A pane's send button, handing its comments to a waiting session. */
  browserSendComments: 'devlobby:browser:sendComments',
  /** What the user said about a page's request for a new tab. */
  browserPopupDecide: 'devlobby:browser:popupDecide',

  /**
   * Is the /devlobby-browser skill installed for this user, and is it current?
   */
  skillStatus: 'devlobby:skill:status',
  skillInstall: 'devlobby:skill:install',

  winMinimise: 'devlobby:win:minimise',
  winToggleMaximise: 'devlobby:win:toggleMaximise',
  winClose: 'devlobby:win:close',
  winIsMaximised: 'devlobby:win:isMaximised',
  winAttention: 'devlobby:win:attention',

  clipboardWrite: 'devlobby:clipboard:write',
  clipboardRead: 'devlobby:clipboard:read'
} as const

/** main -> renderer, fire and forget */
export const EV = {
  ptyData: 'devlobby:ev:pty:data',
  ptyExit: 'devlobby:ev:pty:exit',
  gitState: 'devlobby:ev:git:state',
  browserNet: 'devlobby:ev:browser:net',
  browserCapture: 'devlobby:ev:browser:capture',
  browserFocus: 'devlobby:ev:browser:focus',
  /** A session asked for the element picker on the last active browser pane. */
  browserArmPicker: 'devlobby:ev:browser:armPicker',
  /** That batch has been read by a session; the pane may forget it. */
  browserCommentsTaken: 'devlobby:ev:browser:commentsTaken',
  /** Whether a session is holding the line, so the pane can say so. */
  browserWaiting: 'devlobby:ev:browser:waiting',
  /** A page asked for a new tab; only the user can say what that should mean. */
  browserPopup: 'devlobby:ev:browser:popup',
  winMaximised: 'devlobby:ev:win:maximised',
  winFocus: 'devlobby:ev:win:focus',
  appBeforeQuit: 'devlobby:ev:app:beforeQuit',
  menuAction: 'devlobby:ev:menu:action'
} as const
