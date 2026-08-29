import { useEffect } from 'react'
import { TerminalPane, writeTerminal } from 'dev-muxel'

/*
 * The real xterm terminal, with real scrollback.
 *
 * There is no pty behind a preview — the shell lives in the main process — so
 * the text below goes in through the session's own local-write path rather than
 * from a process. Everything the design system owns is genuine: the surface,
 * the JetBrains Mono metrics, the ANSI palette and the focus treatment.
 */

const repo = {
  id: 'r1',
  name: 'dev-muxel',
  path: 'C:\\Users\\dev\\projects\\dev-muxel',
  color: '#e5372a'
}

const pane = {
  id: 'p1',
  kind: 'terminal' as const,
  repoId: 'r1',
  cwd: 'C:\\Users\\dev\\projects\\dev-muxel',
  shellId: 'powershell',
  label: 'dev-muxel'
}

const E = '\u001b'
const dim = (s: string): string => `${E}[38;5;244m${s}${E}[0m`
const green = (s: string): string => `${E}[38;5;114m${s}${E}[0m`
const red = (s: string): string => `${E}[38;5;203m${s}${E}[0m`
const blue = (s: string): string => `${E}[38;5;110m${s}${E}[0m`
const bold = (s: string): string => `${E}[1m${s}${E}[0m`

const DEV_SERVER = [
  `${dim('PS')} ${blue('C:\\Users\\dev\\projects\\dev-muxel')}${dim('>')} npm run dev`,
  '',
  `${dim('>')} dev-muxel@1.0.0 dev`,
  `${dim('>')} electron-vite dev`,
  '',
  `  ${green('VITE v8.2.2')}  ready in ${bold('412')} ms`,
  '',
  `  ${green('➜')}  ${bold('Renderer')}: http://localhost:5173/`,
  `  ${dim('➜')}  ${dim('Main')}:     out/main/index.js`,
  `  ${dim('➜')}  ${dim('Preload')}:  out/preload/index.js`,
  '',
  `${dim('12:04:31')} ${green('hmr update')} /src/renderer/src/components/TabStrip.tsx`,
  `${dim('12:04:48')} ${green('hmr update')} /src/renderer/src/styles/app.css`,
  ''
].join('\r\n')

const FAILING = [
  `${dim('PS')} ${blue('C:\\Users\\dev\\projects\\dev-muxel')}${dim('>')} npm run typecheck`,
  '',
  `${dim('>')} dev-muxel@1.0.0 typecheck:web`,
  '',
  `${red('src/renderer/src/components/GridView.tsx')}${dim(':142:18')} - ${red('error')} ${dim('TS2339')}:`,
  `  Property ${bold("'zoomedPaneId'")} does not exist on type ${bold("'TabState'")}.`,
  '',
  `${red('Found 1 error')} in 1 file.`,
  ''
].join('\r\n')

const Stage = ({ children }: { children: React.ReactNode }): React.JSX.Element => (
  <div
    style={{
      position: 'relative',
      width: 640,
      height: 300,
      display: 'flex',
      background: 'var(--bg-term)',
      border: '1px solid var(--line)'
    }}
  >
    {children}
  </div>
)

/** A dev server running: the focused terminal, with the focus treatment on. */
export const Running = (): React.JSX.Element => {
  useEffect(() => writeTerminal('p1', DEV_SERVER), [])
  return (
    <Stage>
      <TerminalPane pane={pane} repo={repo} focused />
    </Stage>
  )
}

/** A failing typecheck — the ANSI palette carrying an error. */
export const Failing = (): React.JSX.Element => {
  useEffect(() => writeTerminal('p2', FAILING), [])
  return (
    <Stage>
      <TerminalPane
        pane={{ ...pane, id: 'p2', label: 'orbit-api', shellId: 'bash' }}
        repo={{ ...repo, id: 'r2', name: 'orbit-api' }}
        focused={false}
      />
    </Stage>
  )
}
