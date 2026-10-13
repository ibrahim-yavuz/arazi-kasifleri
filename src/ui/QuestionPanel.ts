import type { QuizSystem } from '../gameplay/QuizSystem';
import { signDataUrl } from './TrafficSigns';
import { el } from './dom';
import type { Nav, Screen } from './dom';

/**
 * End-of-race quiz ("BİLGİ YARIŞMASI"), one question per "?" sign collected on the Bilgi
 * road. Layout: white header with the sign or
 * question, two dark-blue answer rows with yellow A/B badges, ✓/✗ marks below.
 */
export class QuestionPanel implements Screen {
  readonly root: HTMLElement;
  private readonly title: HTMLElement;
  private readonly head: HTMLElement;
  private readonly opts: HTMLElement[];
  private readonly ok: HTMLElement;
  private readonly no: HTMLElement;
  private readonly score: HTMLElement;
  private shownIndex = -1;

  constructor(parent: HTMLElement, private readonly onAnswer: (choice: 0 | 1) => void) {
    this.root = el('div', 'screen dim', undefined, parent);
    const wrap = el('div', 'question', undefined, this.root);
    this.title = el('div', 'quiz-title', '', wrap);
    this.head = el('div', 'q-head', '', wrap);
    this.opts = [0, 1].map((i) => {
      const o = el('div', 'q-opt', '', wrap);
      o.onclick = () => this.onAnswer(i as 0 | 1);
      return o;
    });
    const foot = el('div', 'q-foot', undefined, wrap);
    this.ok = el('div', 'q-mark ok', '✓', foot);
    this.no = el('div', 'q-mark no', '✗', foot);
    this.score = el('div', 'q-hint', '', wrap);
    el('div', 'q-hint', 'A veya B (ya da 1 / 2) tuşuyla cevapla. Doğru: −2 sn · Yanlış: +2 sn', wrap);
    this.hide();
  }

  update(quiz: QuizSystem): void {
    const q = quiz.current;
    if (!q) return;
    const idx = quiz.index;
    if (idx !== this.shownIndex) {
      this.shownIndex = idx;
      this.title.textContent = `BİLGİ YARIŞMASI · Soru ${idx + 1} / ${quiz.questions.length}`;
      this.head.innerHTML = '';
      if (q.sign) {
        const img = el('img', '', undefined, this.head);
        img.src = signDataUrl(q.sign);
        img.alt = 'Trafik işareti';
      }
      el('div', '', q.prompt, this.head);
      q.options.forEach((t, i) => {
        this.opts[i].innerHTML = `<span class="letter">${i === 0 ? 'A' : 'B'}</span>${t}`;
        this.opts[i].classList.remove('correct', 'wrong');
      });
      this.ok.classList.remove('on');
      this.no.classList.remove('on');
    }
    const a = quiz.currentAnswer;
    if (a) {
      this.opts[q.correct].classList.add('correct');
      if (!a.correct) this.opts[a.choice].classList.add('wrong');
      (a.correct ? this.ok : this.no).classList.add('on');
    }
    const d = quiz.totalDelta;
    this.score.textContent = `Doğru ${quiz.correctCount} · Yanlış ${quiz.wrongCount} · Süre ${d <= 0 ? '−' : '+'}${Math.abs(d)} sn`;
  }

  show(): void {
    this.shownIndex = -1;
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
  }

  /** Answers come only from A/B/1/2 (handled by Game) or clicks, never from arrows. */
  onNav(_n: Nav): void {}
}
