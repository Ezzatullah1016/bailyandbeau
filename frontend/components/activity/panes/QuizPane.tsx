'use client';

import { useEffect, useRef } from 'react';
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
  // Verdict states keep literal brand colours — right and wrong must read the
  // same in every book theme. Idle takes the room's own translucent fill, per
  // the screens.
  const shellStyle: React.CSSProperties =
    state === 'correct'
      ? { background: 'rgba(95,211,150,0.16)', borderColor: 'var(--c-green)' }
      : state === 'wrong'
        ? { background: 'rgba(228,87,126,0.16)', borderColor: 'var(--c-pink)' }
        : state === 'selected'
          ? { background: 'rgba(240,199,94,0.18)', borderColor: 'var(--room-accent)' }
          : { background: 'rgba(255,255,255,0.05)', borderColor: 'var(--room-chrome-line)' };

  const badgeStyle: React.CSSProperties =
    state === 'correct'
      ? { background: 'var(--c-green)', color: '#12301f' }
      : state === 'wrong'
        ? { background: 'var(--c-pink)', color: '#ffffff' }
        : state === 'selected'
          ? { background: 'var(--room-accent)', color: 'var(--room-accent-contrast)' }
          : { background: 'rgba(124,90,158,0.55)', color: '#ffffff' };

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
      className="flex w-full cursor-pointer items-center gap-3 border-2 px-4 py-3 text-left font-karla text-[15px] transition-colors"
      style={{ minHeight: 68, borderRadius: 14, color: 'var(--room-ink)', ...shellStyle }}
    >
      <motion.span
        className="flex min-w-0 flex-1 items-center gap-3"
        // Colour alone is easy to miss and fails for a colour-blind child, so
        // the movement carries the verdict too.
        animate={state === 'wrong' ? m.nudge : state === 'correct' ? m.celebrate : undefined}
      >
        <span
          className="font-baloo grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-bold transition-colors"
          style={badgeStyle}
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
      className="flex items-center justify-center gap-2 rounded-2xl px-4 py-3 font-karla text-[14px] font-bold"
      style={{
        background: correct ? 'rgba(95,211,150,0.16)' : 'rgba(228,87,126,0.16)',
        color: correct ? 'var(--c-green)' : 'var(--c-pink)',
      }}
      role="status"
    >
      {correct ? <Sparkles className="h-4 w-4 shrink-0" /> : <X className="h-4 w-4 shrink-0" />}
      {text}
    </motion.div>
  );
}

export function QuizPane({
  payload,
  role: hostRole,
  state,
  patchCurrent,
  onCtaChange,
}: PaneProps) {
  const m = usePaneMotion();
  const revealMode = String(payload.reveal_mode ?? 'instant');
  const questions = payload.questions as QuizQuestion[] | undefined;

  /*
   * The dock's "Next Question" is computed here, above the 1.1/1.0 branch.
   *
   * The two paths are separate returns, and a hook inside either branch would
   * run conditionally — so the effect that publishes the CTA has to live before
   * the split, reading the same state the 1.1 render does.
   */
  const multi = Array.isArray(questions) && questions.length > 0 ? questions : null;
  const ctaIndex = multi ? Math.min(Number(state.qIndex ?? 0), multi.length - 1) : 0;
  const ctaIsLast = multi ? ctaIndex === multi.length - 1 : true;
  const isHost = hostRole === 'host';
  // A 1.0 quiz is one question, so there is nothing to advance to — its action
  // is revealing the answer, which is the only host control it has.
  const single1Revealed = !multi && Boolean(state.revealed);

  // The run body closes over `patchCurrent`, which the shell redefines every
  // render; a ref keeps the published CTA stable while still calling the
  // current version.
  const runRef = useRef<() => void>(() => {});
  runRef.current = () => {
    if (multi) patchCurrent({ qIndex: Math.min(ctaIndex + 1, multi.length - 1) });
    else patchCurrent({ revealed: true });
  };

  useEffect(() => {
    if (!onCtaChange) return;
    if (!isHost) {
      onCtaChange(null);
      return;
    }
    onCtaChange(
      multi
        ? {
            label: ctaIsLast ? 'Finished' : 'Next Question',
            tone: 'gold',
            icon: ChevronRight,
            iconTrailing: true,
            disabled: ctaIsLast,
            run: () => runRef.current(),
          }
        : {
            label: 'Reveal Answer',
            tone: 'gold',
            icon: Sparkles,
            iconTrailing: true,
            disabled: single1Revealed,
            run: () => runRef.current(),
          },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onCtaChange, isHost, Boolean(multi), ctaIsLast, ctaIndex, single1Revealed]);

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
        {/* Progress rail: a dot per question on a hairline track, with the
            position badge on the left. The screens read "1 of 5"; the dots
            carry answered-ness so a host can see what is still open. */}
        <div className="flex items-center gap-4">
          <span
            className="flex shrink-0 items-baseline gap-1 font-karla text-[12px] font-semibold uppercase tracking-wider"
            style={{ color: 'var(--room-ink-soft)' }}
          >
            <span
              className="grid h-7 w-7 place-items-center rounded-full font-baloo text-[13px] font-bold"
              style={{ background: 'rgba(124,90,158,0.55)', color: '#ffffff' }}
            >
              {qIndex + 1}
            </span>
            of {qs.length}
          </span>

          <div className="relative flex flex-1 items-center" aria-hidden>
            <span
              className="absolute inset-x-0 h-0.5"
              style={{ background: 'rgba(255,255,255,0.14)' }}
            />
            <div className="relative flex w-full items-center justify-between">
              {qs.map((qq, i) => (
                <motion.span
                  key={qq.id}
                  className="rounded-full"
                  animate={{
                    width: i === qIndex ? 12 : 10,
                    height: i === qIndex ? 12 : 10,
                    backgroundColor:
                      i === qIndex
                        ? 'var(--room-accent)'
                        : answers[qq.id] !== undefined
                          ? 'var(--c-teal)'
                          : 'rgba(255,255,255,0.25)',
                  }}
                  transition={m.spring}
                />
              ))}
            </div>
          </div>
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

        {/* "Next Question" is published to the room's dock, where the screens
            put it. Only "Previous" stays in the pane: the dock holds one
            primary action, and going back is a correction, not the main path. */}
        {hostRole === 'host' ? (
          <div className="flex items-center pt-1">
            <motion.button
              type="button"
              onClick={() => go(-1)}
              disabled={qIndex === 0}
              whileTap={qIndex === 0 ? undefined : m.press}
              className="font-baloo flex min-h-11 cursor-pointer items-center gap-1 rounded-xl border-2 px-4 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-40"
              style={{ borderColor: 'var(--room-chrome-line)', color: 'var(--room-ink)' }}
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </motion.button>
          </div>
        ) : (
          <p className="text-center font-karla text-[13px]" style={{ color: 'var(--room-ink-soft)' }}>
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
