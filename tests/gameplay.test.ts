import { describe, expect, it } from 'vitest';
import { TimerSystem, formatRaceTime } from '../src/gameplay/TimerSystem';
import { RaceManager } from '../src/gameplay/RaceManager';
import type { RaceGates } from '../src/gameplay/RaceManager';
import { CollectibleSystem, COLLECTIBLE_RULES } from '../src/gameplay/CollectibleSystem';
import { QUIZ_RULES, QuizSystem, pickQuestions, simulateQuiz } from '../src/gameplay/QuizSystem';
import { QUESTIONS } from '../src/data/questions';
import { crossGate } from '../src/world/CheckpointManager';
import type { Gate } from '../src/world/TrackBuilder';
import type { ChoiceRoute, RouteId } from '../src/world/TrackTypes';
import { InputState } from '../src/game/InputManager';

/** Gate across the −Z driving direction at z, centred on x. */
function gate(id: string, route: RouteId, index: number, x: number, z: number, halfWidth = 10): Gate {
  return { id, route, path: route, index, x, y: 0, z, tx: 0, tz: -1, halfWidth };
}

/**
 * Test course: start z=0, three parallel roads at x=-50/0/50, merge z=-200, finish z=-220.
 * With `forks = 2`, a second fork follows: roads z=-220…-370, merge z=-400, finish z=-420.
 */
function course(forks = 1): RaceGates {
  const roads = (r: ChoiceRoute, x: number, z0: number, n: number) =>
    [z0 - 20, z0 - 80, z0 - 150].map((z, i) => gate(`${r}${n}-${i}`, r, i, x, z));
  const leg = (z0: number, n: number) => ({
    routes: { hiz: roads('hiz', -50, z0, n), bilgi: roads('bilgi', 0, z0, n), cesaret: roads('cesaret', 50, z0, n) },
    merge: gate(`merge${n}`, 'mid', 0, 0, z0 - 200, 10),
  });
  const legs = forks === 1 ? [leg(0, 1)] : [leg(0, 1), leg(-200, 2)];
  return {
    startGate: gate('start', 'start', 0, 0, 0, 30),
    finishGate: gate('finish', 'final', 99, 0, forks === 1 ? -220 : -420, 10),
    legs,
  };
}

/** Drives a straight line from (x, z0) to (x, z1) in 1 m steps, collecting events. */
function drive(rm: RaceManager, x: number, z0: number, z1: number) {
  const events = [];
  const step = z1 < z0 ? -1 : 1;
  for (let z = z0; z !== z1; z += step) events.push(...rm.update({ x, z }, { x, z: z + step }));
  return events;
}

describe('TimerSystem', () => {
  it('only advances while running and applies bonuses/penalties', () => {
    const t = new TimerSystem();
    t.update(1);
    expect(t.elapsed).toBe(0);
    t.start();
    for (let i = 0; i < 60; i++) t.update(1 / 60);
    expect(t.elapsed).toBeCloseTo(1, 6);
    t.addBonus(3, 'kum saati');
    t.addPenalty(5, 'yanlış cevap');
    expect(t.total).toBeCloseTo(3, 6);
    t.stop();
    t.update(10);
    expect(t.elapsed).toBeCloseTo(1, 6);
    t.reset();
    expect(t.total).toBe(0);
    expect(t.adjustments).toHaveLength(0);
  });

  it('never shows negative time', () => {
    const t = new TimerSystem();
    t.addBonus(10, 'x');
    expect(t.total).toBe(0);
  });

  it('formats mm:ss:cc for the HUD', () => {
    expect(formatRaceTime(0)).toBe('00:00:00');
    expect(formatRaceTime(8.44)).toBe('00:08:44');
    expect(formatRaceTime(74.1)).toBe('01:14:10');
  });
});

describe('crossGate', () => {
  const g = gate('g', 'hiz', 0, 0, 0, 5);
  it('detects forward and backward crossings', () => {
    expect(crossGate(g, { x: 0, z: 1 }, { x: 0, z: -1 })).toBe('forward');
    expect(crossGate(g, { x: 0, z: -1 }, { x: 0, z: 1 })).toBe('backward');
  });
  it('ignores movement that does not cross or passes outside the gate width', () => {
    expect(crossGate(g, { x: 0, z: 3 }, { x: 0, z: 1 })).toBeNull();
    expect(crossGate(g, { x: 8, z: 1 }, { x: 8, z: -1 })).toBeNull();
  });
});

