import { storage } from "@/lib/firebase";
import { ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";

export async function uploadBlob(blob: Blob, path: string): Promise<string> {
  const storageRef = ref(storage, path);
  await uploadBytes(storageRef, blob);
  return getDownloadURL(storageRef);
}

export async function uploadImage(
  file: File,
  path: string
): Promise<string> {
  const storageRef = ref(storage, path);
  await uploadBytes(storageRef, file);
  return getDownloadURL(storageRef);
}

/**
 * Vidéo d'exercice — même mécanique que l'image, mais un autre préfixe Storage :
 * les règles limitent `exercices/` aux images (10 Mo) et `exercices_videos/` aux
 * vidéos (50 Mo). Un chemin sans règle est refusé en silence par Storage.
 */
export async function uploadVideo(
  file: File,
  path: string
): Promise<string> {
  const storageRef = ref(storage, path);
  await uploadBytes(storageRef, file);
  return getDownloadURL(storageRef);
}

/** Supprime un fichier du Storage à partir de son URL de download (image comme vidéo). */
export async function deleteImage(url: string): Promise<void> {
  try {
    const storageRef = ref(storage, url);
    await deleteObject(storageRef);
  } catch {
    // Ignore — image may already be deleted or URL not from Storage
  }
}
