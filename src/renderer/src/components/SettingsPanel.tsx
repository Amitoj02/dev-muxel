/**
 * Settings.
 *
 * Deliberately short. Everything here is something the design left as a knob
 * (gutter, zoom inset, glow) or something a daily driver genuinely needs to
 * change (font, shell, poll rate, what counts as "needs you").
 */

import type { Settings } from '../../../shared/types'
import { CLAUDE_EFFORTS, CLAUDE_MODELS } from '../../../shared/claude'
import { IconClose } from './Icons'
import { Overlay } from './Overlay'
import { actions, useApp } from '../state/hooks'

export function SettingsPanel(): React.JSX.Element {
  const app = useApp()
  const s = app.settings

  const set = <K extends keyof Settings>(key: K, value: Settings[K]): void => {
    actions.patchSettings({ [key]: value } as Partial<Settings>)
  }

  const num = (key: keyof Settings, min: number, max: number) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value)
    if (!Number.isFinite(v)) return
    set(key, Math.min(max, Math.max(min, v)) as never)
  }

  return (
    <Overlay onClose={() => actions.closeOverlay()}>
      <div className="dialog">
        <div className="dialog__head">
          <h2 className="dialog__title">SETTINGS</h2>
          <span className="dialog__sub">saved as you change them</span>
          <button className="dialog__close" onClick={() => actions.closeOverlay()} aria-label="Close">
            <IconClose size={12} />
          </button>
        </div>

        <div className="dialog__body">
          <div className="settings-section">Terminal</div>
          <div className="settings-grid">
            <label className="field">
              <span className="field__label">Default shell</span>
              <select
                className="select"
                value={s.defaultShellId}
                onChange={(e) => set('defaultShellId', e.target.value)}
              >
                {app.shells.map((sh) => (
                  <option key={sh.id} value={sh.id}>
                    {sh.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span className="field__label">Font family</span>
              <input
                className="input"
                value={s.fontFamily}
                onChange={(e) => set('fontFamily', e.target.value)}
              />
            </label>

            <label className="field">
              <span className="field__label">Font size</span>
              <input
                className="input"
                type="number"
                min={8}
                max={28}
                value={s.fontSize}
                onChange={num('fontSize', 8, 28)}
              />
            </label>

            <label className="field">
              <span className="field__label">Line height</span>
              <input
                className="input"
                type="number"
                min={1}
                max={2.5}
                step={0.05}
                value={s.lineHeight}
                onChange={num('lineHeight', 1, 2.5)}
              />
            </label>

            <label className="field">
              <span className="field__label">Scrollback lines</span>
              <input
                className="input"
                type="number"
                min={500}
                max={200000}
                step={500}
                value={s.scrollback}
                onChange={num('scrollback', 500, 200_000)}
              />
            </label>

            <label className="field">
              <span className="field__label">Cursor</span>
              <select
                className="select"
                value={s.cursorStyle}
                onChange={(e) => set('cursorStyle', e.target.value as Settings['cursorStyle'])}
              >
                <option value="bar">Bar</option>
                <option value="block">Block</option>
                <option value="underline">Underline</option>
              </select>
            </label>

            <div style={{ gridColumn: '1 / -1', display: 'flex', flexWrap: 'wrap', gap: '4px 24px' }}>
              <label className="check">
                <input
                  type="checkbox"
                  checked={s.cursorBlink}
                  onChange={(e) => set('cursorBlink', e.target.checked)}
                />
                Blink the cursor
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={s.copyOnSelect}
                  onChange={(e) => set('copyOnSelect', e.target.checked)}
                />
                Copy on select
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={s.rightClickPastes}
                  onChange={(e) => set('rightClickPastes', e.target.checked)}
                />
                Right click pastes
              </label>
            </div>
          </div>

          <div className="settings-section">Attention</div>
          <div className="settings-grid">
            <div style={{ gridColumn: '1 / -1' }}>
              <label className="check">
                <input
                  type="checkbox"
                  checked={s.bellIsAttention}
                  onChange={(e) => set('bellIsAttention', e.target.checked)}
                />
                A terminal bell means the pane wants me
              </label>
            </div>

            <label className="field">
              <span className="field__label">Idle means waiting after</span>
              <input
                className="input"
                type="number"
                min={0}
                max={120000}
                step={500}
                value={s.idleAttentionMs}
                onChange={num('idleAttentionMs', 0, 120_000)}
              />
              <span className="field__hint">
                Milliseconds of silence after a burst of output. 0 turns it off.
              </span>
            </label>
          </div>

          <div className="settings-section">Grid</div>
          <div className="settings-grid">
            <label className="field">
              <span className="field__label">Gutter</span>
              <input
                className="input"
                type="number"
                min={2}
                max={16}
                value={s.gutter}
                onChange={num('gutter', 2, 16)}
              />
            </label>

            <label className="field">
              <span className="field__label">Fullscreen inset</span>
              <input
                className="input"
                type="number"
                min={0}
                max={72}
                step={2}
                value={s.zoomInset}
                onChange={num('zoomInset', 0, 72)}
              />
              <span className="field__hint">How much grid stays visible around a zoomed pane.</span>
            </label>

            <label className="field">
              <span className="field__label">Attention glow</span>
              <input
                className="input"
                type="number"
                min={0}
                max={48}
                step={2}
                value={s.glowStrength}
                onChange={num('glowStrength', 0, 48)}
              />
            </label>

            <div style={{ gridColumn: '1 / -1' }}>
              <label className="check">
                <input
                  type="checkbox"
                  checked={s.showGridLines}
                  onChange={(e) => set('showGridLines', e.target.checked)}
                />
                Rule the 24px grid into the background
              </label>
            </div>
          </div>

          <div className="settings-section">Git</div>
          <div className="settings-grid">
            <label className="field">
              <span className="field__label">Poll while focused</span>
              <input
                className="input"
                type="number"
                min={1000}
                max={120000}
                step={1000}
                value={s.gitPollFocused}
                onChange={num('gitPollFocused', 1000, 120_000)}
              />
            </label>

            <label className="field">
              <span className="field__label">Poll in the background</span>
              <input
                className="input"
                type="number"
                min={5000}
                max={600000}
                step={5000}
                value={s.gitPollBlurred}
                onChange={num('gitPollBlurred', 5000, 600_000)}
              />
            </label>
            <p
              className="field__hint"
              style={{ gridColumn: '1 / -1', margin: 0 }}
            >
              DevLobby also re-reads a repository the moment its .git directory changes, so these
              only matter for changes made outside git itself.
            </p>
          </div>

          <div className="settings-section">Browser</div>
          <div className="settings-grid">
            <label className="field">
              <span className="field__label">Requests kept per pane</span>
              <input
                className="input"
                type="number"
                min={20}
                max={5000}
                step={20}
                value={s.browserNetLimit}
                onChange={num('browserNetLimit', 20, 5000)}
              />
              <span className="field__hint">Oldest first out. 400 is about two minutes of a busy page.</span>
            </label>

            <label className="field">
              <span className="field__label">Model for a new Claude session</span>
              <select
                className="select"
                value={s.claudeModel}
                onChange={(e) => set('claudeModel', e.target.value)}
              >
                <option value="">CLI default</option>
                {CLAUDE_MODELS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <span className="field__hint">
                Only used when DevLobby starts one for you. A session already running keeps the flags
                it was started with.
              </span>
            </label>

            <label className="field">
              <span className="field__label">Effort for a new Claude session</span>
              <select
                className="select"
                value={s.claudeEffort}
                onChange={(e) => set('claudeEffort', e.target.value)}
              >
                <option value="">CLI default</option>
                {CLAUDE_EFFORTS.map((level) => (
                  <option key={level} value={level}>
                    {level}
                  </option>
                ))}
              </select>
            </label>

            <div style={{ gridColumn: '1 / -1' }}>
              <label className="check">
                <input
                  type="checkbox"
                  checked={s.browserCaptureBodies}
                  onChange={(e) => set('browserCaptureBodies', e.target.checked)}
                />
                Keep response bodies for API calls, documents and anything that failed
              </label>
            </div>
          </div>

          <div className="settings-section">Session</div>
          <div className="settings-grid">
            <div style={{ gridColumn: '1 / -1', display: 'flex', flexDirection: 'column' }}>
              <label className="check">
                <input
                  type="checkbox"
                  checked={s.restoreSession}
                  onChange={(e) => set('restoreSession', e.target.checked)}
                />
                Reopen the last layout on launch
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={s.restoreRunsStartup}
                  onChange={(e) => set('restoreRunsStartup', e.target.checked)}
                />
                Restored terminals re-run their repository command
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={s.confirmClose}
                  onChange={(e) => set('confirmClose', e.target.checked)}
                />
                Ask before closing a pane whose program is still running
              </label>
            </div>
          </div>
        </div>

        <div className="dialog__foot">
          <button className="btn btn--ghost" onClick={() => actions.showOverlay({ kind: 'shortcuts' })}>
            Keyboard shortcuts
          </button>
          <span className="dialog__spacer" />
          <button className="btn btn--ghost" onClick={() => actions.closeOverlay()}>
            Done
          </button>
        </div>
      </div>
    </Overlay>
  )
}
