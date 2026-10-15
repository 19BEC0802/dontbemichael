/**
 * Pulse: the office's performance and cost, as pictures (docs/designs/team-performance.md,
 * approved mockup pulse-final.html). Top to bottom: ways to save, what got done,
 * the team as tiles, then the office row. Fields first; each explanation sits
 * behind an (i). Advice is amber, savings green, coral never: Ask me stays the
 * only thing that needs the owner.
 *
 *   Pulse ─ pulse:snapshot (on open, on period change, on pulse:updated)
 *         ─ Apply ─ pulse:apply ─► schedule (main) | model (this store) ─► "Applied." + Undo
 *         ─ Not now ─ pulse:dismiss
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { PulseView as PulseData } from '@shared/pulseView';
import type { Advice } from '@shared/teamAdvice';
import type { MemberMeasures, Outcome, Period, WorkKind } from '@shared/teamPerformance';
import { useStore } from '@/store/store';
import { useAppTheme } from '@/design/theme';
import { family } from '@/scene/studio/theme';
import { departmentOf, roleOf } from '@/scene/studio/layout';
import { useMissions } from '../triggers/ScheduleList';
import { AgentAvatar } from '../AgentAvatar';
import { InfoTip } from '../InfoTip';
import { Icon, type IconName } from '../Icon';
import { useDialog } from '@/shell/useDialog';
import { useBackdropClose } from '@/hooks/useBackdropClose';

const LS_PERIOD = 'cth.pulsePeriod';
const PERIODS: Period[] = ['this-week', 'last-week', '4-weeks'];
const KIND_ICON: Record<WorkKind, IconName> = { email: 'mail', sent: 'send', task: 'check', check: 'clock' };

const money = (v: number): string => `$${(Math.round(v * 100) / 100).toFixed(2)}`;
const pct = (v: number): string => `${Math.round(v * 100)}%`;
function duration(ms: number, t: (k: string, o?: Record<string, unknown>) => string): string {
  const m = Math.round(ms / 60_000);
  if (m < 60) return t('pulse.minutes', { m });
  const h = Math.floor(m / 60);
  return t('pulse.hoursMinutes', { h, m: m % 60 });
}
function every(ms: number, t: (k: string, o?: Record<string, unknown>) => string): string {
  return ms % 3_600_000 === 0 ? t('pulse.hoursShort', { h: ms / 3_600_000 }) : t('pulse.minutesShort', { m: Math.round(ms / 60_000) });
}

/** Layout by the stage's width (design D14). */
type Layout = 'wide' | 'mid' | 'narrow';
function useLayout(ref: React.RefObject<HTMLElement | null>): Layout {
  const [w, setW] = useState(1200);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((e) => setW(e[0]?.contentRect.width ?? 1200));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w >= 1100 ? 'wide' : w >= 760 ? 'mid' : 'narrow';
}

const card: CSSProperties = { background: 'var(--cth-card)', borderRadius: 'var(--cth-r-xl)', boxShadow: 'inset 0 0 0 1px var(--cth-line), var(--cth-shadow-md)' };
const label: CSSProperties = { fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--cth-ink-3)', display: 'flex', gap: 6, alignItems: 'center' };
const mono: CSSProperties = { fontFamily: 'var(--cth-font-mono)' };
const btn = (primary: boolean): CSSProperties => ({
  height: 28, padding: '0 12px', borderRadius: 'var(--cth-r-md)', fontSize: 11, fontWeight: 600, fontFamily: 'var(--cth-font-ui)', cursor: 'pointer',
  border: 'none', background: primary ? 'var(--cth-ink)' : 'var(--cth-card)', color: primary ? 'var(--cth-bg)' : 'var(--cth-ink)',
  boxShadow: primary ? 'none' : 'inset 0 0 0 1px var(--cth-line-2)'
});

function Section({ title, tip, children }: { title: string; tip?: string; children: ReactNode }) {
  return (
    <section aria-label={title} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <h2 style={{ margin: 0, fontSize: 13, fontWeight: 600, letterSpacing: '-0.01em', display: 'flex', gap: 6, alignItems: 'center' }}>
        {title}{tip && <InfoTip text={tip} />}
      </h2>
      {children}
    </section>
  );
}

