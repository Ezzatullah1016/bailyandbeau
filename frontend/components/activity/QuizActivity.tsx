'use client';

import { useState, useEffect } from 'react';
import { CheckCircle, ChevronRight, RotateCcw, Sparkles } from 'lucide-react';

export interface QuizQuestion {
  question: string;
  options: string[];
  correct_index: number;
  chapter?: string;
}

export interface QuizConfig {
  questions: QuizQuestion[];
}

export interface QuizState {
  question_index: number;
  selected_index: number | null;
  revealed: boolean;
}

const OPTION_LABELS = ['A', 'B', 'C', 'D'];

interface Props {
  config: QuizConfig;
  isHost: boolean;
  remoteState?: QuizState;
  onSync: (state: QuizState) => void;
  onNext?: () => void;
  onReset?: () => void;
}

export default function QuizActivity({ config, isHost, remoteState, onSync, onNext, onReset }: Props) {
  const [state, setState] = useState<QuizState>({ question_index: 0, selected_index: null, revealed: false });

  // Load remote state
  useEffect(() => {
    if (remoteState) setState(remoteState);
  }, [remoteState]);

  const q = config.questions?.[state.question_index];
  const total = config.questions?.length ?? 0;

  const handleSelect = (idx: number) => {
    if (state.revealed) return;
    const next: QuizState = { ...state, selected_index: idx };
    setState(next);
    onSync(next);
  };

  const handleReveal = () => {
    const next: QuizState = { ...state, revealed: true };
    setState(next);
    onSync(next);
  };

  const handleNext = () => {
    if (state.question_index < total - 1) {
      const next: QuizState = { question_index: state.question_index + 1, selected_index: null, revealed: false };
      setState(next);
      onSync(next);
    } else {
      onNext?.();
    }
  };

  const handleReset = () => {
    const next: QuizState = { question_index: 0, selected_index: null, revealed: false };
    setState(next);
    onSync(next);
    onReset?.();
  };

  if (!q) return <div className="flex items-center justify-center h-full text-[#e5e2e1]">No questions configured.</div>;

  return (
    <div className="flex flex-col items-center justify-center h-full min-h-0 px-8 py-6 bg-[#1A1A1A]">
      {/* Quiz panel */}
      <div className="w-full max-w-[600px] bg-[#e5e2e1] rounded-2xl shadow-2xl p-10 flex flex-col gap-7 relative overflow-hidden">
        {/* Atmospheric accent */}
        <div className="absolute top-0 right-0 w-32 h-32 bg-[#a8d38a]/10 blur-[64px] pointer-events-none" />

        {/* Header */}
        <div className="flex flex-col gap-4">
          <span className="inline-flex items-center px-4 py-1.5 rounded-full bg-[#ffddb4] text-[#291800] text-xs font-bold uppercase tracking-widest shadow-sm w-fit">
            Question {state.question_index + 1} of {total}
          </span>
          <h3 className="font-headline text-[#131313] text-3xl font-semibold leading-tight italic">
            {q.question}
          </h3>
        </div>

        {/* Answers */}
        <div className="flex flex-col gap-3">
          {q.options.map((opt, idx) => {
            const isSelected = state.selected_index === idx;
            const isCorrect = state.revealed && idx === q.correct_index;
            const isWrong = state.revealed && isSelected && idx !== q.correct_index;

            return (
              <button
                key={idx}
                onClick={() => handleSelect(idx)}
                disabled={state.revealed && !isHost}
                className={`group flex items-center p-5 rounded-xl text-left transition-all duration-300 active:scale-[0.98]
                  ${isCorrect ? 'bg-[#2d5016] text-[#a8d38a] shadow-lg ring-2 ring-[#a8d38a] scale-[1.02]' :
                    isWrong ? 'bg-[#93000a]/10 text-[#93000a] ring-2 ring-[#93000a]' :
                    isSelected ? 'bg-[#20201f] text-[#e5e2e1] ring-2 ring-[#a8d38a]/40' :
                    'bg-[#20201f] text-[#e5e2e1] hover:bg-[#2a2a2a]'}`}
              >
                <span className={`w-9 h-9 flex items-center justify-center rounded-lg font-bold mr-4 flex-shrink-0 transition-colors
                  ${isCorrect ? 'bg-[#a8d38a] text-[#163801]' :
                    isWrong ? 'bg-[#93000a] text-white' :
                    isSelected ? 'bg-[#a8d38a]/20 text-[#a8d38a]' :
                    'bg-[#353535] text-[#a8d38a] group-hover:bg-[#2d5016] group-hover:text-[#a8d38a]'}`}>
                  {OPTION_LABELS[idx]}
                </span>
                <span className="text-base font-medium flex-1">{opt}</span>
                {isCorrect && <CheckCircle className="w-5 h-5 ml-auto fill-current" />}
              </button>
            );
          })}
        </div>

        {/* Actions */}
        {isHost && (
          <div className="flex justify-center gap-3 pt-2">
            {!state.revealed ? (
              <button
                onClick={handleReveal}
                disabled={state.selected_index === null}
                className="relative group px-10 py-3.5 rounded-full overflow-hidden transition-all duration-300 hover:shadow-xl hover:shadow-[#a8d38a]/20 disabled:opacity-40"
              >
                <div className="absolute inset-0 bg-gradient-to-br from-[#a8d38a] to-[#2d5016] group-hover:scale-105 transition-transform" />
                <span className="relative flex items-center gap-2 text-[#163801] font-bold text-base uppercase tracking-widest">
                  Reveal Answer
                  <Sparkles className="w-4 h-4" />
                </span>
              </button>
            ) : (
              <button
                onClick={handleNext}
                className="flex items-center gap-2 bg-[#2d5016] text-[#a8d38a] px-8 py-3 rounded-full font-bold hover:bg-[#3a6a1e] transition-all"
              >
                {state.question_index < total - 1 ? 'Next Question' : 'Finish Quiz'}
                <ChevronRight className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={handleReset}
              className="flex items-center gap-2 px-4 py-3 rounded-full text-[#e5e2e1]/50 hover:bg-[#2a2a2a] transition-all text-sm"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Progress dots */}
        <div className="flex items-center justify-between pt-2 border-t border-[#353535]/20">
          {q.chapter && (
            <p className="text-xs text-[#131313]/40 italic font-headline">{`From: "${q.chapter}"`}</p>
          )}
          <div className="flex gap-1.5 ml-auto">
            {config.questions.map((_, i) => (
              <span
                key={i}
                className={`rounded-full transition-all ${i === state.question_index ? 'w-5 h-2 bg-[#a8d38a]' : 'w-2 h-2 bg-[#353535]'}`}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
