import { GridView } from 'dev-muxel'

/*
 * The grid itself: the layout tree, the splitters between panes and the shells
 * inside them. Store-driven, so one cell — the seeded "build" grid, a terminal
 * beside a browser pane stacked over a note.
 *
 * The wrapper has to be a flex column: `.grid` claims its height with `flex: 1`,
 * and in a non-flex parent it collapses to nothing because every pane inside it
 * is absolutely positioned.
 */
export const Default = (): React.JSX.Element => (
  <div
    style={{
      display: 'flex',
      flexDirection: 'column',
      width: 960,
      height: 560,
      background: 'var(--bg-chassis)'
    }}
  >
    <GridView />
  </div>
)
