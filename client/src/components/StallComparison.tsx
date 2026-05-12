import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import type { Session } from '../types';
import { formatCurrency } from '../utils/currency';

interface Props {
  sessions: Session[];
  currentSessionId: string;
}

const revenueOf = (s: Session): number => {
  const raw = s.stats?.total_revenue ?? s.total_revenue ?? 0;
  const n = typeof raw === 'string' ? parseFloat(raw) : raw;
  return Number.isFinite(n) ? n : 0;
};

// Chart area inside the 0–100 viewBox.
const Y_TOP = 12;
const Y_BOT = 92;
const X_LEFT = 5;
const X_RIGHT = 95;

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const norm = v / pow;
  let nice;
  if (norm <= 1) nice = 1;
  else if (norm <= 2) nice = 2;
  else if (norm <= 5) nice = 5;
  else nice = 10;
  return nice * pow;
}

const formatTick = (v: number): string => {
  if (v === 0) return formatCurrency(0).replace(/\.00$/, '');
  return formatCurrency(Math.round(v)).replace(/\.00$/, '');
};

// Straight-segment polyline path.
interface Pt { x: number; y: number }
function linePathOf(points: Pt[]): string {
  if (points.length === 0) return '';
  return points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`)
    .join(' ');
}

export default function StallComparison({ sessions, currentSessionId }: Props) {
  const navigate = useNavigate();
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const data = useMemo(
    () =>
      [...sessions].sort(
        (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
      ),
    [sessions]
  );

  const yMax = useMemo(() => {
    const peak = Math.max(0, ...data.map(revenueOf));
    return niceMax(peak || 1);
  }, [data]);

  const yTicks = useMemo(() => [0, 0.25, 0.5, 0.75, 1].map(r => r * yMax), [yMax]);

  const positions = useMemo<Pt[]>(() => {
    return data.map((s, i) => {
      const x =
        data.length === 1
          ? (X_LEFT + X_RIGHT) / 2
          : X_LEFT + (i / (data.length - 1)) * (X_RIGHT - X_LEFT);
      const ratio = revenueOf(s) / yMax;
      const y = Y_BOT - ratio * (Y_BOT - Y_TOP);
      return { x, y };
    });
  }, [data, yMax]);

  const currentIdx = data.findIndex(s => s.id === currentSessionId);
  const currentSession = currentIdx >= 0 ? data[currentIdx] : null;
  const currentRevenue = currentSession ? revenueOf(currentSession) : 0;

  const avgRevenue = useMemo(
    () =>
      data.length === 0
        ? 0
        : data.reduce((acc, s) => acc + revenueOf(s), 0) / data.length,
    [data]
  );

  if (data.length < 2) return null;

  const linePath = linePathOf(positions);
  const avgY = Y_BOT - (Math.min(avgRevenue, yMax) / yMax) * (Y_BOT - Y_TOP);

  const vsAvg = avgRevenue > 0 ? ((currentRevenue - avgRevenue) / avgRevenue) * 100 : 0;
  const isBest =
    data.every(s => s.id === currentSessionId || revenueOf(s) <= currentRevenue) &&
    currentRevenue > 0;

  // Focus index is either the hovered dot or the current session.
  const focusIdx = hoverIdx ?? currentIdx;
  const focusPt = focusIdx >= 0 ? positions[focusIdx] : null;
  const focusSession = focusIdx >= 0 ? data[focusIdx] : null;
  const focusRevenue = focusSession ? revenueOf(focusSession) : 0;

  return (
    <motion.div
      className="card mb-4 relative overflow-hidden"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.05 }}
    >
      {/* Layered background gradients for depth */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none opacity-70"
        style={{
          background:
            'radial-gradient(ellipse 80% 60% at 80% 0%, rgba(212, 168, 67, 0.10), transparent 60%), radial-gradient(ellipse 60% 50% at 0% 100%, rgba(212, 168, 67, 0.04), transparent 70%)',
        }}
      />

      <div className="relative flex items-end justify-between mb-5">
        <div>
          <h3 className="text-white font-semibold text-sm flex items-center gap-2">
            Stall Comparison
            <motion.span
              className="inline-block w-1.5 h-1.5 rounded-full bg-gold"
              animate={{ opacity: [0.4, 1, 0.4], scale: [1, 1.3, 1] }}
              transition={{ duration: 2, repeat: Infinity }}
            />
          </h3>
          <p className="text-[11px] text-gray-500 mt-0.5">
            Revenue across all {data.length} stalls
          </p>
        </div>
        <div className="flex items-center gap-3">
          {isBest && (
            <motion.span
              className="text-[10px] font-semibold uppercase tracking-wider text-gold bg-gradient-to-r from-gold/15 to-gold/5 border border-gold/30 px-2 py-0.5 rounded-full"
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.4, type: 'spring', stiffness: 380, damping: 22 }}
              style={{ boxShadow: '0 0 12px rgba(212, 168, 67, 0.25)' }}
            >
              Top stall
            </motion.span>
          )}
          <div className="text-right">
            <p className="text-[10px] text-gray-500 uppercase tracking-wider">vs Average</p>
            <p
              className={`text-sm font-bold tabular-nums ${
                vsAvg >= 0 ? 'text-green-400' : 'text-red-400'
              }`}
            >
              {vsAvg >= 0 ? '+' : ''}
              {vsAvg.toFixed(0)}%
            </p>
          </div>
        </div>
      </div>

      <div className="relative h-52 w-full pl-14 pr-6">
        <div className="absolute left-0 top-0 bottom-0 w-12 pointer-events-none">
          {yTicks.map(v => {
            const ratio = v / yMax;
            const y = Y_BOT - ratio * (Y_BOT - Y_TOP);
            return (
              <span
                key={v}
                className="absolute right-1 -translate-y-1/2 text-[9px] text-gray-500 tabular-nums"
                style={{ top: `${y}%` }}
              >
                {formatTick(v)}
              </span>
            );
          })}
        </div>

        <div className="relative h-full w-full">
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="absolute inset-0 w-full h-full overflow-visible"
          >
            {/* Grid lines */}
            {yTicks.map(v => {
              const ratio = v / yMax;
              const y = Y_BOT - ratio * (Y_BOT - Y_TOP);
              return (
                <line
                  key={v}
                  x1="0"
                  x2="100"
                  y1={y}
                  y2={y}
                  stroke="rgba(255,255,255,0.05)"
                  strokeWidth="0.4"
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}

            {/* Average reference line */}
            {avgRevenue > 0 && (
              <line
                x1="0"
                x2="100"
                y1={avgY}
                y2={avgY}
                stroke="rgba(212, 168, 67, 0.35)"
                strokeWidth="0.6"
                strokeDasharray="2 2"
                vectorEffect="non-scaling-stroke"
              />
            )}

            {/* Solid gold line through every data point */}
            <motion.path
              d={linePath}
              fill="none"
              stroke="#d4a843"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.5, delay: 0.1 }}
            />
          </svg>

          {/* Dots */}
          {data.map((s, i) => {
            const pt = positions[i];
            const revenue = revenueOf(s);
            const isCurrent = s.id === currentSessionId;
            const isHovered = hoverIdx === i;
            return (
              <motion.button
                key={s.id}
                onClick={() => !isCurrent && navigate(`/session/${s.id}`)}
                onMouseEnter={() => setHoverIdx(i)}
                onMouseLeave={() => setHoverIdx(null)}
                onFocus={() => setHoverIdx(i)}
                onBlur={() => setHoverIdx(null)}
                disabled={isCurrent}
                className="group absolute -translate-x-1/2 -translate-y-1/2 cursor-pointer disabled:cursor-default"
                style={{ left: `${pt.x}%`, top: `${pt.y}%` }}
                title={`${s.name}${s.location ? ` · ${s.location}` : ''} · ${formatCurrency(revenue)}`}
                initial={{ opacity: 0, scale: 0 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.4 + i * 0.05, duration: 0.35, ease: 'backOut' }}
                whileHover={isCurrent ? {} : { scale: 1.35 }}
              >
                {isCurrent ? (
                  <span className="relative flex items-center justify-center">
                    {/* Layered halos */}
                    <motion.span
                      className="absolute w-8 h-8 rounded-full bg-gold/15"
                      animate={{ scale: [1, 1.6, 1], opacity: [0.4, 0, 0.4] }}
                      transition={{ duration: 2.4, repeat: Infinity }}
                    />
                    <motion.span
                      className="absolute w-5 h-5 rounded-full bg-gold/30"
                      animate={{ scale: [1, 1.45, 1], opacity: [0.6, 0.1, 0.6] }}
                      transition={{ duration: 2.4, repeat: Infinity, delay: 0.6 }}
                    />
                    <span
                      className="block w-3 h-3 rounded-full bg-gold-light"
                      style={{ boxShadow: '0 0 14px rgba(212, 168, 67, 0.9)' }}
                    />
                  </span>
                ) : (
                  <span
                    className="block w-2 h-2 rounded-full bg-gold-light transition-shadow"
                    style={{
                      boxShadow: isHovered
                        ? '0 0 12px rgba(212, 168, 67, 0.7)'
                        : '0 0 6px rgba(212, 168, 67, 0.4)',
                    }}
                  />
                )}
              </motion.button>
            );
          })}

          {/* Floating tooltip over the focused stall. Anchors to whichever
              side keeps it inside the chart area. */}
          {focusPt && focusSession && (() => {
            const anchor: 'left' | 'right' | 'center' =
              focusPt.x > 78 ? 'right' : focusPt.x < 22 ? 'left' : 'center';
            const translateX = anchor === 'right' ? '-100%' : anchor === 'left' ? '0%' : '-50%';
            return (
              <motion.div
                key={focusIdx}
                className="absolute pointer-events-none z-10"
                style={{
                  left: `${focusPt.x}%`,
                  top: focusPt.y < 35 ? `${focusPt.y + 8}%` : undefined,
                  bottom: focusPt.y < 35 ? undefined : `${100 - focusPt.y + 8}%`,
                  transform: `translateX(${translateX})`,
                }}
                initial={{ opacity: 0, scale: 0.9, y: focusPt.y < 35 ? -4 : 4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
              >
                <div className="bg-navy-light/95 backdrop-blur-md border border-gold/25 rounded-lg shadow-card px-2.5 py-1.5 whitespace-nowrap">
                  <p className="text-[9px] uppercase tracking-wider text-gray-500 leading-tight">
                    {new Date(focusSession.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </p>
                  <p className="text-xs font-semibold text-white leading-tight max-w-[160px] truncate">
                    {focusSession.name}
                  </p>
                  <p className="text-sm font-bold text-gold leading-tight tabular-nums">
                    {formatCurrency(focusRevenue)}
                  </p>
                </div>
              </motion.div>
            );
          })()}
        </div>
      </div>

      <div className="relative mt-2 h-3 w-full pl-14 pr-6">
        <div className="relative w-full h-full">
          {data.map((s, i) => {
            const pt = positions[i];
            const isCurrent = s.id === currentSessionId;
            const isFocused = focusIdx === i;
            const stride = data.length > 8 ? Math.ceil(data.length / 6) : 1;
            if (
              !isCurrent &&
              !isFocused &&
              i !== 0 &&
              i !== data.length - 1 &&
              i % stride !== 0
            ) {
              return null;
            }
            const dateLabel = new Date(s.date).toLocaleDateString('en-GB', {
              day: 'numeric',
              month: 'short',
            });
            return (
              <span
                key={s.id}
                className={`absolute -translate-x-1/2 text-[10px] whitespace-nowrap transition-colors duration-200 ${
                  isCurrent
                    ? 'text-gold-light font-semibold'
                    : isFocused
                      ? 'text-gold'
                      : 'text-gray-500'
                }`}
                style={{ left: `${pt.x}%` }}
              >
                {dateLabel}
              </span>
            );
          })}
        </div>
      </div>
    </motion.div>
  );
}