describe('RaceManager', () => {
  it('selects the route through its entry gate and completes a valid race', () => {
    const rm = new RaceManager(course());
    const ev = drive(rm, 0, 5, -230);
    const types = ev.map((e) => e.type);
    expect(types[0]).toBe('startLine');
    expect(ev.find((e) => e.type === 'routeSelected')).toMatchObject({ route: 'bilgi', switched: false });
    expect(types.filter((t) => t === 'checkpoint')).toHaveLength(3);
    expect(types).toContain('merge');
    expect(types).toContain('finish');
    expect(rm.finished).toBe(true);
    expect(rm.progressFraction()).toBe(1);
  });

  it('rejects the finish when no route was driven', () => {
    const rm = new RaceManager(course());
    // Drive outside every route gate (x=120) and then cross the finish only.
    drive(rm, 120, 5, -190);
    const ev = drive(rm, 0, -210, -230);
    expect(ev).toContainEqual({ type: 'finishRejected', reason: 'noRoute' });
    expect(rm.finished).toBe(false);
  });

  it('rejects the finish when route checkpoints were skipped', () => {
    const rm = new RaceManager(course());
    drive(rm, 50, 5, -30); // enter Cesaret
    expect(rm.route).toBe('cesaret');
    const ev = drive(rm, 120, -30, -190); // skip its gates
    expect(ev).toHaveLength(0);
    const fin = drive(rm, 0, -195, -230);
    expect(fin.some((e) => e.type === 'finishRejected')).toBe(true);
    expect(rm.finished).toBe(false);
  });

  it('rejects a finish crossed in the wrong direction', () => {
    const rm = new RaceManager(course());
    drive(rm, 0, 5, -219);
    const ev = drive(rm, 0, -230, -210);
    expect(ev).toContainEqual({ type: 'finishRejected', reason: 'wrongDirection' });
  });

  it('switches route when another entry gate is crossed and requires that route', () => {
    const rm = new RaceManager(course());
    drive(rm, -50, 5, -30); // Hız
    expect(rm.route).toBe('hiz');
    const ev = drive(rm, 50, -15, -25); // Cesaret entry
    expect(ev.find((e) => e.type === 'routeSelected')).toMatchObject({ route: 'cesaret', switched: true });
    expect(rm.progress[0]).toBe(1);
    drive(rm, 50, -25, -160);
    expect(rm.routeComplete).toBe(true);
  });

  it('flags a missed checkpoint and keeps the respawn gate at the last valid one', () => {
    const rm = new RaceManager(course());
    drive(rm, 0, 5, -30);
    drive(rm, 120, -30, -100); // around gate 1 outside its width
    const ev = drive(rm, 0, -140, -160); // gate 2 without gate 1
    expect(ev).toContainEqual({ type: 'missedCheckpoint' });
    expect(rm.lastGate.id).toBe('bilgi1-0');
    expect(rm.nextGate?.id).toBe('bilgi1-1');
  });

  it('runs two forks in order, with a separate road choice at each', () => {
    const rm = new RaceManager(course(2));
    drive(rm, -50, 5, -190); // Hız at fork 1
    drive(rm, 0, -190, -215); // merge 1
    expect(rm.leg).toBe(1);
    expect(rm.route).toBeNull();
    // Finish line of a 1-fork course would be here; it must not count yet.
    drive(rm, 50, -215, -390); // Cesaret at fork 2
    const ev = drive(rm, 0, -390, -430);
    expect(ev.map((e) => e.type)).toEqual(['merge', 'finish']);
    expect(rm.routes).toEqual(['hiz', 'cesaret']);
    expect(rm.passed).toEqual(['hiz1-0', 'hiz1-1', 'hiz1-2', 'merge1', 'cesaret2-0', 'cesaret2-1', 'cesaret2-2', 'merge2', 'finish']);
    expect(rm.progressFraction()).toBe(1);
  });

  it('rejects the finish when the second fork was skipped', () => {
    const rm = new RaceManager(course(2));
    drive(rm, 0, 5, -215);
    const ev = drive(rm, 120, -215, -410);
    expect(ev).toHaveLength(0);
    const fin = drive(rm, 0, -410, -430);
    expect(fin).toContainEqual({ type: 'finishRejected', reason: 'noRoute' });
    expect(rm.finished).toBe(false);
  });

  it('resets all progression state', () => {
    const rm = new RaceManager(course());
    drive(rm, 0, 5, -230);
    rm.reset();
    expect(rm.finished).toBe(false);
    expect(rm.route).toBeNull();
    expect(rm.passed).toHaveLength(0);
    expect(rm.lastGate.id).toBe('start');
  });
});

