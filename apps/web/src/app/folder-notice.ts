/**
 * "Save as project folder" and the git notice (ADR-101 amendment): what the app can know, and
 * only that. A browser cannot see where a downloaded `.wrencad` lands, and a save-file picker
 * hands back a file handle with no way to its parent folder, so "this `.wrencad` is going into a
 * git repo" is not observable from the file itself. What is known: the project is linked to a git
 * connection (a git host, or a local folder that is a working tree). The notice appears only then.
 */

export const FOLDER_UNSUPPORTED =
  'Saving to a folder needs Chrome or Edge on a computer. Elsewhere, connect a git host or cloud drive in Connections.';

export const GIT_NOTICE_KEY = 'wren:git-notice-off';

type Pickers = { showDirectoryPicker?: unknown };

/** The File System Access directory picker exists (Chromium on a computer; not Safari or Firefox). */
export function folderPickerSupported(g: object = globalThis): boolean {
  return typeof (g as Pickers).showDirectoryPicker === 'function';
}

/** Project kinds (sync controller) that live in a git repository. */
export function isGitProject(kind: string): boolean {
  return kind === 'git' || kind === 'localGit';
}

/** Whether the inline git notice is offered: a git project, a picker to act on, not silenced. */
export function showGitNotice(o: {
  projectKind: string;
  supported: boolean;
  silenced: boolean;
}): boolean {
  return isGitProject(o.projectKind) && o.supported && !o.silenced;
}

type Store = Pick<Storage, 'getItem' | 'setItem'>;

export function gitNoticeSilenced(store?: Store): boolean {
  try {
    return (store ?? localStorage).getItem(GIT_NOTICE_KEY) === '1';
  } catch {
    return false;
  }
}

export function silenceGitNotice(store?: Store): void {
  try {
    (store ?? localStorage).setItem(GIT_NOTICE_KEY, '1');
  } catch {
    /* storage unavailable: the notice stays dismissible for this session only */
  }
}
