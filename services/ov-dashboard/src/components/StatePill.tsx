'use client';
import { statePillClass, useLiveStatus } from './LiveStatus';

export function StatePill() {
  const { state, online } = useLiveStatus();
  const effective = online ? state : 'OFFLINE';
  return <span className={statePillClass(effective)}>{effective}</span>;
}
