import type { ProjectStatus } from '../api/types.ts';

const MAP: Record<ProjectStatus, { label: string; cls: string }> = {
  created: { label: 'Ready to process', cls: 'pill' },
  preparing: { label: 'Preparing', cls: 'pill pill-run' },
  processing: { label: 'Processing', cls: 'pill pill-run' },
  completed: { label: 'Completed', cls: 'pill pill-ok' },
  failed: { label: 'Failed', cls: 'pill pill-err' },
};

export function StatusPill({ status }: { status: ProjectStatus }) {
  const { label, cls } = MAP[status] ?? MAP.created;
  return <span className={cls}>{label}</span>;
}