describe('CollectibleSystem', () => {
  const items = [
    { id: 'h', kind: 'hourglass' as const, x: 0, y: 1, z: 0 },
    { id: 's', kind: 'sign' as const, x: 10, y: 1, z: 0 },
    { id: 't', kind: 'turbo' as const, x: 20, y: 1, z: 0 },
    { id: 'q', kind: 'question' as const, x: 30, y: 1, z: 0 },
  ];
  it('collects within the radius and applies effects once', () => {
    const cs = new CollectibleSystem(items);
    expect(cs.update(0, 1, COLLECTIBLE_RULES.radius + 0.5)).toHaveLength(0);
    const r = cs.update(0, 1, 1);
    expect(r).toHaveLength(1);
    expect(r[0].timeBonus).toBe(COLLECTIBLE_RULES.hourglassBonusSeconds);
    expect(cs.update(0, 1, 0)).toHaveLength(0); // no duplicates
    expect(cs.update(10, 1, 0)[0].points).toBe(COLLECTIBLE_RULES.signPoints);
    expect(cs.update(20, 1, 0)[0].turboSeconds).toBe(COLLECTIBLE_RULES.turboSeconds);
    const q = cs.update(30, 1, 0)[0];
    expect(q.timeBonus + q.points + q.turboSeconds).toBe(0); // "?" only counts for the quiz
    expect(cs.totalCollected).toBe(4);
    expect(cs.counts).toEqual({ hourglass: 1, sign: 1, turbo: 1, question: 1 });
    cs.reset();
    expect(cs.totalCollected).toBe(0);
    expect(cs.update(0, 1, 0)).toHaveLength(1);
  });
});

describe('QuizSystem (end-of-race questions)', () => {
  it('asks one distinct question per collected "?" and adjusts time', () => {
    const quiz = new QuizSystem(QUESTIONS, 3, 42);
    expect(quiz.questions).toHaveLength(3);
    expect(new Set(quiz.questions.map((q) => q.id)).size).toBe(3);
    const first = quiz.current!;
    expect(quiz.index).toBe(0);
    const a = quiz.answer(first.correct)!;
    expect(a).toEqual({ choice: first.correct, correct: true, delta: -QUIZ_RULES.correctBonus });
    expect(quiz.answer(0)).toBeNull(); // locked during feedback
    expect(quiz.current).toBe(first); // still showing feedback for question 1
    quiz.update(QUIZ_RULES.feedbackTime + 0.01);
    const second = quiz.current!;
    expect(quiz.index).toBe(1);
    expect(quiz.answer((1 - second.correct) as 0 | 1)!.delta).toBe(QUIZ_RULES.wrongPenalty);
    quiz.update(5);
    quiz.answer(quiz.current!.correct);
    expect(quiz.finished).toBe(false); // feedback still on screen
    quiz.update(5);
    expect(quiz.finished).toBe(true);
    expect(quiz.current).toBeNull();
    expect(quiz.correctCount).toBe(2);
    expect(quiz.wrongCount).toBe(1);
    expect(quiz.totalDelta).toBe(-QUIZ_RULES.correctBonus * 2 + QUIZ_RULES.wrongPenalty);
  });

  it('an empty quiz is immediately finished', () => {
    const quiz = new QuizSystem(QUESTIONS, 0, 1);
    expect(quiz.finished).toBe(true);
    expect(quiz.answer(0)).toBeNull();
  });

  it('picks deterministically and repeats only beyond the database size', () => {
    expect(pickQuestions(QUESTIONS, 5, 9).map((q) => q.id)).toEqual(pickQuestions(QUESTIONS, 5, 9).map((q) => q.id));
    expect(pickQuestions(QUESTIONS, QUESTIONS.length + 2, 3)).toHaveLength(QUESTIONS.length + 2);
  });

  it('simulated AI quiz uses the accuracy', () => {
    expect(simulateQuiz(4, 1, () => 0.5)).toBe(-4 * QUIZ_RULES.correctBonus);
    expect(simulateQuiz(4, 0, () => 0.5)).toBe(4 * QUIZ_RULES.wrongPenalty);
  });

  it('every question has two options and a valid answer', () => {
    for (const q of QUESTIONS) {
      expect(q.options).toHaveLength(2);
      expect([0, 1]).toContain(q.correct);
      expect(q.prompt.length).toBeGreaterThan(3);
    }
    expect(new Set(QUESTIONS.map((q) => q.id)).size).toBe(QUESTIONS.length);
  });
});

describe('InputState', () => {
  it('tracks held keys and edge-triggered presses', () => {
    const s = new InputState();
    s.keyDown('ArrowUp');
    s.keyDown('KeyD');
    expect(s.driving()).toEqual({ throttle: 1, brake: 0, steer: 1, handbrake: false });
    s.keyDown('KeyA');
    expect(s.driving().steer).toBe(0);
    s.keyDown('KeyR');
    expect(s.consume('reset')).toBe(true);
    expect(s.consume('reset')).toBe(false);
    s.keyDown('KeyR', true); // auto-repeat is not a new press
    expect(s.wasPressed('reset')).toBe(false);
    s.endFrame();
    s.keyUp('KeyD');
    s.keyUp('KeyA');
    expect(s.driving().steer).toBe(0);
    s.keyDown('Space');
    expect(s.driving().handbrake).toBe(true);
    s.clear();
    expect(s.driving()).toEqual({ throttle: 0, brake: 0, steer: 0, handbrake: false });
  });
});
