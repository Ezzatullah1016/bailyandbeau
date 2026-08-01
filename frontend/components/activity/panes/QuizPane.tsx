'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronLeft, ChevronRight, Sparkles, X } from 'lucide-react';

import { usePaneMotion } from './motion';
import type { PaneProps, QuizQuestion } from './shared';

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

/** Shared option button. Both the 1.1 and 1.0 paths render through this. */
function OptionButton({
  index,
  text,
  state,
  onSelect,
}: {
  index: number;
  text: string;
  state: 'idle' | 'selected' | 'correct' | 'wrong';
  onSelect: () => void;
}) {
  const m = usePaneMotion();

  // Idle options take the room's own surface tokens rather than a hardcoded
  // white: sitting directly on the canvas, they have to work on a dark book
  // theme too. Verdict states keep literal brand colours — right and wrong must
  // read the same in every book.
  const shell =
    state === 'correct'
      ? 'border-brand-teal bg-brand-teal/15'
      : state === 'wrong'
        ? 'border-brand-pink bg-brand-pink/10'
        : state === 'selected'
          ? 'border-brand-purple bg-brand-blush/80'
          : 'hover:border-brand-purple';

  const badge =
    state === 'correct'
      ? 'bg-brand-teal text-white'
      : state === 'wrong'
        ? 'bg-brand-pink text-white'
        : state === 'selected'
          ? 'bg-brand-purple text-white'
          : 'bg-brand-purple/10 text-brand-purple';

  /*
   * Two elements on purpose.
   *
   * An explicit `animate` prop stops framer-motion inheriting variants from the
   * parent — but `initial` is still inherited. Putting the shake/pop directly on
   * this button meant it kept the parent's `hidden` (opacity: 0) while the
   * `animate` object, which only carries `scale`/`x`, never animated opacity
   * back. The options animated perfectly, invisibly.
   *
   * So: the outer element owns entrance and stays at opacity 1, and a wrapper
   * inside owns the state reaction. A feedback animation must never own opacity.
   */
  return (
    <motion.button
      type="button"
      onClick={onSelect}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={m.spring}
      whileHover={state === 'idle' ? m.hover : undefined}
      whileTap={m.press}
      className={`flex min-h-[56px] w-full cursor-pointer items-center gap-3 rounded-2xl border-2 px-4 py-3 text-left font-medium transition-colors ${shell}`}
      style={
        state === 'idle'
          ? {
              background: 'var(--activity-paper)',
              borderColor: 'var(--room-chrome-line)',
              color: 'var(--room-ink)',
            }
          : { color: 'var(--room-ink)' }
      }
    >
      <motion.span
        className="flex min-w-0 flex-1 items-center gap-3"
        // Colour alone is easy to miss and fails for a colour-blind child, so
        // the movement carries the verdict too.
        animate={state === 'wrong' ? m.nudge : state === 'correct' ? m.celebrate : undefined}
      >
        <span
          className={`font-baloo grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-bold transition-colors ${badge}`}
        >
          {state === 'correct' ? (
            <Check className="h-4 w-4" strokeWidth={3} />
          ) : state === 'wrong' ? (
            <X className="h-4 w-4" strokeWidth={3} />
          ) : (
            LETTERS[index] ?? index + 1
          )}
        </span>
        <span className="min-w-0 flex-1">{text}</span>
      </motion.span>
    </motion.button>
  );
}

/** Correct / not-quite card. Replaces a bare coloured `<p>`. */
function FeedbackCard({ kind, text }: { kind: 'correct' | 'wrong'; text: string }) {
  const m = usePaneMotion();
  const correct = kind === 'correct';
  return (
    <motion.div
      variants={m.popIn}
      initial="hidden"
      animate="show"
      exit="exit"
      className={`flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-bold ${
        correct ? 'bg-brand-teal/15 text-brand-teal' : 'bg-brand-pink/10 text-brand-pink'
      }`}
      role="status"
    >
      {correct ? <Sparkles className="h-4 w-4 shrink-0" /> : <X className="h-4 w-4 shrink-0" />}
      {text}
    </motion.div>
  );
}

