import type { ExportFolderProps } from '@wren-cad/ui';
import { useState } from 'react';
import {
  FOLDER_UNSUPPORTED,
  folderPickerSupported,
  gitNoticeSilenced,
  showGitNotice,
  silenceGitNotice,
} from './folder-notice';
import { exportFolder } from './files';
import { useObservable } from './observable';
import type { Workbench } from './workbench';

/** What the export form needs for "Save as project folder": availability, refusal, git notice. */
export function useExportFolder(wb: Workbench): {
  unavailable: { folder: string } | Record<string, never>;
  folder: ExportFolderProps;
} {
  const bar = useObservable(wb.projectBar);
  const error = useObservable(wb.folderError);
  const [silenced, setSilenced] = useState(() => gitNoticeSilenced());
  const supported = folderPickerSupported();
  const notice = showGitNotice({ projectKind: bar.kind ?? 'local', supported, silenced });
  return {
    unavailable: supported ? {} : { folder: FOLDER_UNSUPPORTED },
    folder: {
      ...(error ? { error: error.message } : {}),
      ...(error?.replaceable ? { onReplace: () => void exportFolder(wb, { replace: true }) } : {}),
      ...(notice
        ? {
            gitNotice: {
              onNeverShow: () => {
                silenceGitNotice();
                setSilenced(true);
              },
            },
          }
        : {}),
    },
  };
}
