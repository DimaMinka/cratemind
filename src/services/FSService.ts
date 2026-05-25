/**
 * FSService.ts
 *
 * Manages file system watching (chokidar), the task queue (p-queue),
 * audio routing (move/copy), and system-level audio previewing.
 */

export async function initWatcher(): Promise<void> {
  // TODO: Implement chokidar watcher and file queue processing
}

export async function route(_srcPath: string, _selectedFolders: string[]): Promise<void> {
  // TODO: Implement copy / move routing logic
}

export function previewAudio(_filepath: string): void {
  // TODO: Spawn default platform media player asynchronously
}
