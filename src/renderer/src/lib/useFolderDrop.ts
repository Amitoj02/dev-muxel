/**
 * Drop a folder anywhere on the window to declare it and open a terminal in it.
 *
 * `File.path` was removed in Electron 32, so the only way to recover a dropped
 * folder's real path is `webUtils.getPathForFile`, which is bridged through the
 * preload. Without that, `dataTransfer.files[0].path` is simply `undefined`.
 */

import { useEffect } from 'react'
import { actions, getState, normalisePath } from '../state/hooks'

export function useFolderDrop(): void {
  useEffect(() => {
    const onDragOver = (e: DragEvent): void => {
      if (!e.dataTransfer) return
      // Without this the browser navigates to the dropped file and the app
      // disappears — there is no going back from that in a frameless window.
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    }

    const onDrop = (e: DragEvent): void => {
      e.preventDefault()
      const files = e.dataTransfer?.files
      if (!files || files.length === 0) return

      void (async () => {
        const state = getState()
        const known = new Set(state.repos.map((r) => normalisePath(r.path)))
        let added = 0
        let skippedFiles = 0
        let firstId: string | null = null

        for (const file of Array.from(files)) {
          const target = window.devmuxel.pathForFile(file)
          if (!target) continue

          const probe = await window.devmuxel.repo.probe(target)

          // A dropped file inside a repo means the repo. A dropped file that is
          // not in one has no folder to open, and adding it would leave a repo
          // whose "path" is a file — every terminal on it would fail to spawn.
          const dir = probe.root ?? (probe.isDirectory ? target : null)
          if (!dir) {
            skippedFiles += 1
            continue
          }
          if (known.has(normalisePath(dir))) continue

          const repo = actions.addRepo({ name: probe.name, path: dir })
          if (repo) {
            known.add(normalisePath(dir))
            added += 1
            firstId ??= repo.id
          }
        }

        if (added === 0) {
          actions.toast(
            skippedFiles > 0 ? 'Drop a folder, not a file' : 'Already declared',
            skippedFiles > 0 ? 'error' : 'info'
          )
          return
        }
        if (added === 1 && firstId) {
          actions.addTerminal({ repoId: firstId })
        } else {
          actions.toast(`Added ${added} repositories`)
          actions.showOverlay({ kind: 'repositories' })
        }
      })()
    }

    window.addEventListener('dragover', onDragOver)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('drop', onDrop)
    }
  }, [])
}
