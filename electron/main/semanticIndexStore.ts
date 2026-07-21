/**
 * Faz 3 — semantik kod indeksi KALICILIĞI (proje bazında, userData'da).
 *
 * Renderer'daki VectorIndex eskiden yalnız bellekteydi → uygulama her açılışta boş
 * başlıyor, oturumun İLK aramasında TÜM dosyalar sıfırdan embed ediliyordu (yavaş).
 * Bu servis indeks anlık görüntüsünü (serialize edilmiş JSON) userData'ya yazar/okur;
 * proje adına göre dosyalanır. Yüklenince artımlı tazeleme kaldığı yerden sürer
 * (yalnız DEĞİŞEN dosyalar yeniden embed edilir).
 */
import { app } from 'electron'
import { join } from 'path'
import { readFile, writeFile, mkdir } from 'fs/promises'

/** userData/semantic-index/ altında saklanır (kullanıcının projesini KİRLETMEZ). */
function indexDir(): string {
  return join(app.getPath('userData'), 'semantic-index')
}

/** Proje adını güvenli bir dosya adına indirger. */
function keyToFile(key: string): string {
  const safe = (key || '').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'default'
  return join(indexDir(), safe + '.json')
}

/** Kayıtlı indeks anlık görüntüsünü döndür (yoksa/okunamıyorsa null). */
export async function loadSemanticIndex(key: string): Promise<string | null> {
  try {
    return await readFile(keyToFile(key), 'utf8')
  } catch {
    return null
  }
}

/** İndeks anlık görüntüsünü yaz. Aşırı büyük blob (disk şişmesin) ya da hata → false. */
export async function saveSemanticIndex(key: string, blob: string): Promise<boolean> {
  try {
    if (!blob || blob.length > 40 * 1024 * 1024) return false // 40MB tavan
    await mkdir(indexDir(), { recursive: true })
    await writeFile(keyToFile(key), blob, 'utf8')
    return true
  } catch {
    return false
  }
}