export function QuizPane({ payload, role: hostRole, state, patchCurrent }: PaneProps) {
  const m = usePaneMotion();
  const revealMode = String(payload.reveal_mode ?? 'instant');
  const questions = payload.questions as QuizQuestion[] | undefined;

  // ── 1.1: multi-question sequence ──────────────────────────────────────────
  if (Array.isArray(questions) && questions.length > 0) {
    const qs = questions;
    const qIndex = Math.min(Number(state.qIndex ?? 0), qs.length - 1);
    const answers = (state.answers as Record<string, number>) ?? {};
    const revealedMap = (state.revealed as Record<string, boolean>) ?? {};
    const q = qs[qIndex];
    const selected = answers[q.id];
    const revealed = Boolean(revealedMap[q.id]);
    const isLast = qIndex === qs.length - 1;

    function choose(i: number) {
      patchCurrent({
        answers: { ...answers, [q.id]: i },
        revealed: { ...revealedMap, [q.id]: revealMode === 'instant' ? true : revealed },
      });
    }
    function reveal() {
      if (hostRole !== 'host') return;
      patchCurrent({ revealed: { ...revealedMap, [q.id]: true } });
    }
    function go(delta: number) {
      if (hostRole !== 'host') return;
      const next = Math.min(Math.max(qIndex + delta, 0), qs.length - 1);
      patchCurrent({ qIndex: next });
    }

    const isCorrect = revealed && selected === q.correct_index;
    const isWrong = revealed && selected !== undefined && selected !== q.correct_index;

    return (
      <div className="space-y-5">
        {/* Progress: numbered pill + dots, so position is readable at a glance. */}
        <div className="flex items-center justify-center gap-3">
          <span className="font-baloo grid h-7 w-7 place-items-center rounded-full bg-brand-purple text-xs font-bold text-white">
            {qIndex + 1}
          </span>
          <div className="flex items-center gap-1.5" aria-hidden>
            {qs.map((qq, i) => (
              <motion.span
                key={qq.id}
                className="h-2 rounded-full"
                animate={{
                  width: i === qIndex ? 24 : 8,
                  backgroundColor:
                    i === qIndex
                      ? 'var(--color-brand-purple, #764f84)'
                      : answers[qq.id] !== undefined
                        ? 'var(--color-brand-teal, #3b85a6)'
                        : 'rgba(118,79,132,0.25)',
                }}
                transition={m.spring}
              />
            ))}
          </div>
          <span className="text-xs font-bold uppercase tracking-wider text-brand-purple">
            of {qs.length}
          </span>
        </div>

        {/* Question. Keyed so it animates when the host advances. */}
        <AnimatePresence mode="wait">
          <motion.div
            key={q.id}
            variants={m.stagger}
            initial="hidden"
            animate="show"
            exit={m.reduced ? { opacity: 0 } : { opacity: 0, y: -8 }}
            className="space-y-4"
          >
            {q.image_url ? (
              <motion.img
                variants={m.riseIn}
                src={q.image_url}
                alt=""
                /* No frame: the illustration sits on the canvas like the rest
                   of the activity. A bordered white box around a transparent
                   PNG was one more nested panel inside what was already a
                   panel inside a card. */
                className="mx-auto max-h-60 w-auto max-w-full object-contain"
              />
            ) : null}

            <motion.p
              variants={m.riseIn}
              className="font-baloo text-center text-xl font-bold"
              style={{ color: 'var(--room-ink)' }}
            >
              {q.prompt}
            </motion.p>

            {/* Two columns on wide screens: four stacked full-width bars is the
                "generic form" look the mockups move away from. */}
            <div className="grid gap-2.5 sm:grid-cols-2">
              {q.options.map((opt, i) => (
                <OptionButton
                  key={`${q.id}-${i}`}
                  index={i}
                  text={opt}
                  state={
                    revealed && i === q.correct_index
                      ? 'correct'
                      : revealed && selected === i
                        ? 'wrong'
                        : selected === i
                          ? 'selected'
                          : 'idle'
                  }
                  onSelect={() => choose(i)}
                />
              ))}
            </div>
          </motion.div>
        </AnimatePresence>

        <AnimatePresence mode="wait">
          {isCorrect ? (
            <FeedbackCard key="c" kind="correct" text={q.feedback_correct || 'Correct!'} />
          ) : isWrong ? (
            <FeedbackCard key="w" kind="wrong" text={q.feedback_wrong || 'Not quite — try again!'} />
          ) : null}
        </AnimatePresence>

        {revealMode === 'host_controlled' && hostRole === 'host' && !revealed ? (
          <motion.button
            type="button"
            onClick={reveal}
            whileTap={m.press}
            className="font-baloo mx-auto block min-h-11 cursor-pointer rounded-xl bg-brand-gold px-5 text-sm font-bold text-brand-navy"
          >
            Reveal answer
          </motion.button>
        ) : null}

        {hostRole === 'host' ? (
          <div className="flex items-center justify-between pt-1">
            <motion.button
              type="button"
              onClick={() => go(-1)}
              disabled={qIndex === 0}
              whileTap={qIndex === 0 ? undefined : m.press}
              className="font-baloo flex min-h-11 cursor-pointer items-center gap-1 rounded-xl border-2 border-brand-purple/25 px-4 text-sm font-bold text-brand-navy disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </motion.button>
            <motion.button
              type="button"
              onClick={() => go(1)}
              disabled={isLast}
              whileTap={isLast ? undefined : m.press}
              className="font-baloo flex min-h-11 cursor-pointer items-center gap-1 rounded-xl bg-brand-purple px-5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isLast ? 'Finished' : 'Next Question'}
              {isLast ? null : <ChevronRight className="h-4 w-4" />}
            </motion.button>
          </div>
        ) : (
          <p className="text-center text-xs text-brand-purple">
            Your grown-up moves to the next question.
          </p>
        )}
      </div>
    );
  }

  // ── 1.0: single question ──────────────────────────────────────────────────
  const question = String(payload.question ?? '');
  const options = (payload.options as string[]) ?? [];
  const correct = payload.correct_index as number;
  const selected1 = (state.selected as number | null | undefined) ?? null;
  const revealed1 = Boolean(state.revealed);

  function choose1(i: number) {
    patchCurrent({ selected: i, revealed: revealMode === 'instant' ? true : revealed1 });
  }
  function reveal1() {
    if (hostRole !== 'host') return;
    patchCurrent({ revealed: true });
  }

  const correct1 = revealed1 && selected1 === correct;
  const wrong1 = revealed1 && selected1 !== null && selected1 !== correct;

  return (
    <motion.div variants={m.stagger} initial="hidden" animate="show" className="space-y-4">
      <motion.p
        variants={m.riseIn}
        className="font-baloo text-center text-xl font-bold"
              style={{ color: 'var(--room-ink)' }}
      >
        {question}
      </motion.p>
      <div className="grid gap-2.5 sm:grid-cols-2">
        {options.map((opt, i) => (
          <OptionButton
            key={opt}
            index={i}
            text={opt}
            state={
              revealed1 && i === correct
                ? 'correct'
                : revealed1 && selected1 === i
                  ? 'wrong'
                  : selected1 === i
                    ? 'selected'
                    : 'idle'
            }
            onSelect={() => choose1(i)}
          />
        ))}
      </div>

      {/* The 1.0 path had no feedback at all — only a colour change. */}
      <AnimatePresence mode="wait">
        {correct1 ? (
          <FeedbackCard key="c" kind="correct" text="Correct!" />
        ) : wrong1 ? (
          <FeedbackCard key="w" kind="wrong" text="Not quite — try again!" />
        ) : null}
      </AnimatePresence>

      {revealMode === 'host_controlled' && hostRole === 'host' && !revealed1 ? (
        <motion.button
          type="button"
          onClick={reveal1}
          whileTap={m.press}
          className="font-baloo mx-auto block min-h-11 cursor-pointer rounded-xl bg-brand-gold px-5 text-sm font-bold text-brand-navy"
        >
          Reveal answer
        </motion.button>
      ) : null}
      {revealMode === 'host_controlled' && hostRole === 'guest' && !revealed1 ? (
        <p className="text-center text-sm text-brand-purple">
          The host will reveal the answer when everyone is ready.
        </p>
      ) : null}
    </motion.div>
  );
}
