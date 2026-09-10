// Files this app does not own.
//
// **W is the file system; the Notebook is one directory in it.** Reading a
// downloaded file is still W's business — it is bytes on disk — but it is not
// the notebook's, and giving `Notebook` a way to read arbitrary paths would
// hand every caller of it that reach. So the reach lives here, in its own file,
// where the layering test can see it (MC6).
//
// Read only. There is no write here and there should not be: a file outside the
// notebook is imported by COPYING it in, not by Tephra learning to save over
// things it does not manage.

import { readFile, stat } from 'node:fs/promises'

/** The text of a file, or null if it is not there or cannot be read as text. */
export async function readOutside(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

/**
 * The bytes of a file, or null if it is not there (R7).
 *
 * **A picture is not text**, and a PNG read as UTF-8 comes back as mojibake
 * rather than as an error — which is a corrupt attachment that looks like a
 * successful read. So the two readers are separate and each says which it is.
 */
export async function readOutsideBytes(path: string): Promise<Uint8Array | null> {
  try {
    return await readFile(path)
  } catch {
    return null
  }
}

/** Whether there is a readable file there. */
export async function outsideExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}
