import { SettingsPanel } from 'dev-muxel'

/*
 * Renders its own `Overlay`, so the card is a single full-bleed modal rather
 * than a grid cell. Every field reads the store, which the harness seeds from
 * the app's own `defaultSettings` — so this card shows DevMuxel's real defaults.
 */
export const Default = (): React.JSX.Element => <SettingsPanel />
