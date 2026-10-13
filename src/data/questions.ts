/**
 * Question database: two-option (A/B) questions, mostly about traffic signs (shown as a
 * picture) and some general knowledge.
 */

/** Procedurally drawn sign ids (see src/ui/TrafficSigns.ts). */
export type SignId =
  | 'girilmez'
  | 'dur'
  | 'yolVer'
  | 'yayaGecidi'
  | 'okulGecidi'
  | 'kamyonGiremez'
  | 'hizSiniri50'
  | 'solaDonulmez'
  | 'sagaDonulmez'
  | 'parkYasak'
  | 'kayganYol'
  | 'trafikIsigi'
  | 'bisikletYolu'
  | 'tasitTrafiginKapali'
  | 'ileriMecburi'
  | 'vahsiHayvan'
  | 'sagaTehlikeliViraj'
  | 'kavsak'
  | 'yolCalismasi'
  | 'otobusDuragi';

export interface Question {
  id: string;
  /** Question text. For sign questions this is shown under the picture. */
  prompt: string;
  sign?: SignId;
  options: [string, string];
  /** 0 = A, 1 = B. */
  correct: 0 | 1;
  category: 'trafik' | 'genel';
}

export const QUESTIONS: Question[] = [
  { id: 'q1', sign: 'girilmez', prompt: 'Bu levha ne anlama gelir?', options: ['Girilmez', 'Park yapılmaz'], correct: 0, category: 'trafik' },
  { id: 'q2', sign: 'dur', prompt: 'Bu levhayı görünce ne yapmalısın?', options: ['Yavaşlayıp geçmeliyim', 'Durmalıyım'], correct: 1, category: 'trafik' },
  { id: 'q3', sign: 'yolVer', prompt: 'Bu levha ne anlama gelir?', options: ['Yol ver', 'Tek yön'], correct: 0, category: 'trafik' },
  { id: 'q4', sign: 'yayaGecidi', prompt: 'Bu levha ne anlama gelir?', options: ['Okul geçidi', 'Yaya geçidi'], correct: 1, category: 'trafik' },
  { id: 'q5', sign: 'okulGecidi', prompt: 'Bu levha ne anlama gelir?', options: ['Okul geçidi', 'Oyun alanı'], correct: 0, category: 'trafik' },
  { id: 'q6', sign: 'kamyonGiremez', prompt: 'Bu levha ne anlama gelir?', options: ['Otobüs giremez', 'Kamyon giremez'], correct: 1, category: 'trafik' },
  { id: 'q7', sign: 'hizSiniri50', prompt: 'Bu levha ne anlama gelir?', options: ['Azami hız 50 km/sa', 'Asgari hız 50 km/sa'], correct: 0, category: 'trafik' },
  { id: 'q8', sign: 'solaDonulmez', prompt: 'Bu levha ne anlama gelir?', options: ['Sağa dönülmez', 'Sola dönülmez'], correct: 1, category: 'trafik' },
  { id: 'q9', sign: 'sagaDonulmez', prompt: 'Bu levha ne anlama gelir?', options: ['Sağa dönülmez', 'U dönüşü yapılmaz'], correct: 0, category: 'trafik' },
  { id: 'q10', sign: 'parkYasak', prompt: 'Bu levha ne anlama gelir?', options: ['Duraklamak ve park etmek yasak', 'Park etmek yasak'], correct: 1, category: 'trafik' },
  { id: 'q11', sign: 'kayganYol', prompt: 'Bu levha neyi uyarır?', options: ['Kaygan yol', 'Virajlı yol'], correct: 0, category: 'trafik' },
  { id: 'q12', sign: 'trafikIsigi', prompt: 'Bu levha neyi uyarır?', options: ['Demiryolu geçidi', 'Işıklı işaret cihazı'], correct: 1, category: 'trafik' },
  { id: 'q13', sign: 'bisikletYolu', prompt: 'Bu levha ne anlama gelir?', options: ['Bisiklet yolu', 'Motosiklet giremez'], correct: 0, category: 'trafik' },
  { id: 'q14', sign: 'tasitTrafiginKapali', prompt: 'Bu levha ne anlama gelir?', options: ['Girilmez', 'Taşıt trafiğine kapalı yol'], correct: 1, category: 'trafik' },
  { id: 'q15', sign: 'ileriMecburi', prompt: 'Bu levha ne anlama gelir?', options: ['İleri mecburi yön', 'Tek yönlü yol bitti'], correct: 0, category: 'trafik' },
  { id: 'q16', sign: 'vahsiHayvan', prompt: 'Bu levha neyi uyarır?', options: ['Evcil hayvan çıkabilir', 'Vahşi hayvan çıkabilir'], correct: 1, category: 'trafik' },
  { id: 'q17', sign: 'sagaTehlikeliViraj', prompt: 'Bu levha neyi uyarır?', options: ['Sağa tehlikeli viraj', 'Sola tehlikeli viraj'], correct: 0, category: 'trafik' },
  { id: 'q18', sign: 'kavsak', prompt: 'Bu levha neyi uyarır?', options: ['Ana yol', 'Kontrolsüz kavşak'], correct: 1, category: 'trafik' },
  { id: 'q19', sign: 'yolCalismasi', prompt: 'Bu levha neyi uyarır?', options: ['Yol çalışması', 'Yaya geçidi'], correct: 0, category: 'trafik' },
  { id: 'q20', sign: 'otobusDuragi', prompt: 'Bu levha ne anlama gelir?', options: ['Taksi durağı', 'Otobüs durağı'], correct: 1, category: 'trafik' },
  { id: 'q21', prompt: 'Trafik ışığında sarı yanıyorsa ne yapmalıyız?', options: ['Hızlanmalıyız', 'Durmaya hazırlanmalıyız'], correct: 1, category: 'trafik' },
  { id: 'q22', prompt: 'Karşıdan karşıya nereden geçmeliyiz?', options: ['Yaya geçidinden', 'Arabaların arasından'], correct: 0, category: 'trafik' },
  { id: 'q23', prompt: 'Arabada emniyet kemeri kimler takmalı?', options: ['Sadece sürücü', 'Araçtaki herkes'], correct: 1, category: 'trafik' },
  { id: 'q24', prompt: 'Bisiklete binerken ne takmalıyız?', options: ['Kask', 'Kulaklık'], correct: 0, category: 'trafik' },
  { id: 'q25', prompt: 'Türkiye\'nin başkenti neresidir?', options: ['İstanbul', 'Ankara'], correct: 1, category: 'genel' },
  { id: 'q26', prompt: 'Bir yılda kaç ay vardır?', options: ['12', '10'], correct: 0, category: 'genel' },
  { id: 'q27', prompt: 'İstanbul Boğazı hangi iki denizi birleştirir?', options: ['Karadeniz ile Akdeniz', 'Karadeniz ile Marmara'], correct: 1, category: 'genel' },
  { id: 'q28', prompt: 'Türkiye\'nin en yüksek dağı hangisidir?', options: ['Ağrı Dağı', 'Erciyes Dağı'], correct: 0, category: 'genel' },
  { id: 'q29', prompt: 'Su kaç derecede kaynar (deniz seviyesinde)?', options: ['50 °C', '100 °C'], correct: 1, category: 'genel' },
  { id: 'q30', prompt: 'Gökkuşağında kaç renk vardır?', options: ['7', '5'], correct: 0, category: 'genel' },
];
