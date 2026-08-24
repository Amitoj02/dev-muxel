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
  winMaximised: 'grid:ev:win:maximised',
  winFocus: 'grid:ev:win:focus',
  appBeforeQuit: 'grid:ev:app:beforeQuit',
  menuAction: 'grid:ev:menu:action'
} as const
