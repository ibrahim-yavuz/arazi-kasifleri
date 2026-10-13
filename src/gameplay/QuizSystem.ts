import type { Question } from '../data/questions';
import { mulberry32 } from '../physics/math';

/** Time effect of quiz answers (design choice). */
export const QUIZ_RULES = {
  correctBonus: 2,
  wrongPenalty: 2,
  /** Seconds the ✓/✗ feedback stays on screen before the next question. */
  feedbackTime: 1.4,
};

/** Picks `count` distinct questions (repeats only if count exceeds the database). */
export function pickQuestions(db: Question[], count: number, seed: number): Question[] {
  const rnd = mulberry32(seed);
  const order = db.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return Array.from({ length: count }, (_, i) => db[order[i % order.length]]);
}

export interface QuizAnswer {
  choice: 0 | 1;
  correct: boolean;
  /** Time adjustment: negative = bonus, positive = penalty. */
  delta: number;
}

/**
 * End-of-race quiz: one question per "?" sign collected on the Bilgi road. The race is
 * already over, so nothing is paused; the answers adjust the final time.
 */
export class QuizSystem {
  readonly questions: Question[];
  readonly answers: QuizAnswer[] = [];
  /** Seconds of feedback left for the last answer (0 = waiting for an answer). */
  feedbackLeft = 0;

  constructor(db: Question[], count: number, seed: number) {
    this.questions = pickQuestions(db, count, seed);
  }

  /** Index of the question on screen. */
  get index(): number {
    return this.feedbackLeft > 0 ? this.answers.length - 1 : this.answers.length;
  }

  get current(): Question | null {
    return this.questions[this.index] ?? null;
  }

  /** Answer shown for the current question (during feedback), if any. */
  get currentAnswer(): QuizAnswer | null {
    return this.feedbackLeft > 0 ? this.answers[this.answers.length - 1] : null;
  }

  get finished(): boolean {
    return this.answers.length >= this.questions.length && this.feedbackLeft <= 0;
  }

  get correctCount(): number {
    return this.answers.filter((a) => a.correct).length;
  }

  get wrongCount(): number {
    return this.answers.length - this.correctCount;
  }

  /** Sum of all time adjustments so far (negative = time saved). */
  get totalDelta(): number {
    return this.answers.reduce((s, a) => s + a.delta, 0);
  }

  answer(choice: 0 | 1): QuizAnswer | null {
    if (this.feedbackLeft > 0) return null;
    const q = this.questions[this.answers.length];
    if (!q) return null;
    const correct = q.correct === choice;
    const a: QuizAnswer = { choice, correct, delta: correct ? -QUIZ_RULES.correctBonus : QUIZ_RULES.wrongPenalty };
    this.answers.push(a);
    this.feedbackLeft = QUIZ_RULES.feedbackTime;
    return a;
  }

  update(dt: number): void {
    if (this.feedbackLeft > 0) this.feedbackLeft = Math.max(0, this.feedbackLeft - dt);
  }
}

/** Simulated quiz result for an AI rival (seconds, negative = bonus). */
export function simulateQuiz(count: number, accuracy: number, rnd: () => number): number {
  let d = 0;
  for (let i = 0; i < count; i++) d += rnd() < accuracy ? -QUIZ_RULES.correctBonus : QUIZ_RULES.wrongPenalty;
  return d;
}
