import {
  AlarmClock, ArrowRight, Baby, Bell, BookMarked, BookOpen,
  CalendarDays, Check, CheckCircle, CheckSquare, ChevronDown,
  ChevronLeft, ChevronRight, Clock, CreditCard, DoorOpen,
  Eraser, Eye, EyeOff, FileText, Heart, Hourglass, LayoutDashboard,
  Link, Lock, LogOut, Mail, MapPin, Medal, MessageCircle, Mic,
  MicOff, MoreHorizontal, MousePointer2, Pencil, Play, Plus, Puzzle,
  RefreshCw, RefreshCwOff, Rocket, Save, Settings, SlidersHorizontal,
  Sparkles, Star, Timer, Trash2, Trophy, Users, User, UserCircle,
  Video, VideoOff, Wand2, WifiOff, X, type LucideIcon,
} from 'lucide-react';

export const ICON_MAP: Record<string, LucideIcon> = {
  account_circle:     UserCircle,
  add:                Plus,
  alarm_on:           AlarmClock,
  arrow_forward:      ArrowRight,
  auto_awesome:       Sparkles,
  auto_fix_high:      Wand2,
  auto_stories:       BookOpen,
  calendar_today:     CalendarDays,
  chat_bubble:        MessageCircle,
  check:              Check,
  check_circle:       CheckCircle,
  child_care:         Baby,
  close:              X,
  dashboard:          LayoutDashboard,
  delete:             Trash2,
  description:        FileText,
  draw:               Pencil,
  edit:               Pencil,
  emoji_events:       Trophy,
  expand_more:        ChevronDown,
  favorite:           Heart,
  group:              Users,
  history_edu:        BookMarked,
  hourglass_top:      Hourglass,
  extension:          Puzzle,
  ink_eraser:         Eraser,
  link:               Link,
  location_on:        MapPin,
  lock:               Lock,
  logout:             LogOut,
  mail:               Mail,
  meeting_room:       DoorOpen,
  menu_book:          BookOpen,
  mic:                Mic,
  mic_off:            MicOff,
  military_tech:      Medal,
  more_horiz:         MoreHorizontal,
  notifications:      Bell,
  payments:           CreditCard,
  person:             User,
  play_arrow:         Play,
  restart_alt:        RefreshCw,
  rocket_launch:      Rocket,
  save:               Save,
  schedule:           Clock,
  settings:           Settings,
  signal_disconnected:WifiOff,
  star:               Star,
  sync:               RefreshCw,
  sync_problem:       RefreshCwOff,
  task_alt:           CheckSquare,
  timer:              Timer,
  touch_app:          MousePointer2,
  tune:               SlidersHorizontal,
  videocam:           Video,
  videocam_off:       VideoOff,
  visibility:         Eye,
  visibility_off:     EyeOff,
};

interface IconProps {
  name: string;
  className?: string;
}

export function Icon({ name, className }: IconProps) {
  const LucideIcon = ICON_MAP[name];
  if (!LucideIcon) return null;
  return <LucideIcon className={className ?? 'w-5 h-5'} />;
}
