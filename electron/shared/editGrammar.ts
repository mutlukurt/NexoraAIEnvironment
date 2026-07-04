/**
 * UPDATE turları için GBNF grameri (roadmap 2.1).
 *
 * "Cerrahi düzenleme" kuralları artık rica değil, ÖRNEKLEYİCİ SEVİYESİNDE
 * matematiksel kısıt: llama-server'a giden istek bu gramerle örneklenir ve
 * model formata uymayan tokeni ÜRETEMEZ. Watchdog'un yakaladığı sınıf
 * (dev SEARCH bloğuna gizlenmiş tam yeniden yazım) burada imkânsızlaşır:
 *
 *  - SEARCH en fazla 12 satır (prompt kuralıyla aynı sınır, artık zorunlu)
 *  - edit hedefi yalnızca GERÇEKTEN VAR OLAN dosya yolları (gramere gömülür):
 *    yol uydurmak/yanlış yazmak da imkânsız
 *  - yeni dosya, [DELETE] ve agent direktifleri ([PKG]/[FONT]/[FETCH]/[RUN]/
 *    [DEV]) gramer alternatifi olarak serbest
 *  - saf soru turları için sınırlı kaçış: "ANSWER: " + en çok 8 satır —
 *    soru soran kullanıcı bozuk deneyim yaşamaz, ama serbest metin dalı
 *    sınırlı olduğu için "prose'a kaçarak" kuralı delmek de mümkün değil
 *
 * Yalnızca UPDATE turlarında kullanılır; yeni proje üretimi, plan ve brief
 * turları serbest kalır. Worker (node-llama-cpp) motoru grameri yok sayar —
 * orada renderer'daki streaming watchdog korumaya devam eder.
 */

/** GBNF string literali içinde güvenli olmayan karakterleri temizle. */
function safeLiteral(s: string): string {
  return s.replace(/[\\"\n\r]/g, '')
}

/** n adet opsiyonel tekrar: GBNF {m,n} aralık desteğine güvenmeden sınır koyar. */
function rep(rule: string, required: number, optional: number): string {
  const parts = [...Array<string>(required).fill(rule), ...Array<string>(optional).fill(rule + '?')]
  return parts.join(' ')
}

export function buildEditGrammar(existingPaths: string[]): string {
  const paths = existingPaths.map(safeLiteral).filter((p) => p.length > 0)
  // Var olan yol listesi boşsa (teorik) genel yol desenine düş.
  const epath = paths.length > 0 ? paths.map((p) => `"${p}"`).join(' | ') : 'npath'

  // SEARCH: 1 zorunlu + 11 opsiyonel satır = en çok 12 (prompt kuralı, zorunlu).
  // REPLACE: en çok 40 satır — tam yeniden yazım REPLACE'e de saklanamaz;
  // daha büyük içerik yeni dosya olarak gelmeli.
  const searchLines = rep('cline', 1, 11)
  const replaceLines = rep('cline', 0, 40)

  // Dikkat edilen iki gramer deliği (canlı testte yakalandı):
  //  - newfile dili [a-z]+ olsaydı "edit" de dil sayılır, model "\`\`\`edit yol"
  //    yazıp SEARCH işaretçisini atlayarak newfile dalında yaşardı. Diller
  //    açık listedir ("edit" yok) → "\`\`\`edit " sonrası SEARCH ZORUNLU.
  //  - answer satırları backtick ile başlayabilseydi 8 satırlık sahte-edit
  //    alanı doğardı; cevap satırı backtick ile başlayamaz.
  // KRİTİK: son öğeden sonra newline ZORUNLU OLMAMALI — model kapanış
  // fence'inin hemen ardından EOS basmak ister; EOS maskelenirse duramaz ve
  // "[END_OF_TEXT]" metnini token limitine kadar kusar (canlıda görüldü).
  // Bu yüzden öğeler arası ayraç newline'dır ama sondaki opsiyoneldir.
  return `root ::= answer | changes
answer ::= "ANSWER: " ${rep('aline', 1, 7)}
aline ::= [^\`\\n] [^\\n]* "\\n" | "\\n"
changes ::= item (ws item)* ws?
item ::= edit | newfile | del | directive
edit ::= "\`\`\`edit " epath "\\n<<<<<<< SEARCH\\n" ${searchLines} "=======\\n" ${replaceLines} ">>>>>>> REPLACE\\n\`\`\`"
newfile ::= "\`\`\`" lang " " npath "\\n" cline+ "\`\`\`"
lang ::= "tsx" | "ts" | "jsx" | "js" | "css" | "html" | "json" | "md" | "svg" | "py" | "yaml" | "yml" | "toml" | "xml" | "txt"
del ::= "[DELETE] " epath
directive ::= "[" ("PKG" | "FONT" | "FETCH" | "RUN" | "DEV") "]" [^\\n]*
cline ::= [^\\n]* "\\n"
epath ::= ${epath}
npath ::= [A-Za-z0-9._@/-]+ "." ("tsx" | "ts" | "jsx" | "js" | "css" | "html" | "json" | "md" | "svg" | "py" | "yaml" | "yml" | "toml" | "xml" | "txt")
ws ::= "\\n" [\\n]*`
}

/**
 * Planlı üretimde TEK dosya turu (roadmap 2.2): çıktı, tam olarak istenen
 * yola ait TEK fenced blok olmak zorunda. Model başka dosya yazamaz, gevezelik
 * edemez, yolu değiştiremez.
 */
export function buildFileGrammar(path: string): string {
  const p = safeLiteral(path)
  // Sondaki newline opsiyonel: kapanış fence'inden hemen sonra EOS legal
  // olmalı (zorunlu newline EOS'u maskeleyip [END_OF_TEXT] spiraline sokar).
  return `root ::= "\`\`\`" lang " " "${p}" "\\n" cline+ "\`\`\`" ws?
lang ::= "tsx" | "ts" | "jsx" | "js" | "css" | "html" | "json" | "md" | "svg" | "py" | "yaml" | "yml" | "toml" | "xml" | "txt"
cline ::= [^\\n]* "\\n"
ws ::= "\\n" [\\n]*`
}

/**
 * Plan turu grameri (roadmap 2.2): her satır "N. yol — açıklama" biçiminde,
 * 2-12 dosya. applyPlan bu listeyi deterministik ayrıştırıp dosya-dosya
 * üretim döngüsünü başlatır. (Satır düzeyinde ?-zinciri güvenlidir; karakter
 * düzeyindekiler llama.cpp gramer-durumunu patlatıyor — bkz. npath dersi.)
 */
export function buildPlanGrammar(): string {
  const lines = rep('pline', 2, 10)
  return `root ::= ${lines}
pline ::= num ". " fpath sep [^\\n]+ "\\n"
num ::= [1-9] | "1" [0-2]
sep ::= " — " | " - " | " – " | ": "
fpath ::= [A-Za-z0-9._@/-]+ "." ("tsx" | "ts" | "jsx" | "js" | "css" | "html" | "json" | "md" | "svg")`
}
