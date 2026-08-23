import { Palette, Puzzle, Search, Star } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import type { ActivityType } from './types';

/**
 * Each activity type's public identity: what a family calls it, its icon, and
 * its colour.
 *
 * The stored `activity_type` values are engineering words — `quiz`,
 * `drag_drop`, `hotspot`, `drawing`. Nobody in the room says those, and the
 * client's screens never show them. This module is the one place the mapping to
 * "Story Quest", "Place & Play", "Discovery Spots" and "Create Together" lives,
 * so the picker cards, the room's header label and the library chips cannot
 * drift apart.
 *
 * The accents are measured from the screens: fully saturated card fills, with
 * white text over them.
 */
export interface ActivityTypeMeta {
  label: string;
  Icon: LucideIcon;
  blurb: string;
  /** The card fill. */
  accent: string;
  /** The lighter end of the card's gradient. */
  accentSoft: string;
  /** Ink for text placed *on* the accent — used by the card's Play button. */
  onAccent: string;
}

export const TYPE_META: Record<ActivityType, ActivityTypeMeta> = {
  quiz: {
    label: 'Story Quest',
    Icon: Star,
    blurb: 'Test your memory and discover fun surprises from the story you just shared.',
    accent: '#6d28c9',
    accentSoft: '#8b47e0',
    onAccent: '#4c1d95',
  },
  drag_drop: {
    label: 'Place & Play',
    Icon: Puzzle,
    blurb: 'Drag each piece into place to complete magical scenes together.',
    accent: '#2596b4',
    accentSoft: '#38b3d1',
    onAccent: '#0f5f75',
  },
  hotspot: {
    label: 'Discovery Spots',
    Icon: Search,
    blurb: 'Search for hidden treasures and uncover delightful surprises along the way.',
    accent: '#e04b6e',
    accentSoft: '#ee6d8b',
    onAccent: '#8c1f3c',
  },
  drawing: {
    label: 'Create Together',
    Icon: Palette,
    blurb: 'Draw, colour, and bring your imagination to life — together.',
    accent: '#f0b429',
    accentSoft: '#f7cd5f',
    onAccent: '#6b4708',
  },
};

/** The order the screens list the four types in. */
export const TYPE_ORDER: ActivityType[] = ['quiz', 'drag_drop', 'hotspot', 'drawing'];

/**
 * Label lookup that tolerates an unknown type. The API could grow a fifth type
 * before this file knows about it, and a missing label must not blank the room's
 * header.
 */
export const ACTIVITY_TYPE_LABEL: Record<string, string> = Object.fromEntries(
  Object.entries(TYPE_META).map(([key, meta]) => [key, meta.label]),
);
