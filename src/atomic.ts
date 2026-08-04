import { rename, unlink } from "node:fs/promises";

/**
 * Zapis, który albo podmienia plik w całości, albo nie rusza go wcale.
 *
 * `Bun.write` to obcięcie + zapis, więc przerwanie w trakcie — Ctrl-C, brak miejsca,
 * OOM — zostawia plik obcięty. W tym repo to najgorsza możliwa awaria: dane
 * w `public/worlds/` są nieodtwarzalne (zasada #5), a uszkodzona migawka wywalała
 * `JSON.parse` przy budowie manifestu i trendów, czyli **i** ogon 1,6-godzinnej rundy,
 * **i** `bun run rebuild`, którym miałoby się to naprawić.
 *
 * `rename` w obrębie jednego katalogu jest na POSIX atomowy: czytelnik widzi albo
 * starą zawartość, albo nową, nigdy połowy.
 */
export async function writeAtomic(filePath: string, contents: string): Promise<void> {
  const tmp = `${filePath}.tmp`;
  try {
    await Bun.write(tmp, contents);
    await rename(tmp, filePath);
  } catch (e) {
    // Plik tymczasowy nie może zostać: `.tmp` w `public/worlds/` trafiłby na Pages,
    // a przy kolejnym zapisie udawał, że wszystko jest w porządku.
    await unlink(tmp).catch(() => {});
    throw e;
  }
}
