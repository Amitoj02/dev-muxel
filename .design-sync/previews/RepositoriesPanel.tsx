import { RepositoriesPanel } from 'dev-muxel'

/*
 * Its own `Overlay`, so one full-bleed card. The three seeded repos carry
 * distinct git states — ahead and dirty, behind with untracked, and clean — so
 * the row's status chips all appear at once.
 */
export const Default = (): React.JSX.Element => <RepositoriesPanel />