/** A bar of who did it, members of one department in its acc, m then d shades (D13). */
function WhoBar({ by, colorOf, nameOf, height = 10, aria }: { by: Array<{ agentId: string; count: number }>; colorOf: (id: string, nth: number) => string; nameOf: (id: string) => string; height?: number; aria: string }) {
  const total = by.reduce((s, b) => s + b.count, 0) || 1;
  const seen = new Map<string, number>();
  const shades = by.map((b) => {
    const dept = colorOf(b.agentId, -1);
    const n = seen.get(dept) ?? 0;
    seen.set(dept, n + 1);
    return colorOf(b.agentId, n);
  });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div role="img" aria-label={aria} style={{ display: 'flex', height, borderRadius: 'var(--cth-r-pill)', overflow: 'hidden', gap: 2 }}>
        {by.map((b, i) => <i key={b.agentId} style={{ display: 'block', width: `${(b.count / total) * 100}%`, background: shades[i] }} />)}
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 11, color: 'var(--cth-ink-2)' }} aria-hidden>
        {by.map((b, i) => (
          <span key={b.agentId} style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}>
            <b style={{ width: 8, height: 8, borderRadius: '50%', background: shades[i], display: 'inline-block' }} />
            {nameOf(b.agentId)} <span style={mono}>{b.count}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

export function PulseView() {
  const { t, i18n } = useTranslation();
  const agents = useStore((s) => s.agents);
  const updateAgent = useStore((s) => s.updateAgent);
  const openAgentProfile = useStore((s) => s.openAgentProfile);
  const dark = useAppTheme() === 'dark';
  const { missions } = useMissions();
  const host = useRef<HTMLDivElement | null>(null);
  const layout = useLayout(host);
  const [period, setPeriod] = useState<Period>(() => {
    try { const v = window.localStorage.getItem(LS_PERIOD); return PERIODS.includes(v as Period) ? (v as Period) : 'this-week'; } catch { return 'this-week'; }
  });
  const [data, setData] = useState<PulseData | null>(null);
  const [failed, setFailed] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);
  const [applied, setApplied] = useState<Array<{ advice: Advice; appliedId: number; text: string }>>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string>('');

  const load = useCallback(async () => {
    try { setData(await window.cth.pulseSnapshot(period)); setFailed(false); } catch { setFailed(true); }
  }, [period]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => window.cth.onPulseUpdated(() => { void load(); }), [load]);

  const byId = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);
  const nameOf = useCallback((id: string) => byId.get(id)?.name ?? id, [byId]);
  const colorOf = useCallback((id: string, nth: number): string => {
    const a = byId.get(id);
    const f = family(a ? departmentOf(a) : 'team', dark);
    if (nth < 0) return a ? departmentOf(a) : 'team';
    return [f.acc, f.m, f.d][nth % 3];
  }, [byId, dark]);
  const fmtDay = (day: string | number): string => new Date(typeof day === 'number' ? day : `${day}T12:00:00`).toLocaleDateString(i18n.language, { weekday: 'short', day: 'numeric', month: 'short' });
  const jobOf = (id?: string): string => missions.find((m) => m.id === id)?.label ?? '';

  const adviceText = (a: Advice): { title: string; evidence: string } => {
    const name = nameOf(a.agentId);
    const job = jobOf(a.missionId);
    const e = a.evidence;
    switch (a.kind) {
      case 'run-less': return { title: t('pulse.advice.runLess', { name, job }), evidence: t('pulse.advice.runLessWhy', { nothing: e.nothing, runs: e.runs }) + (a.change.kind === 'interval' ? ` ${t('pulse.advice.everyChange', { from: every(a.change.fromMs, t), to: every(a.change.toMs, t) })}` : '') };
      case 'run-more': return { title: t('pulse.advice.runMore', { name, job }), evidence: t('pulse.advice.runMoreWhy', { didWork: e.didWork, runs: e.runs }) + (a.change.kind === 'interval' ? ` ${t('pulse.advice.everyChange', { from: every(a.change.fromMs, t), to: every(a.change.toMs, t) })}` : '') };
      case 'cheaper-model': return { title: t('pulse.advice.tryModel', { name, model: a.change.kind === 'model' ? a.change.toLabel : '' }), evidence: t('pulse.advice.cheaperWhy', { kept: e.kept, decisions: e.decisions }) };
      default: return { title: t('pulse.advice.tryModel', { name, model: a.change.kind === 'model' ? a.change.toLabel : '' }), evidence: e.reopens && e.reopens >= 3 ? t('pulse.advice.reopenedWhy', { reopens: e.reopens }) : t('pulse.advice.strongerWhy', { kept: e.kept, decisions: e.decisions }) };
    }
  };

  const apply = async (a: Advice): Promise<void> => {
    if (a.change.kind === 'editor') { openAgentProfile(a.agentId); return; }
    if (busy) return;
    setBusy(a.id);
    try {
      const r = await window.cth.pulseApply(a.id, a.change);
      if (!r.ok) { setNotice(t(r.error === 'stale' ? 'pulse.staleApply' : 'pulse.applyFailed')); await load(); return; }
      let appliedId = r.kind === 'schedule' ? r.appliedId : 0;
      let text = '';
      if (r.kind === 'schedule' && a.change.kind === 'interval') text = t('pulse.appliedSchedule', { name: nameOf(a.agentId), job: jobOf(a.missionId), to: every(a.change.toMs, t) });
      if (r.kind === 'model') {
        updateAgent(r.agentId, { model: r.to });
        appliedId = await window.cth.pulseModelApplied(a.id, r.agentId, r.from, r.to);
        text = t('pulse.appliedModel', { name: nameOf(r.agentId), model: a.change.kind === 'model' ? a.change.toLabel : r.to });
      }
      setApplied((list) => [...list, { advice: a, appliedId, text }]);
      setNotice(text);
      await load();
    } finally { setBusy(null); }
  };
  const undo = async (item: { advice: Advice; appliedId: number }): Promise<void> => {
    const r = await window.cth.pulseUndo(item.appliedId);
    if (!r.ok) { setNotice(t('pulse.staleUndo')); return; }
    if (r.kind === 'model') updateAgent(r.agentId, { model: r.to ?? undefined });
    setApplied((list) => list.filter((x) => x.appliedId !== item.appliedId));
    setNotice(t('pulse.undone'));
    await load();
  };
  const notNow = async (a: Advice): Promise<void> => { await window.cth.pulseDismiss(a.id); await load(); };

  const view = data;
  const cols = layout === 'wide' ? 4 : layout === 'mid' ? 2 : 1;
  const memberCols = layout === 'wide' ? 4 : layout === 'mid' ? 3 : 1;
  const sugCols = layout === 'wide' ? 3 : layout === 'mid' ? 2 : 1;
  const grid = (n: number): CSSProperties => ({ display: 'grid', gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))`, gap: 12 });

  let body: ReactNode;
  if (failed || (view && !view.available)) {
    body = (
      <div style={{ ...card, padding: 26, textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center' }}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>{t('pulse.unavailable')}</div>
        <div style={{ fontSize: 12, color: 'var(--cth-ink-3)' }}>{t('pulse.unavailableHint')}</div>
        <button type="button" style={{ ...btn(false), marginTop: 6 }} onClick={() => { void load(); }}>{t('pulse.tryAgain')}</button>
      </div>
    );
  } else if (!view) {
    body = null;
  } else {
    const s = view.snapshot;
    const godId = s.michael?.agentId;
    const members = s.members.filter((m) => m.agentId !== godId);
    const shownAdvice = view.advice.filter((a) => !applied.some((x) => x.advice.id === a.id));
    const outcomeLabel = (o: Outcome): string => t(`pulse.outcome.${o.kind}`, { sub: o.sub ?? 0 });
    const outcomeAria = (o: Outcome): string => `${outcomeLabel(o)}: ${o.by.map((b) => `${nameOf(b.agentId)} ${b.count}`).join(', ')}`;
    body = (
      <>
        {s.gapDays.length > 0 && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, color: 'var(--cth-ink-2)', background: 'var(--cth-neutral-soft)', borderRadius: 'var(--cth-r-lg)', padding: '8px 11px' }}>
            <Icon name="info" /> {t('pulse.gapNotice', { days: s.gapDays.map(fmtDay).join(', ') })}
          </div>
        )}

        <Section title={t('pulse.waysToSave')} tip={t('pulse.waysToSaveTip')}>
          <div style={grid(sugCols)}>
            {applied.map((x) => (
              <div key={`a-${x.appliedId}`} style={{ background: 'var(--cth-green-soft)', borderRadius: 'var(--cth-r-xl)', boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--cth-green) 35%, transparent)', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{t('pulse.applied')} {x.text}</div>
                <div><button type="button" style={btn(false)} onClick={() => { void undo(x); }}>{t('pulse.undo')}</button></div>
              </div>
            ))}
            {shownAdvice.slice(0, Math.max(0, 3 - applied.length)).map((a) => {
              const txt = adviceText(a);
              return (
                <div key={a.id} style={{ background: 'var(--cth-amber-soft)', borderRadius: 'var(--cth-r-xl)', boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--cth-amber) 40%, transparent)', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <AgentAvatar id={a.agentId} name={nameOf(a.agentId)} size={22} />
                    <div style={{ fontSize: 13, fontWeight: 600, lineHeight: '18px' }}>{txt.title}</div>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--cth-amber-text)', lineHeight: '17px' }}>{txt.evidence}</div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <button type="button" style={btn(true)} disabled={busy === a.id} onClick={() => { void apply(a); }}>
                      {a.change.kind === 'editor' ? t('pulse.openSchedules') : t('pulse.apply')}
                    </button>
                    <button type="button" style={btn(false)} onClick={() => { void notNow(a); }}>{t('pulse.notNow')}</button>
                    {a.savesPerWeek !== null && a.savesPerWeek > 0 && (
                      <span style={{ marginInlineStart: 'auto', fontSize: 11, fontWeight: 600, color: 'var(--cth-green-text)', background: 'var(--cth-green-soft)', borderRadius: 'var(--cth-r-pill)', padding: '2px 8px' }}>
                        {t('pulse.savesAbout', { usd: money(a.savesPerWeek) })}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
            {shownAdvice.length === 0 && applied.length === 0 && (
              <div style={{ ...card, padding: '12px 14px', fontSize: 13, color: 'var(--cth-ink-2)', display: 'flex', alignItems: 'center', gridColumn: sugCols > 1 ? `span ${sugCols - 1}` : undefined }}>
                {view.adviceFrom ? t('pulse.adviceStarts', { day: fmtDay(view.adviceFrom) }) : t('pulse.nothingToChange')}
              </div>
            )}
            <div style={{ ...card, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 4, justifyContent: 'center' }}>
              <div style={label}>{t('pulse.savedByChanges')}<InfoTip text={t('pulse.savedTip')} /></div>
              {view.saved.state === 'none' && <div style={{ fontSize: 12, color: 'var(--cth-ink-3)' }}>{t('pulse.savedNone')}</div>}
              {view.saved.state === 'measuring' && <><div style={{ fontSize: 22, fontWeight: 600 }}>{t('pulse.measuring')}</div><div style={{ fontSize: 11, color: 'var(--cth-ink-3)' }}>{t('pulse.firstResult', { day: fmtDay(view.saved.firstAt) })}</div></>}
              {view.saved.state === 'measured' && <><div style={{ ...mono, fontSize: 22, fontWeight: 600, color: view.saved.usd >= 0 ? 'var(--cth-green-text)' : 'var(--cth-ink)' }}>{view.saved.usd < 0 ? '−' : ''}{money(Math.abs(view.saved.usd))}</div><div style={{ fontSize: 11, color: 'var(--cth-ink-3)' }}>{t(view.saved.usd < 0 ? 'pulse.costMore' : 'pulse.since', { day: fmtDay(view.saved.since) })}</div></>}
            </div>
          </div>
        </Section>

        <Section title={t('pulse.whatGotDone')}>
          <div style={grid(cols)}>
            {s.outcomes.map((o) => (
              <div key={o.kind} style={{ ...card, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div aria-hidden style={{ width: 30, height: 30, borderRadius: 'var(--cth-r-md)', background: 'var(--cth-card-2)', boxShadow: 'inset 0 0 0 1px var(--cth-line)', display: 'grid', placeItems: 'center', color: 'var(--cth-ink-2)' }}><Icon name={KIND_ICON[o.kind]} size={1.125} /></div>
                <div style={{ ...mono, fontSize: 28, fontWeight: 600, lineHeight: '30px' }}>{o.total}</div>
                <div style={{ fontSize: 12, color: 'var(--cth-ink-2)' }}>{outcomeLabel(o)}</div>
                {o.kind === 'check'
                  ? <WhoBar by={[{ agentId: '__work', count: o.sub ?? 0 }, { agentId: '__none', count: o.total - (o.sub ?? 0) }]} colorOf={(id) => (id === '__work' ? 'var(--cth-ink-2)' : 'var(--cth-line-2)')} nameOf={(id) => t(id === '__work' ? 'pulse.foundWork' : 'pulse.nothingToDo')} aria={outcomeLabel(o)} />
                  : <WhoBar by={o.by} colorOf={colorOf} nameOf={nameOf} aria={outcomeAria(o)} />}
              </div>
            ))}
          </div>
        </Section>

        <Section title={t('pulse.team')} tip={t('pulse.teamTip')}>
          {members.length === 0 && !s.michael ? (
            <div style={{ ...card, padding: 20, fontSize: 13, color: 'var(--cth-ink-2)' }}>{t('pulse.emptyOffice')}</div>
          ) : (
            <div style={grid(memberCols)}>
              {s.michael && (
                <button type="button" onClick={() => setDetail(s.michael!.agentId)} style={{ ...card, padding: 14, display: 'flex', flexDirection: 'column', gap: 10, textAlign: 'start', cursor: 'pointer', border: 'none', fontFamily: 'var(--cth-font-ui)', color: 'var(--cth-ink)' }}>
                  <TileHead id={s.michael.agentId} name={nameOf(s.michael.agentId)} role={t('pulse.officeManager')} color="var(--cth-indigo)" />
                  <Counts items={[[s.michael.routed, t('pulse.routed')], [s.michael.questions, t('pulse.questionsToYou')], [s.michael.cardsOpened, t('pulse.cardsOpened')]]} />
                  <div style={{ fontSize: 11, color: 'var(--cth-ink-2)' }}>{t('pulse.runningOffice')} <b style={mono}>{pct(s.michael.share)}</b></div>
                </button>
              )}
              {members.map((m) => (
                <MemberTile key={m.agentId} m={m} name={nameOf(m.agentId)} role={byId.get(m.agentId) ? roleOf(byId.get(m.agentId)!) : ''} color={colorOf(m.agentId, 0)} advice={view.advice.some((a) => a.agentId === m.agentId)} onOpen={() => setDetail(m.agentId)} />
              ))}
            </div>
          )}
        </Section>

        <div style={{ display: 'grid', gridTemplateColumns: layout === 'wide' ? '1.6fr 1fr 1fr' : layout === 'mid' ? '1fr 1fr' : '1fr', gap: 12 }}>
          <div style={{ ...card, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8, gridColumn: layout === 'mid' ? '1 / -1' : undefined }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
              <h2 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{t('pulse.whereMoneyWent')}</h2>
              <span style={{ fontSize: 11, color: 'var(--cth-ink-3)' }}><b style={{ ...mono, color: 'var(--cth-ink)' }}>{money(s.totalUsd)}</b> {t(view.billing === 'apiKey' ? 'pulse.spentApiKey' : 'pulse.atApiPrices')}</span>
            </div>
            <WhoBar by={s.members.filter((m) => m.usd > 0).map((m) => ({ agentId: m.agentId, count: Math.round(m.usd * 100) / 100 }))} colorOf={colorOf} nameOf={nameOf} height={14} aria={s.members.map((m) => `${nameOf(m.agentId)} ${money(m.usd)}`).join(', ')} />
          </div>
          {view.headroom && (
            <div style={{ ...card, padding: '14px 16px', display: 'flex', gap: 14, alignItems: 'center' }}>
              <svg width={88} height={88} viewBox="0 0 88 88" role="img" aria-label={t('pulse.planAria', { pct: Math.round(view.headroom.usedPct) })}>
                <circle cx={44} cy={44} r={36} fill="none" stroke="var(--cth-neutral-soft)" strokeWidth={10} />
                <circle cx={44} cy={44} r={36} fill="none" stroke="var(--cth-ink-2)" strokeWidth={10} strokeLinecap="round" strokeDasharray={`${(Math.min(100, view.headroom.usedPct) / 100) * 226} 226`} transform="rotate(-90 44 44)" />
                <text x={44} y={50} textAnchor="middle" fontFamily="var(--cth-font-mono)" fontSize={17} fontWeight={600} fill="var(--cth-ink)">{Math.round(view.headroom.usedPct)}%</text>
              </svg>
              <div>
                <div style={label}>{t('pulse.planUse')}<InfoTip text={t('pulse.planTip')} /></div>
                <div style={{ fontSize: 11, color: 'var(--cth-ink-3)' }}>{t('pulse.resets', { day: fmtDay(view.headroom.resetsAt) })}</div>
                {view.headroom.runsOutAt && <div style={{ marginTop: 6 }}><span style={{ fontSize: 11, fontWeight: 600, color: 'var(--cth-amber-text)', background: 'var(--cth-amber-soft)', borderRadius: 'var(--cth-r-pill)', padding: '2px 8px' }}>{t('pulse.runsOut', { day: fmtDay(view.headroom.runsOutAt) })}</span></div>}
              </div>
            </div>
          )}
          <div style={{ ...card, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={label}>{t('pulse.yourTime')}<InfoTip text={t('pulse.yourTimeTip')} /></div>
            <div style={{ ...mono, fontSize: 22, fontWeight: 600 }}>{s.yourTime.asks} <span style={{ fontFamily: 'var(--cth-font-ui)', fontSize: 12, color: 'var(--cth-ink-3)', fontWeight: 400 }}>{t('pulse.questions')}</span></div>
            {s.yourTime.medianWaitMs !== null && <div style={{ fontSize: 11, color: 'var(--cth-ink-3)' }}>{t('pulse.answeredIn', { time: duration(s.yourTime.medianWaitMs, t) })}</div>}
            <div style={{ ...label, marginTop: 6 }}>{t('pulse.whileAway')}<InfoTip text={t('pulse.awayTip')} /></div>
            <div style={{ ...mono, fontSize: 22, fontWeight: 600 }}>{s.awayShare === null ? '0%' : pct(s.awayShare)}</div>
            <div style={{ fontSize: 11, color: 'var(--cth-ink-3)' }}>{t('pulse.awayLine')}</div>
          </div>
        </div>
      </>
    );
  }

  return (
    <div ref={host} role="region" aria-label={t('floorView.pulse')} style={{ flex: 1, overflow: 'auto', padding: '22px 28px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600, letterSpacing: '-0.03em' }}>{t('floorView.pulse')}</h1>
        <select
          aria-label={t('pulse.period')}
          value={period}
          onChange={(e) => { const v = e.target.value as Period; setPeriod(v); try { window.localStorage.setItem(LS_PERIOD, v); } catch { /* per-Mac nicety */ } }}
          className="cth-input"
          style={{ height: 30, fontSize: 12, borderRadius: 'var(--cth-r-md)' }}
        >
          {PERIODS.map((p) => <option key={p} value={p}>{t(`pulse.periods.${p}`)}</option>)}
        </select>
        <span style={{ flex: 1 }} />
        {view?.collectingSince && <span style={{ fontSize: 11, color: 'var(--cth-ink-3)' }}>{t('pulse.collectingSince', { day: fmtDay(view.collectingSince) })}</span>}
      </div>
      <div aria-live="polite" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>{notice}</div>
      {body}
      {detail && view && <MemberDetail id={detail} data={view} name={nameOf(detail)} onClose={() => setDetail(null)} money={money} />}
    </div>
  );
}

function TileHead({ id, name, role, color }: { id: string; name: string; role: string; color: string }) {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
      <span style={{ borderRadius: '50%', boxShadow: `0 0 0 2px ${color}`, display: 'inline-flex' }}><AgentAvatar id={id} name={name} size={40} /></span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: '-0.01em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
        <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{role}</div>
      </div>
    </div>
  );
}

function Counts({ items }: { items: Array<[number, string]> }) {
  return (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
      {items.map(([n, l]) => (
        <span key={l} style={{ display: 'flex', flexDirection: 'column', fontSize: 10.5, color: 'var(--cth-ink-3)' }}>
          <b style={{ fontFamily: 'var(--cth-font-mono)', fontSize: 17, color: 'var(--cth-ink)', fontWeight: 600 }}>{n}</b>{l}
        </span>
      ))}
    </div>
  );
}

function MemberTile({ m, name, role, color, advice, onOpen }: { m: MemberMeasures; name: string; role: string; color: string; advice: boolean; onOpen: () => void }) {
  const { t } = useTranslation();
  const c = m.costForWork;
  const counts: Array<[number, string]> = (['email', 'check', 'sent', 'task'] as WorkKind[]).filter((k) => m.counts[k] > 0).slice(0, 3).map((k) => [m.counts[k], t(`pulse.kind.${k}`)]);
  const verdictColor = c.verdict === 'cheaper' ? 'var(--cth-green-text)' : c.verdict === 'pricier' ? 'var(--cth-amber-text)' : 'var(--cth-ink)';
  const aria = c.verdict === 'too-few' ? t('pulse.tooFew') : t(`pulse.verdict.${c.verdict}`);
  return (
    <button type="button" onClick={onOpen} style={{ ...card, padding: 14, display: 'flex', flexDirection: 'column', gap: 10, textAlign: 'start', cursor: 'pointer', border: 'none', fontFamily: 'var(--cth-font-ui)', color: 'var(--cth-ink)' }}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <TileHead id={m.agentId} name={name} role={role} color={color} />
        {advice && <span aria-label={t('pulse.hasSuggestion')} style={{ marginInlineStart: 'auto', width: 8, height: 8, borderRadius: '50%', background: 'var(--cth-amber)' }} />}
      </div>
      {counts.length ? <Counts items={counts} /> : <div style={{ fontSize: 11, color: 'var(--cth-ink-3)' }}>{t('pulse.nothingYet')}</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <div style={label}>{t('pulse.costForWork')}</div>
        <div role="img" aria-label={aria} style={{ position: 'relative', height: 8, borderRadius: 'var(--cth-r-pill)', background: 'linear-gradient(90deg, var(--cth-green-soft), var(--cth-neutral-soft) 40% 60%, var(--cth-amber-soft))', opacity: c.verdict === 'too-few' ? 0.4 : 1 }}>
          <span style={{ position: 'absolute', left: '50%', top: -3, width: 1, height: 14, background: 'var(--cth-ink-4)' }} />
          {c.verdict !== 'too-few' && <span style={{ position: 'absolute', insetInlineStart: `${c.position * 100}%`, top: -3, width: 14, height: 14, borderRadius: '50%', background: 'var(--cth-card)', boxShadow: 'inset 0 0 0 3px var(--cth-ink)', transform: 'translateX(-50%)' }} />}
        </div>
        <div style={{ fontSize: 11, color: 'var(--cth-ink-2)' }}>
          {c.verdict === 'too-few' ? t('pulse.tooFew') : <><b style={{ color: verdictColor }}>{t(`pulse.verdict.${c.verdict}`)}</b>{c.perPiece !== null && c.kind && <> · <span style={{ fontFamily: 'var(--cth-font-mono)' }}>${c.perPiece.toFixed(2)}</span> {t(`pulse.per.${c.kind}`)}</>}</>}
        </div>
      </div>
    </button>
  );
}

function MemberDetail({ id, data, name, onClose, money }: { id: string; data: PulseData; name: string; onClose: () => void; money: (v: number) => string }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement | null>(null);
  useDialog(ref, onClose);
  const backdrop = useBackdropClose(onClose);
  const m = data.snapshot.members.find((x) => x.agentId === id);
  const trend = data.trend[id] ?? [0, 0, 0, 0];
  const max = Math.max(...trend, 0.0001);
  const fact = (lbl: string, v: string, d: string, tip?: string): ReactNode => (
    <div style={{ background: 'var(--cth-card-2)', borderRadius: 'var(--cth-r-lg)', padding: '9px 11px', boxShadow: 'inset 0 0 0 1px var(--cth-line)', display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={label}>{lbl}{tip && <InfoTip text={tip} />}</div>
      <div style={{ fontFamily: 'var(--cth-font-mono)', fontSize: 15, fontWeight: 600 }}>{v}</div>
      <div style={{ fontSize: 11, color: 'var(--cth-ink-3)', lineHeight: '15px' }}>{d}</div>
    </div>
  );
  return (
    <div {...backdrop} style={{ position: 'fixed', inset: 0, background: 'var(--cth-backdrop)', zIndex: 300, display: 'grid', placeItems: 'start center', paddingTop: 80 }}>
      <div ref={ref} role="dialog" aria-modal aria-label={name} style={{ width: 560, maxWidth: 'calc(100% - 32px)', ...card, borderRadius: 'var(--cth-r-2xl)', boxShadow: 'inset 0 0 0 1px var(--cth-line), var(--cth-shadow-lg)', padding: '18px 20px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <AgentAvatar id={id} name={name} size={30} />
          <div style={{ fontSize: 15, fontWeight: 600 }}>{name}</div>
          <button type="button" aria-label={t('common.close')} onClick={onClose} style={{ marginInlineStart: 'auto', border: 'none', background: 'none', cursor: 'pointer', color: 'var(--cth-ink-3)' }}><Icon name="x" /></button>
        </div>
        {m && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
            {fact(t('pulse.value'), money(m.usd), t('pulse.shareOfOffice', { pct: Math.round(m.share * 100) }), t('pulse.valueTip'))}
            {fact(t('pulse.perPiece'), m.costForWork.perPiece !== null ? `$${m.costForWork.perPiece.toFixed(2)}` : '…', m.costForWork.kind ? t(`pulse.per.${m.costForWork.kind}`) : t('pulse.tooFew'), t('pulse.perPieceTip'))}
            {fact(t('pulse.yourTime'), t('pulse.asksCount', { count: m.asks }), m.askWaitMs !== null ? t('pulse.waited', { time: Math.round(m.askWaitMs / 60_000) }) : '', t('pulse.yourTimeTip'))}
            {fact(t('pulse.keptAsIs'), m.kept.share !== null ? `${Math.round(m.kept.share * 100)}%` : `${m.kept.kept}/${m.kept.decisions}`, t('pulse.keptLine', { kept: m.kept.kept, decisions: m.kept.decisions }), t('pulse.keptTip'))}
            {fact(t('pulse.speed'), m.speedMs !== null ? `${Math.round(m.speedMs / 3_600_000)}h` : '…', t('pulse.speedLine'), t('pulse.speedTip'))}
            {fact(t('pulse.whileAway'), m.awayShare !== null ? `${Math.round(m.awayShare * 100)}%` : '…', t('pulse.awayMine'), t('pulse.awayTip'))}
          </div>
        )}
        <div>
          <div style={{ ...label, marginBottom: 6 }}>{t('pulse.fourWeeks')}</div>
          <div role="img" aria-label={trend.map((v) => money(v)).join(', ')} style={{ display: 'flex', gap: 6, alignItems: 'flex-end', height: 44 }}>
            {trend.map((v, i) => <div key={i} style={{ flex: 1, height: `${Math.max(4, (v / max) * 100)}%`, background: i === 3 ? 'var(--cth-ink-2)' : 'var(--cth-line-2)', borderRadius: '4px 4px 0 0' }} />)}
          </div>
        </div>
      </div>
    </div>
  );
}
